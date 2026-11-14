# Autocore Hotels Provider — Tool Contract

> **Feature design**: [`feature-design.md`](./feature-design.md) · **Grill**: [`grill-notes.md`](./grill-notes.md) · **Evidence**: [`sandbox-evidence.md`](./sandbox-evidence.md) · **ADR**: [`timestamped-hash-token-auth-scheme`](../../adr/timestamped-hash-token-auth-scheme.md)
> **Last updated**: 2026-11-13
>
> Each `input` is the zod source of truth; the JSON Schema in `tools/list` is generated from it. All schemas are
> `.strict()`: an undeclared key → `PROVIDER_INVALID_INPUT`. Every Autocore value below was observed against Staging
> (`https://api-stg.autocore.pro`, hotel 5) on 2026-11-09 and 2026-11-13, payments included.

---

## 0. Provider

| Field                                        | Value                                                                                                                                                                                                           |
| :------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slug                                         | `autocore`                                                                                                                                                                                                      |
| Display name                                 | `Autocore Hotels`                                                                                                                                                                                               |
| Category                                     | `payment-gateway`                                                                                                                                                                                               |
| Logo                                         | `/assets/autocore.svg`                                                                                                                                                                                          |
| Auth                                         | `{ type: 'timestamped_hash_token', header: 'Auth-Token', credentialDelivery: 'reference', fields: [{ key: 'access_key', label: 'Autocore access key' }, { key: 'secret_key', label: 'Autocore secret key' }] }` |
| Credential the consumer stores               | One composed secret `access_key:secret_key` (`fields[0]:fields[1]`), delivered by reference                                                                                                                     |
| Header on every request                      | `Auth-Token: base64(utf8(access_key + ";" + ts + ";" + sha256_hex(utf8(secret_key + ts))))`, `ts` = Unix seconds, built by the core per HTTP request (ADR)                                                      |
| Context (`metadataSchema` / `contextSchema`) | `z.object({ hotelId: z.number().int().positive() /* also a string of digits, read as its number */, environment: z.enum(['staging', 'production']), source: z.string().min(1).max(100) }).strict()`             |
| `accountContextKeys`                         | `['hotelId', 'environment']`                                                                                                                                                                                    |
| `connectionProbe`                            | `{ tool: 'mcp_autocore_check_credentials' }`                                                                                                                                                                    |
| Base URL                                     | `environment: 'staging'` → `https://api-stg.autocore.pro` · `'production'` → `https://api.autocore.pro` (documented)                                                                                            |
| Deployment override                          | `createAutocoreProvider({ baseUrls?, clock? })` for tests only                                                                                                                                                  |

- The keys are per environment: Staging keys answer `401` on any other host (observed). The consumer sends the
  environment the tenant picked; the provider alone knows the hosts.
- `source` is the account's origin, which Autocore hands over with the keys (xcale's is `xcale`). Autocore requires it
  on every link since 2026-11-13 (`400` "Debe indicar el origen…" without it). Routing data, not a secret.

---

## 1. Tools

All four are `controlPlane: true`: absent from `tools/list`, callable by name. None declares an `identityPolicy`.

### 1.1 `mcp_autocore_check_credentials` (connection probe)

|               |                                                                                                                     |
| :------------ | :------------------------------------------------------------------------------------------------------------------ |
| Input         | `z.object({}).strict()`                                                                                             |
| Autocore call | `GET /v2/hotels?offset=<n>&limit=10`, `n` = 0, 10, 20… until `n >= paginate_info.total_items`, **at most 20 pages** |
| Success       | the context's `hotelId` is in some page's `data[].id` → `ok(data)` below                                            |
| Not found     | no page has it → `PROVIDER_INVALID_INPUT`, `Autocore hotel <hotelId> is not reachable with these keys`              |
| Not active    | found, but `is_archived` or `!is_active` → `PROVIDER_INVALID_INPUT`, `Autocore hotel <hotelId> is not active`       |
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
  "source": "xcale",
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

`source` and `hotel_id` come from the context. `email` and `allowed_payment_options` are omitted when absent (never
sent as `null`).

Success (`200`) → `ok(data)`:

```ts
{
  code: string; // body.code, e.g. "k4doiy1k9tex" — the link's id at Autocore, used to read and cancel it
  url: string; // body.url, e.g. "https://app-stg.autocore.pro/payment/xcale_hotel/k4doiy1k9tex" — returned, never built
}
```

`msg` and `reservation_id` (`null` for a link without a reservation) are not returned.

**Never retried.** Autocore creates a second link for a repeated `external_ref_id` (observed) and cannot find a link
by it, so the provider sends the `POST` once. A timeout or network failure is `PROVIDER_UNAVAILABLE`, and a payable
link may exist.

Observed Autocore validation (why the schema is stricter than Autocore):

| Sent                                                       | Autocore                                       | This tool                                                     |
| :--------------------------------------------------------- | :--------------------------------------------- | :------------------------------------------------------------ |
| No `source` (since 2026-11-13)                             | `400` "Campo inválido [source]: Debe indicar…" | Always sent, from the context                                 |
| No `amount` / no `guest_name`                              | `422` `"El campo '<f>' es requerido\n"`        | Refused by the schema, no call                                |
| `amount: 150000.5`                                         | `200`, link created (shows `$150.000,50`)      | Refused by the schema (integer)                               |
| No `currency` / no `description`                           | `200`                                          | Refused by the schema (required)                              |
| `currency: "CRC"` for a COP/USD hotel                      | `200`                                          | Sent; the consumer checks it against the probe's `currencies` |
| `allowed_payment_options: ["nequi"]` for a card-only hotel | `200`                                          | Sent: the hotel's choice                                      |
| No `email`                                                 | `200`                                          | Allowed (optional)                                            |
| `hotel_id` not reached by the keys                         | `404` `"Hotel no encontrado"`                  | `PROVIDER_ERROR`                                              |

### 1.3 `mcp_autocore_deactivate_payment_link`

|                |                                                                                                                                                                                                                                                                                                                                                                                  |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input          | `z.object({ code: z.string().regex(/^[a-z0-9]{1,64}$/) }).strict()` — the link's `code` (a path segment: anything else is refused, not encoded)                                                                                                                                                                                                                                  |
| Autocore calls | 1. `GET /v2/common/transaction-status?hotel_id=<hotelId>&ref_number=<code>&transaction_type=payment_link` — proves the link is the connection's hotel's (another hotel's link answers `404` "Link de pago no identificado", observed); 2. `DELETE /v2/bookings/chatbot/<code>` (undocumented by Autocore; it is what its web app's "Cancelar cobro" calls), which names no hotel |
| Success        | any JSON `2xx` from the DELETE (observed: `200` `{ "msg": "Reserva cancelada correctamente" }`; the body is not read) → `ok({ code, cancelled: true })`                                                                                                                                                                                                                          |
| Failure        | per §2                                                                                                                                                                                                                                                                                                                                                                           |

Observed:

- Idempotent: the same call on a link already cancelled answers the same `200`.
- Afterwards the link's status reads `cancelled`, and its checkout refuses it (`400` "…Estado: Cancelado").
- **A paid link cannot be cancelled:** `404` "El estado de pago actual no permite la cancelación del link de pago",
  and the payment stays `applied` — no refund, no effect. The tool answers `PROVIDER_ERROR` (the 404); the consumer
  re-reads the status and the payment wins.

### 1.4 `mcp_autocore_get_transaction_status`

|                                   |                                                                                                        |
| :-------------------------------- | :----------------------------------------------------------------------------------------------------- |
| Input                             | `z.object({ code: z.string().regex(/^[a-z0-9]{1,64}$/) }).strict()`                                    |
| First call (always)               | `GET /v2/common/transaction-status?hotel_id=<hotelId>&ref_number=<code>&transaction_type=payment_link` |
| Second call (only when `applied`) | `GET /v2/links/schedule/<code>` — the link's own record, without `validate_link_status`                |
| Failure                           | per §2; on the second call too (a paid link never reads as paid without its amount)                    |

The status read carries stable codes but no amount; the link record carries the amount paid but only Spanish labels.
So the status comes from the first, and the amount and currency from the payment in the second whose
`transaction_id` equals the status's. The voucher the docs describe is not used: `voucher_url` is a PDF and
`/v2/transactions/vouchers/detail` answers `400` "No se pudo determinar el ambiente" (observed).

Success → `ok(data)`:

```ts
{
  code: string; // the link's code
  externalRef: string | null; // details.external_ref_id — the caller's reference
  status: string; // details.status_code as sent. Observed: applied, rejected, pending, cancelled. Documented: in_process, error
  transactionId: string | null; // details.transaction_id when applied; "" and "N/A" (a declined attempt) → null; null unless applied
  occurredAt: string | null; // ISO 8601 UTC, the payment's created_at (naive UTC at Autocore); null unless applied
  amount: number | null; // the payment's amount (a decimal string at Autocore, "150000.0"), whole units; null unless applied
  currency: string | null; // the link's currency; null unless applied
}
```

- `status` is a plain string, not a closed union: a state Autocore adds later must not make the read fail.
- **A `rejected` link is not closed:** its checkout offers "Reintentar Pago", so a later read may answer `applied`.
- **A paid link cannot be paid twice** (observed): its checkout shows "Pago exitoso" again.
- An `applied` status whose link record has no payment with that `transaction_id`, or no readable amount, is
  `PROVIDER_ERROR` ("returned an unexpected response") — never a success without an amount.
- Guest and card data in either response (`guest_name`, `email`, `phone`, `comments`, `card_holder`) are dropped.

Observed reads (2026-11-13): a paid link → `applied`, `150000`, `COP`; a pending card that ended approved →
`applied`; a declined card → `rejected`, `transactionId: null`; a pending card that ended declined → `pending`; a
cancelled link → `cancelled`.

---

## 2. Errors

Codes are the core's `ProviderErrorCode` (`src/core/errors.ts:6-15`), assigned by the core's status policy
(`mapHttpStatusToErrorCode`, `src/core/http.ts`) — the same for every provider. No new codes.

Autocore's error body is always `{ "code": 0, "message": "Error http: <n>", "detail": "<free Spanish text>" }`
(observed for 400, 401, 404, 422): no stable code, and `detail` is never propagated.

| Autocore                                                                                | Code                                                        | Message (own, fixed)                                                          |
| :-------------------------------------------------------------------------------------- | :---------------------------------------------------------- | :---------------------------------------------------------------------------- |
| `401` `"Credenciales inválidas"` (observed) / `403`                                     | `PROVIDER_AUTH_EXPIRED`                                     | `Autocore <operation> failed (HTTP 401)`                                      |
| `422` / `400`                                                                           | `PROVIDER_INVALID_INPUT`                                    | `Autocore <operation> failed (HTTP 422)`                                      |
| `404` (`"Hotel no encontrado"`, a paid link's cancel; observed) and any other status    | `PROVIDER_ERROR`                                            | `Autocore <operation> failed (HTTP 404)`                                      |
| `429`                                                                                   | `PROVIDER_RATE_LIMITED`                                     | `Autocore <operation> failed (HTTP 429)`                                      |
| `5xx`, timeout, network                                                                 | `PROVIDER_UNAVAILABLE`                                      | `Autocore <operation> failed (HTTP 5xx)` / `Autocore <operation> unreachable` |
| `2xx` with an unexpected shape                                                          | `PROVIDER_ERROR`                                            | `Autocore <operation> returned an unexpected response`                        |
| Probe: `hotelId` not in the listing                                                     | `PROVIDER_INVALID_INPUT`                                    | `Autocore hotel <hotelId> is not reachable with these keys`                   |
| Probe: the hotel is archived or inactive                                                | `PROVIDER_INVALID_INPUT`                                    | `Autocore hotel <hotelId> is not active`                                      |
| Probe: listing past 20 pages                                                            | `PROVIDER_ERROR`                                            | `Autocore hotel listing too large`                                            |
| Context: `environment` or `source` missing or invalid, `hotelId` not a positive integer | `PROVIDER_INVALID_INPUT`                                    | the core's input validation message (no call)                                 |
| Composed secret without `:`, with an empty part or with `;` in the key                  | `PROVIDER_AUTH_EXPIRED` (the core, before any request; ADR) | `Stored credential is malformed — reconnect the account`                      |

`<operation>` is `check credentials`, `create payment link`, `deactivate payment link` or `get transaction status`.

**Redaction rule (binding).** No Autocore response body, `detail`, `message` or `comments`, no `Auth-Token`, and no
link URL or code beyond what an outcome returns, reaches a tool outcome, an error message or a log line. A test
asserts it with an error body that carries a fake key.

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
    "code": "k4doiy1k9tex",
    "url": "https://app-stg.autocore.pro/payment/xcale_hotel/k4doiy1k9tex"
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

### `mcp_autocore_deactivate_payment_link`

```json
{ "ok": true, "data": { "code": "gmoiew13h8zz", "cancelled": true } }
```

```json
{
  "ok": false,
  "code": "PROVIDER_ERROR",
  "message": "Autocore deactivate payment link failed (HTTP 404)"
}
```

```json
{
  "ok": false,
  "code": "PROVIDER_AUTH_EXPIRED",
  "message": "Autocore deactivate payment link failed (HTTP 401)"
}
```

### `mcp_autocore_get_transaction_status`

```json
{
  "ok": true,
  "data": {
    "code": "k4doiy1k9tex",
    "externalRef": "xcale-s1-exitoso",
    "status": "applied",
    "transactionId": "01a1d831-0895-7184-a158-b543f29a4f2b",
    "occurredAt": "2026-11-14T03:54:15.862Z",
    "amount": 150000,
    "currency": "COP"
  }
}
```

```json
{
  "ok": true,
  "data": {
    "code": "9oe7ql80awol",
    "externalRef": "xcale-s1-declinado",
    "status": "rejected",
    "transactionId": null,
    "occurredAt": null,
    "amount": null,
    "currency": null
  }
}
```

```json
{
  "ok": false,
  "code": "PROVIDER_ERROR",
  "message": "Autocore get transaction status returned an unexpected response"
}
```

---

## 4. Fixtures

From the Staging spike and payments, with no key and placeholders for any personal or company data:

| Fixture                          | Source                                                                                                                       |
| :------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `listHotels.json`                | `GET /v2/hotels` → 200, one hotel (id 5), phone/address/company/commissions replaced by placeholders                         |
| `createPaymentLink.json`         | `POST /v2/links/schedule/` → 200 `{ msg, url, code, reservation_id: null }`                                                  |
| `deactivatePaymentLink.json`     | `DELETE /v2/bookings/chatbot/<code>` → 200 `{ "msg": "Reserva cancelada correctamente" }`                                    |
| `statusApplied.json`             | `GET /v2/common/transaction-status` → 200, `applied` (a paid link)                                                           |
| `statusRejected.json`            | the same → 200, `rejected`, `transaction_id: "N/A"`                                                                          |
| `statusPending.json`             | the same → 200, `pending`, empty `transaction_id` and `transaction_date`                                                     |
| `statusCancelled.json`           | the same → 200, `cancelled`                                                                                                  |
| `linkPaid.json`                  | `GET /v2/links/schedule/<code>` → 200 for the paid link, guest and hotel data replaced                                       |
| `linkRejected.json`              | the same for the declined link (its payment carries `transaction_id: "N/A"`)                                                 |
| `errors/invalidCredentials.json` | 401 `{"code":0,"message":"Error http: 401","detail":"Credenciales inválidas"}`                                               |
| `errors/missingFields.json`      | 422 `{"code":0,"message":"Error http: 422","detail":"El campo 'guest_name' es requerido\nEl campo 'amount' es requerido\n"}` |
| `errors/hotelNotFound.json`      | 404 `{"code":0,"message":"Error http: 404","detail":"Hotel no encontrado"}`                                                  |
| `errors/withFakeKey.json`        | 401 with a fake key inside `detail` (for the redaction test; not observed, constructed)                                      |

---

## 5. Consumer notes (xcale-backend)

Its design: matesjara/xcale-backend#2915, `xcale-backend/docs/design/autocore-gateway/`.

- **Connect:** collect both `fields`, store them composed `access_key:secret_key`, deliver by `reference`; ask
  `hotelId`, `environment` (no default) and `source` (Autocore hands it over with the keys), and call the probe before
  storing. Show `hotel.name`; check the charge currency against `hotel.currencies`.
- **Create:** `amountMinor` → whole units, refusing a fraction; `expiresAt` → `availableHours` rounded down;
  `notificationUrl` is the consumer's webhook, which receives Autocore's unsigned notifications and must confirm each
  with `mcp_autocore_get_transaction_status` before settling. **Never retry a create blindly** — a lost response can
  leave a payable link; its payment still reaches the webhook with `externalRef`.
- **Store `code`**, not just the URL: it is the link's id for reading and cancelling it.
- **Settle from the status read:** `applied` with `amount` and `currency`; `rejected` leaves the request pending (the
  guest may retry on the same link); `pending` / `in_process` → pending; `cancelled` → voided. A paid link cannot be
  paid again, so there is nothing to deactivate after settling.
- **Cancel with `mcp_autocore_deactivate_payment_link`** when a request is cancelled or the gateway disconnected; it is
  idempotent. A paid link answers `PROVIDER_ERROR` (404): re-read the status — the payment wins.
- **Two Autocore reads are public** (observed): a link's status and `GET /v2/links/schedule/<code>`, which returns
  the guest's name, email and phone to anyone with the code. Send Autocore only the guest data a payment needs.

## 6. Roadmap (additive)

| Next                                          | Lifts it                                                                   |
| :-------------------------------------------- | :------------------------------------------------------------------------- |
| `phone`, `countryCode`, `installments` inputs | One observed link with each (the docs disagree on `country_code`'s format) |
| Refunds, the open link                        | A consumer asking                                                          |
