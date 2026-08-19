# Siigo Read-Only Provider — API Contract

> **Module**: `src/providers/siigo/` (xcale-mcp-server) + Siigo registration in `xcale-backend`.
> **Kind**: External-provider adapter contract (NOT an internal `/api/v1` REST module). It documents
> three wire surfaces: (A) the **Siigo external API** as Observed, (B) the **`credential_exchange`
> authDescriptor** (concrete), (C) the **MCP tool contract** the provider publishes. The backend
> Credential-Authority resolve wire (Phase A) is referenced, not re-specified.
> **Upstream**: [feature-design.md](feature-design.md) · [traceability-matrix.md](traceability-matrix.md) ·
> [b1-sandbox-evidence.md](b1-sandbox-evidence.md) · [implementation-plan.md](implementation-plan.md).
> **Status**: Frozen for B3. **Every concrete value below is Observed** (B1, 2026-08-13) unless a row is
> explicitly marked **Inferred**. Last updated: 2026-08-13.

> **🔬 Evidence discipline.** This contract is descriptive, not speculative. Each value traces to
> `b1-sandbox-evidence.md`. The only non-Observed items are the two `get_*` by-id paths for invoices and
> products (marked **Inferred**) — confirmed on first B3 integration touch, never assumed as Observed.

---

## 0. Resolved facts at a glance (the deltas from the pre-B1 hypotheses)

| Datum | Pre-B1 leading hypothesis | **Observed (B1)** |
|:--|:--|:--|
| API flavor / base URL | Flavor B — `services.siigo.com/alliances/api` (SDK) | **Flavor A — `https://api.siigo.com`** |
| Auth path | `POST /siigoapi-users/v1/sign-in` | **`POST /auth`** |
| Auth body keys | `userName` / `accessKey` (camel) | **`username` / `access_key`** (snake) |
| Token / expiry | `access_token` / `expires_in`? | **`access_token` / `expires_in` = 86400** (24h) |
| `Partner-Id` on `/auth` | required (docs) | **NOT required on `/auth`; REQUIRED on data** |
| `contextSchema` | pending (AD-7 hypothesis) | **not needed** — 1 credential = 1 company/NIT |

---

## A. Siigo External API — Observed wire surface

### A.1 Base + transport

| Property | Value |
|:--|:--|
| Base URL | `https://api.siigo.com` |
| Content-Type | `application/json; charset=utf-8` |
| Gateway | KrakenD (`x-krakend` response header) — informational |
| TLS | HTTPS only |

### A.2 Authentication (mint) — `POST /auth`

**Request**

```http
POST https://api.siigo.com/auth
Content-Type: application/json
Partner-Id: <deployment value>          // optional on /auth (200 with or without); sent for uniformity
```
```json
{ "username": "<API user>", "access_key": "<API access key>" }
```

**Response `200`**

```json
{
  "access_token": "<JWT>",   // Bearer JWT, ~1400 chars
  "expires_in": 86400,        // seconds → 24h TTL
  "token_type": "Bearer",
  "scope": "SiigoAPI"         // constant; NOT a company/tenant identifier
}
```

- Token field: **`access_token`** · Expiry field: **`expires_in`** (seconds) · Placement: **`Authorization: Bearer <access_token>`**.
- The JWT is reusable for ~24h (Rail A caches it; re-mint near expiry only).

### A.3 Data endpoints (read)

Every data request MUST carry **both** headers:

```http
Authorization: Bearer <access_token>
Partner-Id: <deployment value>          // REQUIRED — 400 header_required if missing
```

| Operation | Method + Path | Response |
|:--|:--|:--|
| List customers | `GET /v1/customers?page={n}&page_size={n}` | List envelope (A.4) |
| Get customer | `GET /v1/customers/{id}` (`id` = UUID) | Resource object directly (no envelope) |
| List invoices | `GET /v1/invoices?page={n}&page_size={n}` | List envelope (A.4) |
| Get invoice | `GET /v1/invoices/{id}` (`id` = UUID) | Resource object *(**Inferred** — confirm in B3)* |
| List products | `GET /v1/products?page={n}&page_size={n}` | List envelope (A.4) |
| Get product | `GET /v1/products/{id}` (`id` = UUID) | Resource object *(**Inferred** — confirm in B3)* |

### A.4 List envelope (uniform across customers / invoices / products)

```jsonc
{
  "pagination": { "page": 1, "page_size": 25, "total_results": 82167 },
  "results": [ /* provider records, returned VERBATIM (Fidelity over Unification) */ ],
  "_links": {
    "self":     { "href": "https://api.siigo.com/v1/customers?page=1&page_size=25" },
    "next":     { "href": "..." },   // absent on last page
    "previous": { "href": "..." }    // absent on page 1
  }
}
```

### A.5 Pagination (Observed)

| Param | Type | Rule |
|:--|:--|:--|
| `page` | int, 1-based | Page number. `page=1`/`page=2` return disjoint sets. |
| `page_size` | int | **Default 25** (when absent/misspelled). **Minimum 10** (a smaller value is clamped up to 10). `50` honored (max not probed). Correct spelling is snake_case `page_size`; camelCase `pageSize` is ignored → falls back to default 25. |

### A.6 Error envelope (Observed)

```jsonc
{
  "Status": 401,                         // int, mirrors HTTP status (capital S)
  "Errors": [                            // array (capital E)
    { "Code": "unauthorized",            // machine code
      "Message": "Verify the authorization header: the token may be invalid or expired...",
      "Params": [],                      // e.g. ["Partner-Id"] for header_required
      "Detail": "https://developer.siigo.com/.../unauthorized" }
  ]
}
```

| HTTP | `Errors[0].Code` | Trigger (Observed) |
|:--|:--|:--|
| `400` | `header_required` | Missing `Partner-Id` on a data endpoint (`Params: ["Partner-Id"]`) |
| `401` | `unauthorized` | Invalid/expired Bearer token |
| `429` | *(not captured)* | Rate limit under burst (~5 rapid calls); ~20s cooldown clears it; no `Retry-After`/`X-RateLimit-*` headers observed |

---

## B. `credential_exchange` authDescriptor (concrete — published in catalog, non-secret)

Fills the Feature Design §7 descriptor with Observed values. Strictly declarative (no code).

```ts
// src/providers/siigo/auth.ts — the descriptor (shape per src/core/provider-port.ts)
{
  type: 'credential_exchange',
  tokenEndpoint: 'https://api.siigo.com/auth',
  method: 'POST',
  // logical → wire. LOGICAL keys are the contract: connect MUST persist credentialSecret
  // as JSON with exactly these keys; resolve reads them (credential-resolve.service → mintCredentialExchange).
  bodyFields: { username: 'username', access_key: 'access_key' },
  responseFields: { token: 'access_token', expiry: 'expires_in' },
  staticHeaders: [ { name: 'Partner-Id', source: 'deployment' } ],
  tokenPlacement: 'bearer_header',
}
```

| Field | Value | Source |
|:--|:--|:--|
| `tokenEndpoint` | `https://api.siigo.com/auth` | Observed A.2 |
| `method` | `POST` | Observed |
| `bodyFields` (logical→wire) | `{ username: 'username', access_key: 'access_key' }` | Observed A.2 |
| `responseFields` | `{ token: 'access_token', expiry: 'expires_in' }` | Observed A.2 |
| `staticHeaders` | `[{ name: 'Partner-Id', source: 'deployment' }]` | Observed (required on data) + AD-6 |
| `tokenPlacement` | `bearer_header` | Observed (`token_type: "Bearer"`) |

> **credentialSecret JSON-shape contract (cross-repo, MUST hold).** Backend `connect` persists
> `credentialSecret` as `{ "username": "<user>", "access_key": "<key>" }` — keys **equal** the descriptor's
> `bodyFields` LOGICAL names. `resolve` (`credential-resolve.service.ts` → `mintCredentialExchange`,
> `credential-exchange.ts`) reads `credentialValues[logical]` and throws `missing credential value for
> field "X"` on any mismatch. Both sides MUST read the ONE backend descriptor. A B3.3 golden test pins
> these keys + `tokenEndpoint` host across `siigo/auth.ts` and the backend mirror.

> **Partner-Id on BOTH legs (B3 wiring requirement).** `Partner-Id` (deployment config, `source:
> 'deployment'`) must be applied on **the mint** (backend `credential-exchange` executor — already applies
> `staticHeaders`) **AND on every data call** (mcp-server egress — Observed 400 without it). B3 MUST ensure
> the mcp-server side has the `Partner-Id` deployment value and attaches it to Siigo data requests
> (via the materializer's `staticHeaders` application or the provider client), or every data call fails
> `400 header_required`. Value in sandbox: `EcomerceCG` (alt `BivooRetailSuite`).

> **Partner-Id validation boundary (design note, from B1).** A mint (`/auth`) 200s **without** a valid
> `Partner-Id`, so connect's mint-once gate validates the **credential** but NOT the deployment
> `Partner-Id`. A wrong `Partner-Id` passes connect and fails every data call with `400 header_required`.
> `Partner-Id` is deployment-wide config (identical for all Siigo connections), so its correctness is a
> **deployment smoke-test** concern, not a per-connect data-probe. Connect stays "mint-once, no data-probe".

---

## C. MCP Tool Contract (the provider's published surface)

Curated read-only set (locked in B0-internal). **Fidelity over Unification governs the records, never
the envelope** (ADR `canonical-provider-pattern` §2/§4): each paginated list tool returns the uniform
`PaginatedResult` envelope (`items`, `page`, `pageSize`, `totalResults`, `hasMore`) with every item —
and every get result — the Siigo record **verbatim** (no mapper, no canonical DTO, no hand-written
output schema). Siigo's `_links` is dropped: paging is consumer-controlled via `page`/`pageSize`. The
only provider-specific logic is the request (path + params), the A.4→`PaginatedResult` unwrap, and
error mapping.

Uniform input for list tools is `page`/`pageSize` (mapped to the wire `page`/`page_size`); `id` for get tools.

| Tool | Input | Wire call | Output `data` |
|:--|:--|:--|:--|
| `mcp_siigo_list_customers` | `{ page?: number = 1, pageSize?: number = 25 }` | `GET /v1/customers?page&page_size` | `PaginatedResult` (items = A.4 `results`, verbatim) |
| `mcp_siigo_get_customer` | `{ id: string /* UUID */ }` | `GET /v1/customers/{id}` | Verbatim customer object |
| `mcp_siigo_list_invoices` | `{ page?: number = 1, pageSize?: number = 25 }` | `GET /v1/invoices?page&page_size` | `PaginatedResult` (items verbatim) |
| `mcp_siigo_get_invoice` | `{ id: string /* UUID */ }` | `GET /v1/invoices/{id}` | Verbatim invoice object *(Inferred path)* |
| `mcp_siigo_list_products` | `{ page?: number = 1, pageSize?: number = 25 }` | `GET /v1/products?page&page_size` | `PaginatedResult` (items verbatim) |
| `mcp_siigo_get_product` | `{ id: string /* UUID */ }` | `GET /v1/products/{id}` | Verbatim product object *(Inferred path)* |

### C.1 Input schema rules (zod, single-source per canonical-provider-pattern)

```ts
// list tools — the core's shared paginationInput (ADR canonical-provider-pattern §2)
{ page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(25) }
// get tools
{ id: z.string().min(1) }  // Siigo resource id is a UUID
```

- `pageSize` maps to wire `page_size`. Values <10 are clamped UP to 10 by Siigo (Observed) — the
  envelope echoes the caller's requested `pageSize`, so a sub-10 request may carry more items than it
  asked for (documented per tool, not second-guessed here).
- **No `contextSchema`** (Observed: one credential = one company/NIT; no `companyId` selector on any endpoint).

### C.2 Output

No output schema is declared (Fidelity over Unification). Paginated list tools return the uniform
`PaginatedResult` envelope — `items` (each Siigo record verbatim), `page`, `pageSize`,
`totalResults` (from A.4 `pagination.total_results`), `hasMore` — so the agent can page; get tools
return the resource object verbatim.

---

## D. Error mapping (Siigo → `ProviderErrorCode`)

Reuse `mapHttpStatusToErrorCode` (`src/core/http.ts`); no change to the `ProviderErrorCode` set (AD-9).

| Siigo HTTP | Siigo `Code` | Maps to | Ownership |
|:--|:--|:--|:--|
| `401` | `unauthorized` | `PROVIDER_AUTH_EXPIRED` | Provider-owned → reconnect prompt (the resolve-time mint failure path also yields this) |
| `400` | `header_required` (Partner-Id) | `PROVIDER_BAD_REQUEST` (or nearest) | Config/ops error — surfaces as a tool failure; deployment smoke-test catches the root cause |
| `403` | *(unobserved)* | `PROVIDER_FORBIDDEN` | Provider-owned |
| `404` | *(unobserved)* | `PROVIDER_NOT_FOUND` | e.g. get-by-id with unknown id |
| `429` | *(unobserved body)* | rate-limit / retryable | Back off; Rail A already caches the JWT to avoid mint bursts |
| `5xx` | — | `PROVIDER_UNAVAILABLE` | Provider-owned |

> The error-ownership boundary (Feature Design §6.3/6.4) is unchanged: **resolve-time** mint failure →
> `PROVIDER_AUTH_EXPIRED` (no `ToolResult`); **reference/transport** failure → transport layer, retry once
> at the emitter, never a `ProviderErrorCode`.

---

## E. Backend resolve wire (Phase A — referenced, not re-specified)

The `reference` resolution path already exists (Phase A, in `dev`). For completeness:

- Emit: backend sends a single-use ephemeral reference (nonce, ≤60s TTL) in `X-Provider-Token` for
  `credentialDelivery: reference` providers *(B4 — emitter still to build in `mcp-tool-executor`)*.
- Resolve: mcp-server `ReferenceCredentialResolver` → `POST /internal/credentials/resolve` (Hop-B auth)
  → backend validates the reference (single-use, unexpired), mints/reuses the 24h JWT, returns it. The
  resolver **throws typed and never retries** (`ReferenceResolutionError` / `ReferenceAuthExpiredError`
  → `PROVIDER_AUTH_EXPIRED`); the single retry lives at the B4 emitter.

See `implementation-plan.md` (A.2, B4) and ADR `credential-delivery-strategies` for the full mechanism.

---

## F. Fixtures / mock data (for B3 TDD — shapes from B1)

Store under `src/providers/siigo/__fixtures__/`. Minimum set (≥3 scenarios per Agentic rules):

1. **auth-200.json** — `{ access_token, expires_in: 86400, token_type: "Bearer", scope: "SiigoAPI" }`.
2. **customers-list-200.json** — `{ pagination: { page:1, page_size:25, total_results:82167 }, results: [ {customer…} ], _links: { self, next } }`. Customer keys: `id, type, person_type, id_type{code,name}, identification, branch_office, check_digit, name[], active, vat_responsible, fiscal_responsibilities[], address, phones[], contacts[], metadata{created}`.
3. **customer-get-200.json** — a single customer object (same keys, no envelope).
4. **invoices-list-200.json** — invoice keys: `id, document{id}, number, name, date, customer{id,identification,branch_office}, seller, total, balance, observations, items[]{id,code,quantity,price,description,taxes[],total}, payments[], mail{status}, metadata, public_url`.
5. **products-list-200.json** — product keys: `id, code, name, account_group{id,name}, type, stock_control, active, tax_classification, tax_included, unit{code,name}, prices[]?, taxes[]?, available_quantity, warehouses[], metadata{created}`.
6. **error-401.json** — `{ Status:401, Errors:[{ Code:"unauthorized", Message, Params:[], Detail }] }`.
7. **error-400-partner-id.json** — `{ Status:400, Errors:[{ Code:"header_required", Message:"The header Partner-Id is required", Params:["Partner-Id"], Detail }] }`.

---

## C.3 Reference-data reads (Phase 1a — added 2026-08-13, Observed)

The lookups an accounting agent needs (and the future write path consumes). Same error map.
**Observed distinction: most return a FLAT ARRAY, not the list envelope** — returned verbatim (no
upstream pagination to represent) — while `list_users`, the only paginated one, wraps into
`PaginatedResult` like every paginated list; `list_document_types`/`list_payment_types` require a
filter. Evidence: [`b1-sandbox-evidence.md`](b1-sandbox-evidence.md) §8.

| Tool | Input | Wire call | Output `data` |
|:--|:--|:--|:--|
| `mcp_siigo_list_taxes` | `{}` | `GET /v1/taxes` | flat array (verbatim) |
| `mcp_siigo_list_account_groups` | `{}` | `GET /v1/account-groups` | flat array |
| `mcp_siigo_list_price_lists` | `{}` | `GET /v1/price-lists` | flat array |
| `mcp_siigo_list_cost_centers` | `{}` | `GET /v1/cost-centers` | flat array |
| `mcp_siigo_list_warehouses` | `{}` | `GET /v1/warehouses` | flat array |
| `mcp_siigo_list_users` | `{ page?, pageSize? }` | `GET /v1/users?page&page_size` | `PaginatedResult` (items verbatim) |
| `mcp_siigo_list_document_types` | `{ type: string }` (required) | `GET /v1/document-types?type=` | flat array |
| `mcp_siigo_list_payment_types` | `{ documentType: string }` (required) | `GET /v1/payment-types?document_type=` | flat array |

## C.4 Additional read resources (Phase 1b — added 2026-08-13, Observed)

Broader accounting context. Same error map. **Observed: all 5 return the standard
`{ pagination, results, _links }` envelope with full records** — so a paginated `list_*` is the record
(no `get_*` companion). Each wraps into the uniform `PaginatedResult` envelope, items verbatim.
Evidence: [`b1-sandbox-evidence.md`](b1-sandbox-evidence.md) §9.

| Tool | Input | Wire call |
|:--|:--|:--|
| `mcp_siigo_list_purchases` | `{ page?, pageSize? }` | `GET /v1/purchases?page&page_size` |
| `mcp_siigo_list_credit_notes` | `{ page?, pageSize? }` | `GET /v1/credit-notes?page&page_size` |
| `mcp_siigo_list_vouchers` | `{ page?, pageSize? }` | `GET /v1/vouchers?page&page_size` |
| `mcp_siigo_list_journals` | `{ page?, pageSize? }` | `GET /v1/journals?page&page_size` |
| `mcp_siigo_list_quotations` | `{ page?, pageSize? }` | `GET /v1/quotations?page&page_size` |

Siigo now exposes **19 read tools** (6 resource list/get + 8 reference-data + 5 additional resources).

## G. Roadmap

| Phase | Scope | Contract impact |
|:--|:--|:--|
| **B3** (this contract) | Siigo adapter (mcp) + registration/connect (backend) | Implements A–D verbatim; confirms the 2 Inferred `get_*` paths on first touch |
| **B4** | Reference emission in `mcp-tool-executor` | Implements §E emit; no Siigo wire change |
| **B5** | E2E in the xcale chat | Validates A–E end-to-end against the real sandbox |
| **Slice 2** (own ADR) | Fiscal writes (`create_invoice`…) | New contract; out of scope here |
