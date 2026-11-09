# Autocore Hotels Provider — Tool Contract

> **Feature design**: [`feature-design.md`](./feature-design.md) · **Grill**: [`grill-notes.md`](./grill-notes.md) · **Evidence**: [`sandbox-evidence.md`](./sandbox-evidence.md) · **ADR**: [`timestamped-hash-token-auth-scheme`](../../adr/timestamped-hash-token-auth-scheme.md)
> **Last updated**: 2026-11-09
>
> Each `input` is the zod source of truth; the JSON Schema in `tools/list` is generated from it. All schemas are
> `.strict()`: an undeclared key → `PROVIDER_INVALID_INPUT`. Every Autocore value below was observed against Staging
> (`https://api-stg.autocore.pro`, hotel 5) on 2026-11-09.
>
> **Scope of this version.** The provider, its connection probe and link creation. The third tool,
> `mcp_autocore_get_transaction_status`, is not in this contract: its paid half (`applied`, the voucher) is not
> observed because Autocore's Staging checkout fails before sending a payment. Its verified and pending facts are in
> [`api-contract-preflight.md`](./api-contract-preflight.md); it enters here, additively, once observed.

---

## 0. Provider

| Field                                        | Value                                                                                                                                                                                                           |
| :------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slug                                         | `autocore`                                                                                                                                                                                                      |
| Display name                                 | `Autocore Hotels`                                                                                                                                                                                               |
| Category                                     | `payment-gateway`                                                                                                                                                                                               |
| Auth                                         | `{ type: 'timestamped_hash_token', header: 'Auth-Token', credentialDelivery: 'reference', fields: [{ key: 'access_key', label: 'Autocore access key' }, { key: 'secret_key', label: 'Autocore secret key' }] }` |
| Credential the consumer stores               | One composed secret `access_key:secret_key` (`fields[0]:fields[1]`), delivered by reference                                                                                                                     |
| Header on every request                      | `Auth-Token: base64(utf8(access_key + ";" + ts + ";" + sha256_hex(utf8(secret_key + ts))))`, `ts` = Unix seconds, built by the core per HTTP request (ADR)                                                      |
| Context (`metadataSchema` / `contextSchema`) | `z.object({ hotelId: z.number().int().positive(), environment: z.enum(['staging', 'production']) }).strict()`                                                                                                   |
| `accountContextKeys`                         | `['hotelId', 'environment']`                                                                                                                                                                                    |
| `connectionProbe`                            | `{ tool: 'mcp_autocore_check_credentials' }`                                                                                                                                                                    |
| Base URL                                     | `environment: 'staging'` → `https://api-stg.autocore.pro` · `'production'` → `https://api.autocore.pro` (documented)                                                                                            |
| Deployment override                          | `createAutocoreProvider({ baseUrls?, clock? })` for tests only                                                                                                                                                  |

The keys are per environment: Staging keys answer `401` on any other host (observed). The consumer sends the
environment the tenant picked; the provider alone knows the hosts.

---

## 1. Tools

All are `controlPlane: true`: absent from `tools/list`, callable by name. None declares an `identityPolicy`.

### 1.1 `mcp_autocore_check_credentials` (connection probe)

|               |                                                                                                                     |
| :------------ | :------------------------------------------------------------------------------------------------------------------ |
| Input         | `z.object({}).strict()`                                                                                             |
| Autocore call | `GET /v2/hotels?offset=<n>&limit=10`, `n` = 0, 10, 20… until `n >= paginate_info.total_items`, **at most 20 pages** |
| Success       | the context's `hotelId` is in some page's `data[].id` → `ok(data)` below                                            |
| Not found     | no page has it → `PROVIDER_INVALID_INPUT`, `Autocore hotel <hotelId> is not reachable with these keys`              |
| Too many      | `total_items` > 200 and not found in 20 pages → `PROVIDER_ERROR`, `Autocore hotel listing too large`                |
| Failure       | per §2                                                                                                              |

Paging stops on `total_items`, never on `paginate_info.links.next`, which points past the end even on the last page
(observed). The listing is scoped to the keys (observed: `total_items: 1`).

Success → `ok(data)`:

```ts
{
  valid: true;
  hotel: {
    id: number; // data[].id
    name: string; // data[].name
    active: boolean; // data[].is_active && !data[].is_archived
    currencies: string[]; // data[].currencies[].currency.code, e.g. ["COP", "USD"]
    primaryCurrency: string | null; // the code whose is_primary is true
  };
}
```

Nothing else of the hotel record leaves the provider — not `contact_phone`, `address`, `company`, `commission`,
`hotel_services` or `colors_schema`.

### 1.2 `mcp_autocore_create_payment_link`

Input:

```ts
z.object({
  amount: z.number().int().positive(), // whole units of `currency` (150000 = $150.000 COP); never cents
  currency: z.string().regex(/^[A-Z]{3}$/), // ISO 4217; Autocore does not check it against the hotel's currencies
  guestName: z.string().min(1).max(200), // the payer's name, shown on the checkout
  email: z.string().email().max(254).optional(), // the guest's email; Autocore emails the link here only if sendLinkByEmail
  description: z.string().min(1).max(500), // the concept shown on the checkout
  externalRef: z.string().min(1).max(100), // the consumer's own reference; NOT unique at Autocore
  availableHours: z.number().int().min(1).max(8760), // validity of the link, in hours
  notificationUrl: z.string().url().startsWith('https://'), // where Autocore POSTs payment notifications
  sendLinkByEmail: z.boolean(), // REQUIRED: Autocore emails the guest unless this is false
  allowedPaymentOptions: z
    .array(
      z.enum([
        'nequi',
        'daviplata',
        'pse',
        'credit_card',
        'sinpe_movil',
        'preloaded_balance',
        'gift_cards',
      ]),
    )
    .min(1)
    .optional(), // absent = the hotel's own setup; Autocore does not check it against the hotel's services
}).strict();
```

Autocore call: `POST /v2/links/schedule/`

```json
{
  "hotel_id": 5,
  "amount": 150000,
  "currency": "COP",
  "guest_name": "Jhon Doe",
  "email": "guest@example.com",
  "description": "xcale spike link 1",
  "external_ref_id": "xcale-spike-001",
  "available_hours": 24,
  "temp_webhook_url": "https://example.com/xcale-autocore-webhook",
  "send_link_by_email": false,
  "allowed_payment_options": ["credit_card"]
}
```

`hotel_id` comes from the context. `email` and `allowed_payment_options` are omitted when absent (never sent as
`null`).

Success (`200`) → `ok(data)`:

```ts
{
  code: string; // body.code, e.g. "vlxcvpqhcjc8" — the link's id at Autocore, used to read its status
  url: string; // body.url, e.g. "https://app-stg.autocore.pro/payment/xcale_hotel/vlxcvpqhcjc8" — returned, never built
}
```

`msg` and `reservation_id` (`null` for a link without a reservation) are not returned.

**Never retried.** Autocore creates a second link for a repeated `external_ref_id` (observed) and cannot find a link
by it, so the provider sends the `POST` once. A timeout or network failure is `PROVIDER_UNAVAILABLE`, and a payable
link may exist.

Observed Autocore validation (why the schema is stricter than Autocore):

| Sent                                                       | Autocore                                | This tool                                                     |
| :--------------------------------------------------------- | :-------------------------------------- | :------------------------------------------------------------ |
| No `amount` / no `guest_name`                              | `422` `"El campo '<f>' es requerido\n"` | Refused by the schema, no call                                |
| `amount: 150000.5`                                         | `200`, link created                     | Refused by the schema (integer)                               |
| No `currency` / no `description`                           | `200`                                   | Refused by the schema (required)                              |
| `currency: "CRC"` for a COP/USD hotel                      | `200`                                   | Sent; the consumer checks it against the probe's `currencies` |
| `allowed_payment_options: ["nequi"]` for a card-only hotel | `200`                                   | Sent: the hotel's choice                                      |
| No `email`                                                 | `200`                                   | Allowed (optional)                                            |
| `hotel_id` not reached by the keys                         | `404` `"Hotel no encontrado"`           | `PROVIDER_ERROR`                                              |

---

## 2. Errors

Codes are the core's `ProviderErrorCode` (`src/core/errors.ts:6-15`), assigned by the core's status policy
(`mapHttpStatusToErrorCode`, `src/core/http.ts`) — the same for every provider. No new codes.

Autocore's error body is always `{ "code": 0, "message": "Error http: <n>", "detail": "<free Spanish text>" }`
(observed for 401, 404, 422): no stable code, and `detail` is never propagated.

| Autocore                                                                    | Code                                              | Message (own, fixed)                                                          |
| :-------------------------------------------------------------------------- | :------------------------------------------------ | :---------------------------------------------------------------------------- |
| `401` `"Credenciales inválidas"` (observed) / `403`                         | `PROVIDER_AUTH_EXPIRED`                           | `Autocore <operation> failed (HTTP 401)`                                      |
| `422` / `400`                                                               | `PROVIDER_INVALID_INPUT`                          | `Autocore <operation> failed (HTTP 422)`                                      |
| `404` (`"Hotel no encontrado"`, observed) and any other status              | `PROVIDER_ERROR`                                  | `Autocore <operation> failed (HTTP 404)`                                      |
| `429`                                                                       | `PROVIDER_RATE_LIMITED`                           | `Autocore <operation> failed (HTTP 429)`                                      |
| `5xx`, timeout, network                                                     | `PROVIDER_UNAVAILABLE`                            | `Autocore <operation> failed (HTTP 5xx)` / `Autocore <operation> unreachable` |
| `2xx` with an unexpected shape                                              | `PROVIDER_ERROR`                                  | `Autocore <operation> returned an unexpected response`                        |
| Probe: `hotelId` not in the listing                                         | `PROVIDER_INVALID_INPUT`                          | `Autocore hotel <hotelId> is not reachable with these keys`                   |
| Probe: listing past 20 pages                                                | `PROVIDER_ERROR`                                  | `Autocore hotel listing too large`                                            |
| Context: `environment` missing or unknown, `hotelId` not a positive integer | `PROVIDER_INVALID_INPUT`                          | the core's input validation message (no call)                                 |
| Composed secret without `:` or with an empty part                           | — (the core fails closed before any request, ADR) | fixed core message, no credential material                                    |

`<operation>` is `check credentials` or `create payment link`.

**Redaction rule (binding).** No Autocore response body, `detail` or `message`, no `Auth-Token`, and no link URL or
code beyond what an outcome returns, reaches a tool outcome, an error message or a log line. A test asserts it with
an error body that carries a fake key.

---

## 3. Mock data

### `mcp_autocore_check_credentials`

```json
{
  "ok": true,
  "data": {
    "valid": true,
    "hotel": {
      "id": 5,
      "name": "STG XCALE HOTEL",
      "active": true,
      "currencies": ["COP", "USD"],
      "primaryCurrency": "COP"
    }
  }
}
```

```json
{
  "ok": false,
  "code": "PROVIDER_AUTH_EXPIRED",
  "message": "Autocore check credentials failed (HTTP 401)"
}
```

```json
{
  "ok": false,
  "code": "PROVIDER_INVALID_INPUT",
  "message": "Autocore hotel 6 is not reachable with these keys"
}
```

### `mcp_autocore_create_payment_link`

```json
{
  "ok": true,
  "data": {
    "code": "vlxcvpqhcjc8",
    "url": "https://app-stg.autocore.pro/payment/xcale_hotel/vlxcvpqhcjc8"
  }
}
```

```json
{
  "ok": false,
  "code": "PROVIDER_INVALID_INPUT",
  "message": "Autocore create payment link failed (HTTP 422)"
}
```

```json
{
  "ok": false,
  "code": "PROVIDER_ERROR",
  "message": "Autocore create payment link failed (HTTP 404)"
}
```

---

## 4. Fixtures

From the Staging spike, with no key and placeholders for any personal or company data:

| Fixture                          | Source                                                                                                                       |
| :------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `listHotels.json`                | `GET /v2/hotels` → 200, one hotel (id 5), phone/address/company/commissions replaced by placeholders                         |
| `createPaymentLink.json`         | `POST /v2/links/schedule/` → 200 `{ msg, url, code, reservation_id: null }`                                                  |
| `errors/invalidCredentials.json` | 401 `{"code":0,"message":"Error http: 401","detail":"Credenciales inválidas"}`                                               |
| `errors/missingFields.json`      | 422 `{"code":0,"message":"Error http: 422","detail":"El campo 'guest_name' es requerido\nEl campo 'amount' es requerido\n"}` |
| `errors/hotelNotFound.json`      | 404 `{"code":0,"message":"Error http: 404","detail":"Hotel no encontrado"}`                                                  |
| `errors/withFakeKey.json`        | 401 with a fake key inside `detail` (for the redaction test; not observed, constructed)                                      |

---

## 5. Consumer notes (xcale-backend)

- **Connect:** collect both `fields`, store them composed `access_key:secret_key`, deliver by `reference`; ask
  `hotelId` and `environment` (no default) and call the probe before storing. Show `hotel.name`; keep
  `hotel.currencies` to check a link's currency before creating it.
- **Create:** `amountMinor` → whole units, refusing a fraction; `expiresAt` → `availableHours` rounded down;
  `sendLinkByEmail` from the tenant's setting; `notificationUrl` is the consumer's webhook, which receives Autocore's
  unsigned notifications and must confirm each with the status read before settling. **Never retry a create
  blindly** — a lost response can leave a payable link; its payment still reaches the webhook with `externalRef`.
- **Store `code`**, not just the URL: it is the link's id for reading its status.
- **Two Autocore reads are public** (observed): a link's status and `GET /v2/links/schedule/<code>`, which returns
  the guest's name, email and phone to anyone with the code. Send Autocore only the guest data a payment needs.
- **No deactivation exists.** A link lives until `availableHours` runs out.

## 6. Roadmap (additive)

| Next                                          | Lifts it                                                                                           |
| :-------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| `mcp_autocore_get_transaction_status`         | A paid link in Staging: `applied`, its `transaction_id`, the voucher (`api-contract-preflight.md`) |
| `phone`, `countryCode`, `installments` inputs | One observed link with each (the docs disagree on `country_code`'s format)                         |
| Refunds, the open link                        | A consumer asking                                                                                  |
