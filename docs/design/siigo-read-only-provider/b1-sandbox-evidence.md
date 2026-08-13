# Siigo — B1 Sandbox Evidence (Observed facts)

> **Run:** 2026-08-13, against the real Siigo **public** sandbox (`https://api.siigo.com`) with the
> `sandbox@siigoapi.com` API user + `Partner-Id: EcomerceCG`. Captured by a throwaway verification
> script (env-fed credentials; tokens/PII redacted). This is the **auditable evidence** the API
> contract (B2) cites. Every value below is **Observed** (a real request/response), not documented or
> inferred. Values are reproduced by shape; secrets and customer PII are redacted.

## 0. Flavor resolved — **Flavor A (public API)**, not Flavor B (alliance)

The sandbox-verification's core ambiguity is settled: xcale's sandbox credential authenticates against
the **public** surface, not the alliance one.

| Datum | Observed value |
|:--|:--|
| Base URL | `https://api.siigo.com` |
| Auth path + method | `POST /auth` |
| Auth body keys (wire) | `{ "username": "<user>", "access_key": "<key>" }` — **snake_case** |
| (Flavor B was NOT used) | `services.siigo.com/alliances/api` + `/siigoapi-users/v1/sign-in` + `userName`/`accessKey` → not exercised; the SDK-confirmed hypothesis lost to Observed |

Gateway: responses carry `x-krakend: Version 2.13.8` (Siigo fronts the API with KrakenD).

## 1. Auth response

`POST https://api.siigo.com/auth` → **200**

```json
{ "access_token": "<JWT, ~1399 chars, redacted>", "expires_in": 86400, "token_type": "Bearer", "scope": "SiigoAPI" }
```

- Token field: **`access_token`** · Expiry field: **`expires_in`** = **86400** (24h TTL) · `token_type: "Bearer"` (→ `bearer_header`).
- **`Partner-Id` is NOT required on `/auth`**: the auth call returns 200 **with or without** the header (both captured). → **a mint (`/auth`) does NOT validate `Partner-Id`.**

## 2. `Partner-Id` — required on DATA endpoints only

`GET /v1/customers` **without** `Partner-Id` → **400**

```json
{ "Status": 400, "Errors": [ { "Code": "header_required", "Message": "The header Partner-Id is required", "Params": ["Partner-Id"], "Detail": "https://developer.siigo.com/...header_required" } ] }
```

**Consequence (design-relevant):** because the token endpoint ignores `Partner-Id` but data endpoints
require it, connect's "mint once" gate proves the *credential* but **not** the deployment `Partner-Id`.
A wrong `Partner-Id` passes connect and fails every data call. (See B3.3 design note.)

## 3. List envelope — uniform across customers / invoices / products

`GET /v1/{customers|invoices|products}?page=<n>&page_size=<n>` → **200**

```json
{ "pagination": { "page": 1, "page_size": 25, "total_results": 82167 },
  "results": [ /* provider records, verbatim */ ],
  "_links": { "self": {"href": "..."}, "next": {"href": "..."}, "previous": {"href": "..."} } }
```

- Results field: **`results`** · pagination envelope: **`pagination.{page, page_size, total_results}`** · HATEOAS **`_links.{self,next,previous}`** (previous absent on page 1).
- Confirmed uniform: customers, invoices, and products all return this exact envelope.

## 4. Pagination behavior (Observed)

| Request | `results.length` | `pagination.page_size` |
|:--|:--:|:--:|
| `?page=1&page_size=50` | 50 | 50 |
| `?page=1&page_size=3` | 10 | 10 |
| `?page=1&pageSize=3` (camelCase) | 25 | 25 |
| (no size param) | 25 (default) | 25 |

- Correct param is **`page_size`** (snake_case). `page` is **1-based** (page 1 vs page 2 return disjoint sets).
- **Minimum page_size = 10** (a requested `3` is clamped up to `10`). `50` is honored (max not probed).
- **Default page_size = 25** (when the param is absent or misspelled, e.g. camelCase `pageSize` is ignored).

## 5. Rate limits (Q-4)

- Siigo **does** rate-limit: a burst of ~5 rapid calls returned **429**. No `Retry-After`/`X-RateLimit-*`
  headers were exposed on the 200 responses; a ~20s cooldown cleared the 429. Treat 429 as a
  retryable/backoff condition; no documented header budget observed.

## 6. Read resource paths + get-by-id shape

- **List:** `GET /v1/customers`, `GET /v1/invoices`, `GET /v1/products` — all **200**, envelope §3.
- **Get-by-id (customers, Observed):** `GET /v1/customers/{id}` where `{id}` is a **UUID**
  (e.g. `556cad10-…`) → **200**, returns the resource object **directly (no list envelope)**.
  Customer top-level keys: `id, type, person_type, id_type, identification, branch_office, check_digit,
  name, active, vat_responsible, fiscal_responsibilities, address, phones, contacts, metadata`.
- **Get-by-id (invoices/products):** **NOT directly exercised** in B1 — the `/v1/{resource}/{id}` shape is
  inferred by analogy from the customers by-id capture; confirm on first B3 integration touch. (Invoice
  records carry a UUID `id` and a separate `document.id` integer; products carry a UUID `id`.)

## 7. Company → credential cardinality (Q-9) — leans single-company

- The `/auth` response carries **no company list** (only `access_token/expires_in/token_type/scope`);
  `scope` is the constant `"SiigoAPI"`, not a company/tenant identifier.
- **No data endpoint accepted or required a `companyId`/NIT selector** — customers, invoices, and
  products all returned the account's data with no company dimension in the request.
- The `identification`/NIT fields inside records are the **customer's** NIT, not the account's.
- **Falsifier (multi-NIT reach or a company selector) did NOT trigger** → the "one credential = one
  company/NIT, **no `contextSchema`**" shape holds. (Residual: not *disproven* that one key could reach a
  second company, but the API exposes no company dimension at all — strong single-company evidence.)

## 8. Reference-data endpoints (Phase 1a) — Observed 2026-08-13

Probed live against the same sandbox for the read-expansion (Phase 1a). **Key finding: most
reference-data endpoints return a FLAT ARRAY, not the `{ pagination, results }` envelope** — and two
require a filter param. `list_taxes`/`list_account_groups`/`list_payment_types` returned a transient
`500 unhandled_error` on first hit and a clean `200` on retry (a sandbox hiccup, not a param issue —
treat 500 as retryable).

| Tool | Path | Response | Required param |
|:--|:--|:--|:--|
| `list_taxes` | `GET /v1/taxes` | flat array — `id, name, type, percentage, active` | — |
| `list_account_groups` | `GET /v1/account-groups` | flat array — `id, name, active` | — |
| `list_price_lists` | `GET /v1/price-lists` | flat array — `id, name, active, position` | — |
| `list_cost_centers` | `GET /v1/cost-centers` | flat array — `id, code, name, active` | — |
| `list_warehouses` | `GET /v1/warehouses` | flat array — `id, name, active, has_movements` | — |
| `list_users` | `GET /v1/users?page&page_size` | **envelope** `{pagination,results}` — `id, username, first_name, last_name, email, identification, active` | (paginated) |
| `list_document_types` | `GET /v1/document-types?type={type}` | flat array — `id, code, name, type, active, …` | **`type`** (e.g. `FV`) → 400 `parameter_required` without it |
| `list_payment_types` | `GET /v1/payment-types?document_type={dt}` | flat array — `id, name, type, active, due_date` | **`document_type`** (e.g. `FV`) → 400 without it |

## 9. Additional read resources (Phase 1b) — Observed 2026-08-13

Probed live for the read-resource expansion. **All 5 return the standard `{ pagination, results, _links }`
envelope** (same as customers/invoices/products), with full records in `results` — so a paginated
`list_*` is the record; no `get_*` companion is needed.

| Tool | Path | Response | total (sandbox) |
|:--|:--|:--|:--|
| `list_purchases` | `GET /v1/purchases?page&page_size` | envelope — `id, document, number, date, supplier, total, balance, items, retentions, payments` | 7,957 |
| `list_credit_notes` | `GET /v1/credit-notes?page&page_size` | envelope — `id, document, number, date, invoice, customer, seller, total, items, payments` | 3,161 |
| `list_vouchers` | `GET /v1/vouchers?page&page_size` | envelope — `id, document, number, date, type, customer, items, payment` | 2,867 |
| `list_journals` | `GET /v1/journals?page&page_size` | envelope — `id, document, number, date, items, observations` | 3,627 |
| `list_quotations` | `GET /v1/quotations?page&page_size` | envelope — `id, document, number, date, customer, seller, total, items, public_url` | 205 |

## 10. Write-path probe (Slice 2 prep) — Observed 2026-08-13 — ZERO MUTATIONS

Probed the write-path architectural questions **without creating any document** (reads + empty POSTs
whose `400` reveals required fields but persists nothing). Answers the grill's write-probe checklist.

| Probe-need | Observed | Verdict |
|:--|:--|:--|
| Customers filterable by NIT (create_customer dedup) | `GET /v1/customers?identification=800212240` → 200, `total=1` | ✅ cheap NIT lookup works |
| Invoices cheaply filterable (stuck-pending recovery read) | `GET /v1/invoices?created_start=2026-08-13` → `total=2` (vs 110,135 unfiltered) | ✅ **date-filter works** → targeted recovery read is VIABLE |
| Client idempotency key on create | empty `POST /v1/invoices` → 400 `parameter_required: document` (no idempotency-key field) | ✅ **no client idempotency key** (at-most-once confirmed) |
| `create_invoice` required fields | first required = **`document`** (the document-type reference) | partial — full chain deferred to write api-contract (iterative 400-probe, rate-limited) |
| `credit-note` required fields | first required = **`document`** too | partial — confirm target-invoice-DIAN-id dependency in contract step |
| `create_customer` required fields | first required = **`name`** | partial |
| tercero carries an `observations`/reference field | B1 §6: customer objects have NO `observations` field | ✅ → `create_customer` does NOT exercise the reconciliation seam (grill caveat confirmed) |
| tercero reversibility | B1 §6: customers carry `active` → deactivatable in place | ✅ non-fiscal, correctable |
| `observations` round-trips on invoices | B1 §3: invoice `observations` carries caller refs verbatim ("Pedido … #1", "Ref. INV-2-…") | ✅ round-trips + is returned |
| 429 write-burst behavior | `429 requests_limit` with a **"Try again in N seconds"** hint in the message | ✅ retry-after is in the body |

**Architectural conclusion:** idempotency **option "a"** (consumer-local ledger + *targeted* reconciliation
read on the `observations` tag) is **Observed-viable** — invoices are date-filterable, so recovery scans a
narrow window, never the full ~110k table. The grill's probe-gate is lifted.

## Evidence provenance

Throwaway scripts (scratchpad, not committed; credentials fed via env, never in source):
`siigo-b1-verify.mjs` (main checklist) + `siigo-b1-probe2.mjs` (pagination/rate-limit follow-up).
Redacted raw capture (`siigo-b1-evidence.json`) held in the session scratchpad; the facts above are the
durable record.
