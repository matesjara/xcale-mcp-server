# Wompi Provider — Tool Contract

> **Feature design**: [`feature-design.md`](./feature-design.md) · **Grill**: [`grill-notes.md`](./grill-notes.md) · **Evidence**: [`sandbox-evidence.md`](./sandbox-evidence.md)
> **Last updated**: 2026-10-24
>
> Each `input` is the zod source of truth; the JSON Schema in `tools/list` is generated from it. All schemas are `.strict()`: an undeclared key → `PROVIDER_INVALID_INPUT`.
> Every Wompi value below was observed in the sandbox (2026-10-21/22) unless marked **(documented)**.

---

## 0. Provider

| Field                                        | Value                                                                                                                                                                                           |
| :------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slug                                         | `wompi`                                                                                                                                                                                         |
| Auth                                         | `{ type: 'bearer', credentialDelivery: 'forwarded', fields: [{ key: 'private_key', label: 'Private key', placement: 'header' }] }` → `Authorization: Bearer <prv_test_… \| prv_prod_…>`         |
| Context (`metadataSchema` / `contextSchema`) | `z.object({ publicKey: z.string().regex(/^pub_(test\|prod)_[A-Za-z0-9]+$/) }).strict()`                                                                                                         |
| `accountContextKeys`                         | `['publicKey']`                                                                                                                                                                                 |
| `connectionProbe`                            | `{ tool: 'mcp_wompi_check_credentials' }`                                                                                                                                                       |
| Base URL                                     | From the public key prefix: `pub_test_…` → `https://sandbox.wompi.co/v1` · `pub_prod_…` → `https://production.wompi.co/v1` **(documented)** · any other prefix → refused by the schema, no call |
| Deployment override                          | `createWompiProvider({ baseUrls? })` for tests only                                                                                                                                             |

The environment is read from the public key's prefix inside the provider (`environmentOf`), so the consumer sends only `publicKey` and never maps prefixes itself. The prefix is in the **public** key, which is context; the private key is never inspected. Sandbox prefix verified (2026-10-22); production prefix documented by Wompi. _Changed 2026-10-22 from an optional `environment` context field, after the pre-PR review: it was Wompi knowledge the consumer had to replicate._

---

## 1. Tools

All four are `controlPlane: true`: absent from `tools/list`, callable by name.

### 1.1 `mcp_wompi_check_credentials` (connection probe)

|            |                                                                     |
| :--------- | :------------------------------------------------------------------ |
| Input      | `z.object({}).strict()`                                             |
| Wompi call | `GET /transactions?reference=xcale-connection-probe`                |
| Success    | `ok({ valid: true })` (Wompi answered `200 { data: [], meta: {} }`) |
| Failure    | 401/403 → `PROVIDER_AUTH_EXPIRED`; others per §2                    |

### 1.2 `mcp_wompi_create_payment_link`

Input:

```ts
z.object({
  name: z.string().min(1).max(200), // shown on the checkout page
  description: z.string().min(1).max(500), // REQUIRED by Wompi (422 without it)
  amountInCents: z.number().int().positive(),
  currency: z.literal('COP'),
  expiresAt: z.string().datetime(), // ISO 8601 UTC
  sku: z.string().min(1).max(64), // consumer's own reference; Wompi stores it as-is
}).strict();
```

Wompi call: `POST /payment_links`

```json
{
  "name": "<name>",
  "description": "<description>",
  "single_use": true,
  "collect_shipping": false,
  "currency": "COP",
  "amount_in_cents": 15000000,
  "expires_at": "2026-10-24T14:36:01.000Z",
  "sku": "<sku>"
}
```

Success (`201`) → `ok(data)`:

```ts
{
  linkId: string; // data.id, e.g. "test_XGd2UH" in sandbox
  url: string; // built: `https://checkout.wompi.co/l/${linkId}` (Wompi does not return it)
  expiresAt: string; // data.expires_at
  active: boolean; // data.active (true)
}
```

Failures: `422 INPUT_VALIDATION_ERROR` (e.g. no `description`) and `422 UNPROCESSABLE` (e.g. below COP 1.500: `amount_in_cents < 150000`) → `PROVIDER_INVALID_INPUT`. The provider does not enforce the minimum; the consumer does.

Note: `single_use: true` does **not** stop a second payment after an approved one (verified). The consumer deactivates the link when it settles.

### 1.3 `mcp_wompi_deactivate_payment_link`

> **One core change: adding `'PATCH'` to `HttpMethod`** (`src/core/auth/http-request.ts`), following the Cloudbeds `DELETE` precedent (commit `7b7a3bc`). The core transported `GET | POST | PUT | DELETE`, and Wompi answers `404` to `PUT /payment_links/{id}` (verified): only `PATCH` deactivates. The change ships in the provider's build branch as **its own commit** (`feat(core): transport PATCH`), the way `DELETE` entered the core inside the Cloudbeds commit that needed it, and the provider PR carries a "Touches the core" section. See `work-log.md`.

|            |                                                                                                                                    |
| :--------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| Input      | `z.object({ linkId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }).strict()` (a path segment: anything else is refused, not encoded) |
| Wompi call | `PATCH /payment_links/{linkId}` with `{ "active": false }`                                                                         |
| Success    | `ok({ linkId, active: false })` (Wompi `200`, `data.active: false`)                                                                |
| Failure    | per §2 (`404` for an unknown link → `PROVIDER_ERROR`, the core's policy)                                                           |

### 1.4 `mcp_wompi_list_transactions`

Input:

```ts
z.object({
  fromDate: z.string().datetime(), // ISO 8601 UTC, inclusive
  untilDate: z.string().datetime(), // ISO 8601 UTC; must be after fromDate
}).strict();
```

Wompi call: `GET /transactions?from_date=<fromDate>&until_date=<untilDate>&page=<n>&page_size=200`, repeated with `page=n+1` until `n * 200 >= meta.total_results`, **at most 50 pages** (10,000 transactions). If the window holds more, the tool returns `PROVIDER_ERROR` (`Wompi transaction window too large; narrow fromDate/untilDate`) instead of a partial list, so the consumer never settles from an incomplete page. `untilDate` must be after `fromDate` (`PROVIDER_INVALID_INPUT` otherwise, no call).

**An empty window comes back as `{ "data": [], "meta": {} }`**, with no `total_results` (verified, `sandbox-evidence.md`). It is handled as zero results: `ok({ transactions: [] })`. A page that carries transactions but no `total_results` cannot say whether more pages follow, so it is `PROVIDER_ERROR` (`Wompi list transactions returned an unexpected response`).

Success → `ok({ transactions: WompiTransaction[] })`:

```ts
interface WompiTransaction {
  id: string; // "11977675-1792680357-70475"
  paymentLinkId: string | null; // payment_link_id; null when not from a link
  status: string; // passed through as Wompi sends it. Observed: APPROVED, DECLINED; documented: PENDING, ERROR, VOIDED. Settlement acts on APPROVED
  amountInCents: number;
  currency: string; // "COP"
  createdAt: string; // ISO 8601 UTC
  finalizedAt: string | null; // ISO 8601 UTC
}
```

`status` is a plain string, not a closed union: a state Wompi adds later must not make the whole window unreadable.

Payer data (`customer_email`, `customer_data`, `billing_data`, `shipping_address`, `payment_method`) is **dropped**. The listing returns **all** of the merchant's transactions in the window. Wompi ignores a `payment_link_id` filter (verified), so the consumer filters by link.

---

## 2. Errors

Codes are the core's `ProviderErrorCode` (`src/core/errors.ts:6-15`), assigned by the core's status policy (`mapHttpStatusToErrorCode`, `src/core/http.ts`) — the same for every provider. No new codes.

| Wompi                                            | Code                     | Message (own, fixed)                                                    |
| :----------------------------------------------- | :----------------------- | :---------------------------------------------------------------------- |
| `401` / `403` (`INVALID_ACCESS_TOKEN`, observed) | `PROVIDER_AUTH_EXPIRED`  | `Wompi <operation> failed (HTTP 401)`                                   |
| `422` / `400`                                    | `PROVIDER_INVALID_INPUT` | `Wompi <operation> failed (HTTP 422)`                                   |
| `404` and any other status                       | `PROVIDER_ERROR`         | `Wompi <operation> failed (HTTP 404)`                                   |
| `429`                                            | `PROVIDER_RATE_LIMITED`  | `Wompi <operation> failed (HTTP 429)`                                   |
| `5xx`, timeout, network                          | `PROVIDER_UNAVAILABLE`   | `Wompi <operation> failed (HTTP 5xx)` / `Wompi <operation> unreachable` |
| `2xx` with an unexpected shape                   | `PROVIDER_ERROR`         | `Wompi <operation> returned an unexpected response`                     |
| Listing window over 50 pages                     | `PROVIDER_ERROR`         | `Wompi transaction window too large; narrow fromDate/untilDate`         |
| `publicKey` with an unknown prefix               | `PROVIDER_INVALID_INPUT` | the core's input validation message                                     |

**Redaction rule (binding).** Wompi's error bodies repeat the key they received (observed: `"…se recibió: prv_test_…"`). The provider **never** puts a Wompi response body, `reason` or `messages` into a tool outcome, an error message or a log line. A test asserts it.

---

## 3. Fixtures

From the spike, with keys removed and payer data replaced by placeholders:

| Fixture                          | Source                                                                                         |
| :------------------------------- | :--------------------------------------------------------------------------------------------- |
| `createPaymentLink.json`         | `POST /payment_links` → 201                                                                    |
| `deactivatePaymentLink.json`     | `PATCH /payment_links/{id}` → 200                                                              |
| `listTransactions.json`          | `GET /transactions?from_date…` → 200 (one `DECLINED`, one `APPROVED`, same `payment_link_id`)  |
| `probeEmpty.json`                | `GET /transactions?reference=…` → 200 `{ data: [], meta: {} }` (also the empty listing window) |
| `errors/invalidAccessToken.json` | 401, with a fake key inside `reason` (for the redaction test)                                  |
| `errors/missingDescription.json` | 422 `INPUT_VALIDATION_ERROR`                                                                   |
| `errors/belowMinimum.json`       | 422 `UNPROCESSABLE` (minimum text)                                                             |
