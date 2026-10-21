# Erbon Read-Only (Quote) Provider — API Contract

> **Module**: `src/providers/erbon/` (xcale-mcp-server). Erbon connection registration lives in `xcale-backend` (Rail A), referenced here, not re-specified.
> **Kind**: External-provider adapter contract (NOT an internal `/api/v1` REST module). It documents three wire surfaces: (A) the **Erbon external API** as Observed, (B) the **`credential_exchange` authDescriptor** (concrete), (C) the **MCP tool contract** the provider publishes.
> **Upstream**: [feature-design.md](feature-design.md) · [grill-notes.md](grill-notes.md) · [sandbox-evidence.md](sandbox-evidence.md).
> **Status**: Draft — frozen once `get_hotel` shape is confirmed live (rate prices confirmed 2026-09-28 in hotel `964d9ad8-…`).
> **Language note**: English per this repo's `CLAUDE.md` (design docs are durable).
> **Last updated**: 2026-09-28.

> **🔬 Evidence discipline.** Concrete values are **Observed** against the Erbon sandbox (2026-09-26/28, see `sandbox-evidence.md`) unless a row is marked **Inferred** — the only remaining Inferred rows (`get_hotel` shape, `/mapping/errors` table) are confirmed on first build touch, never assumed Observed. This contract introduces no assumptions.

---

## 0. Resolved facts at a glance

| Datum | Value | Source |
|:--|:--|:--|
| Base URL | `https://api.erbonsoftware.com` (single host; sandbox = test creds) | Observed |
| Auth path | `POST /auth/login` | Observed |
| Auth body keys | `username` / `password` | Observed |
| Token / expiry fields | `bearerToken` (JWT) / `expirationUTCDate` (**absolute UTC datetime**) | Observed |
| Credential delivery | `reference` (like Siigo) | Decision AD-3 |
| Per-call context | `hotelID` (account-scoped credential; hotelID per call) | Observed (JWT) |
| Request params | in **HTTP headers**, not query string | Observed |
| Booking create | `POST /booking/new` now LIVE (2026-09-28) — handled in the separate `erbon-booking` phase, NOT here | Observed |
| Booking cancel / modify | still **absent** from the API (a created booking cannot be undone via API) | Observed |
| Rate prices | seeded (hotel `964d9ad8-…`); row carries **per-meal-plan** prices (see A.8) | Observed |

---

## A. Erbon External API — Observed wire surface

### A.1 Base + transport

| Property | Value |
|:--|:--|
| Base URL | `https://api.erbonsoftware.com` |
| Content-Type | `application/json` |
| TLS | HTTPS only |

### A.2 Authentication (mint) — `POST /auth/login`

**Request**
```http
POST https://api.erbonsoftware.com/auth/login
Content-Type: application/json
```
```json
{ "username": "<API user>", "password": "<API password>" }
```

**Response `200`**
```json
{
  "bearerToken": "<JWT, ~439 chars>",
  "expirationUTCDate": "2026-09-28T01:16:35.4536443Z"
}
```
- Token field: **`bearerToken`** · Expiry field: **`expirationUTCDate`** (absolute ISO-8601 UTC datetime, ~48h TTL) · Placement: **`Authorization: bearer <bearerToken>`** (lowercase `bearer`, as Erbon documents).
- The JWT identity claim is an **account GUID** with role (`ECONOMY`), NOT the `hotelID` → the credential is account-scoped; `hotelID` addresses the hotel per call.
- ⚠️ **Backend note (deferred):** `expirationUTCDate` is absolute, not `expires_in` seconds. Rail A's `credential_exchange` mint must parse it; if it cannot, that is a backend fix (possibly a core descriptor field → ADR). Out of scope for this provider.

### A.3 Data endpoints (read)

Every data request carries `Authorization: bearer <jwt>`. `hotelID` is a **path** segment (from `contextSchema`). Erbon takes filter params in **request headers**, not the query string.

| Operation | Method + Path | Params (headers) | Response | Evidence |
|:--|:--|:--|:--|:--|
| Availability by window | `GET /hotel/{hotelID}/availability` | `checkinDate`, `checkoutDate` (`YYYY-MM-DD`) | array of A.4 | Observed |
| Room type mapping | `GET /hotel/{hotelID}/mapping/roomtype` | — | array of A.5 | Observed |
| Rate mapping | `GET /hotel/{hotelID}/mapping/rates` | — | array of A.6 | Observed |
| Hotel info | `GET /hotel/{hotelID}` | — | object A.7 | **Inferred** — confirm on build |
| Rate prices (backend-only) | `GET /hotel/{hotelID}/mapping/rateprices` | `dateFrom`, `dateTo` (`YYYY-MM-DD`), `idRate` (int), `idRoomType` (int) | array of A.8 | Observed (only priced rate×roomType combos return rows; others `[]`) |

### A.4 Availability row (Observed)
```jsonc
{ "date": "2026-10-20", "roomTypeDescription": "SUITE ESTANDAR", "statusAvailability": 8 }
```
> ⚠️ Keyed by `roomTypeDescription`, **no id**. The backend joins to A.5 by description/code (grill Q4).

### A.5 Room type (Observed)
```jsonc
{ "id": 2, "code": "STD", "description": "SUITE ESTANDAR",
  "minPax": 1, "maxPax": 2, "externalCode": "", "roomCount": 8, "roomCountOccupied": 1 }
```

### A.6 Rate (Observed)
```jsonc
{ "id": 3, "code": "Estandar RC-Channel", "description": "Estandar RC-Channel",
  "allowRO": true, "allowBB": true, "allowHB": true, "allowFB": true, "allowAI": true,
  "isDerived": false, "derivation": null }
```
> Meal plans are per-rate flags: `allowRO` (Room Only), `allowBB` (Bed & Breakfast), `allowHB` (Half Board), `allowFB` (Full Board), `allowAI` (All Inclusive).

### A.7 Hotel info (Inferred — confirm on build)
```jsonc
{ "name": "…", "contact": "…", "currency": "…" }  // exact shape TBD; needed for the handoff message
```

### A.8 Rate price row (Observed — hotel `964d9ad8-…`, 2026-09-28)
```jsonc
{
  "id": 157308,
  "idRoomType": 2,
  "idRate": 1,
  "date": "2026-09-29",
  "priceRO": 346.00,   // Room Only
  "priceBB": 396.00,   // Bed & Breakfast
  "priceHB": 446.00,   // Half Board
  "priceFB": 496.00,   // Full Board
  "priceAI": 546.00,   // All Inclusive
  "currencyCode": "…"
}
```
> One row per date in the window. Prices are **per meal plan, inline** — the chosen meal plan (`idConfigPension` = `RO`/`BB`/`HB`/`FB`/`AI`) selects the field. This is the price source the backend `erbon-stay-truth` adapter reads to compose a `StayQuote`; whether these are pre- or post-tax is a backend-grill question. Returned verbatim; the provider does no math.

### A.9 Error responses (Observed)

Erbon returns non-2xx with a body that is sometimes a machine code, sometimes a plain (pt-BR) string:
```
HTTP 400  ERR_ROOM_AVAILABILITY_FETCH
HTTP 400  Erro ao obter dados de ocupação com pensão.
```
- `GET /mapping/errors` publishes Erbon's error-code table (**Inferred** — fetch and version it as provider reference).
- Never interpolate the provider body into a `ToolResult.message` (glossary rule).

---

## B. `authDescriptor` (concrete)

```ts
// src/providers/erbon/auth.ts
export const erbonAuth: ProviderAuthDescriptor = {
  type: 'credential_exchange',
  credentialDelivery: 'reference',              // AD-3 — same path as Siigo
  tokenEndpoint: 'https://api.erbonsoftware.com/auth/login',
  method: 'POST',
  bodyFields: { username: 'username', password: 'password' },   // logical → wire (identical)
  responseFields: { token: 'bearerToken', expiry: 'expirationUTCDate' },
  tokenPlacement: 'bearer_header',
  // no staticHeaders — Erbon requires no institutional-identity header (unlike Siigo Partner-Id)
};
```

**contextSchema** (per-call context, forwarded on `X-Provider-Metadata`):
```ts
// src/providers/erbon/context.ts
export const erbonContext = z.object({ hotelID: z.string().min(1) }).strict();
```
- No `contextDiscovery` (no listing endpoint), no `connectionProbe` (mint-at-connect is the gate), no `accountContextKeys` (default = `hotelID`, the connection identity).

---

## C. MCP tool contract

All tools declared with `defineTool` (zod `input` = single source of truth). Data returned **verbatim** (Fidelity over Unification). `hotelID` comes from context, never from tool input.

### C.1 Published to the agent (`listTools`)

| Tool | `input` (zod) | Backs | Returns |
|:--|:--|:--|:--|
| `mcp_erbon_check_availability` | `{ checkinDate: string, checkoutDate: string }` (`YYYY-MM-DD`) | `GET /availability` | `PaginatedResult`-free flat array of A.4, verbatim |
| `mcp_erbon_list_room_types` | `{}` | `GET /mapping/roomtype` | flat array of A.5, verbatim |
| `mcp_erbon_list_rates` | `{}` | `GET /mapping/rates` | flat array of A.6, verbatim |
| `mcp_erbon_get_hotel` | `{}` | `GET /hotel/{hotelID}` | A.7 object, verbatim |

### C.2 Routable but NOT published (`routableToolNames` only) — the money guard (AD-2)

| Tool | `input` (zod) | Backs | Consumer |
|:--|:--|:--|:--|
| `mcp_erbon_get_rate_prices` | `{ dateFrom: string, dateTo: string, idRate: number, idRoomType: number }` | `GET /mapping/rateprices` | backend `erbon-stay-truth` adapter → composes `StayQuote` |

> `get_rate_prices` is the only tool that returns money. Keeping it out of `listTools()` means the agent cannot call it and therefore cannot narrate a raw, pre-tax price — the `StayQuote` scar guard, enforced structurally.

### C.3 Error mapping (`errors.ts`, on top of `mapHttpStatusToErrorCode`)

| Erbon | `ProviderErrorCode` |
|:--|:--|
| HTTP 401 / 403 | `PROVIDER_AUTH_EXPIRED` (→ Rail A `markConnectionAuthFailure()`) |
| HTTP 429 | `PROVIDER_RATE_LIMITED` (return; consumer decides — no internal retry loop) |
| HTTP 400 + typed body (e.g. `ERR_ROOM_AVAILABILITY_FETCH`) | `PROVIDER_BAD_REQUEST` / typed input error |
| HTTP 5xx | `PROVIDER_UNAVAILABLE` |

---

## D. Mock data (for fixtures + conformance)

**`check_availability` success** (`__fixtures__/availability.json`) — from sandbox:
```json
[
  { "date": "2026-10-20", "roomTypeDescription": "SUITE ESTANDAR", "statusAvailability": 8 },
  { "date": "2026-10-20", "roomTypeDescription": "SUITE JUNIOR", "statusAvailability": 12 }
]
```

**`list_rates` success** (`__fixtures__/rates.json`) — from sandbox:
```json
[
  { "id": 3, "code": "Estandar RC-Channel", "description": "Estandar RC-Channel",
    "allowRO": true, "allowBB": true, "allowHB": true, "allowFB": true, "allowAI": true,
    "isDerived": false, "derivation": null }
]
```

**`get_rate_prices` success** (`__fixtures__/rateprices.json`) — Observed (hotel `964d9ad8-…`):
```json
[
  { "id": 157308, "idRoomType": 2, "idRate": 1, "date": "2026-09-29",
    "priceRO": 346.0, "priceBB": 396.0, "priceHB": 446.0, "priceFB": 496.0, "priceAI": 546.0, "currencyCode": "..." }
]
```
**`get_rate_prices` empty** — a rate×roomType combo with no prices loaded returns `[]` (HTTP 200), not an error.

**Auth expired** — any read returning HTTP 401 → `ToolResult` `{ isError: true, code: 'PROVIDER_AUTH_EXPIRED' }`.

---

## E. Roadmap

| Phase | Scope | Trigger |
|:--|:--|:--|
| **This contract** | 4 menu reads + backend-only `get_rate_prices`; auth; errors | now |
| Freeze | confirm A.7 (`get_hotel`) live shape (A.8 `rateprices` confirmed 2026-09-28) | before read-only merge |
| `erbon-booking` (NEXT — MCP) | create-reservation tool (`POST /booking/new`, LIVE 2026-09-28); no cancel/modify yet → needs availability-guard + `voucher` idempotency + propose→confirm gating; its own grill | now |
| Backend (separate) | `erbon-stay-truth` composes `StayQuote`; wire to `price-enquiry` | after MCP phases |
