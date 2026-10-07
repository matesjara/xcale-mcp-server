# Erbon — grill notes (pre feature-design)

- **Status:** alignment (grill). This PR ships the grill notes + sandbox evidence only; the feature-design, api-contract and implementation-plan are follow-ups.
- **Date:** 2026-09-28
- **Code target repo:** `xcale-mcp-server` (MCP provider). Credential custody + quote composition live in `xcale-backend` (Rail A + the `booking` module) — grilled separately, later.
- **Source:** Erbon Swagger (`https://api.erbonsoftware.com/swagger/index.html`), verified against the live sandbox with partner-issued test credentials (see `sandbox-evidence.md`).
- **Epic:** `matesjara/xcale-backend#1040` (hotels vertical; maps onto the same `booking` ports Cloudbeds implements).

> Working document. Records resolved decisions and open questions from the grill; the feature-design is authorized once the blocking questions close. Backend-side questions are flagged here but deferred to the backend grill.

---

## 1. Scope

Add an **Erbon** PMS provider to the MCP server so an xcale agent can **quote real availability and rates** for a hotel over WhatsApp. **Booking write is out of scope for this phase** — Erbon's API does not yet expose reservation create/cancel/modify (confirmed with Erbon; ~3 weeks out from 2026-09-22, unconfirmed in writing). This phase is **read-only (quote)**; the agent quotes and then **hands the guest off to the hotel** to actually book. A future `erbon-booking` design folder handles the write path when Erbon ships it.

## 2. Recon findings (verified — sandbox + code)

1. **Auth is `credential_exchange`, Siigo-shaped.** `POST /auth/login` with `{username,password}` → `{ bearerToken (JWT), expirationUTCDate }`. Verified live (HTTP 200). See `sandbox-evidence.md` §1.
2. **Expiry is an absolute UTC datetime**, not `expires_in` seconds — `expirationUTCDate: "2026-09-28T01:16:35Z"`. Diverges from Siigo (`expires_in`). The JWT itself also carries a standard `exp` claim, but Rail A reads `responseFields.expiry` from the body.
3. **The credential identifies an ACCOUNT, not a hotel.** JWT identity claim is a GUID (`0fa1ff82-…`) with role `ECONOMY` — **not** the `hotelID` (`358AC521-…`). Every data endpoint is `/hotel/{hotelID}/…`; `hotelID` travels per call. Same shape as Cloudbeds `propertyID`.
4. **No "list my hotels" endpoint.** Of 65 paths, the only non-`{hotelID}` ones are `POST /hotel/booking/list`, `POST /booking/localizerList`, `POST /hotel/hotelid` (localizer→hotelID, not a listing) and `GET /mapping/errors`. So **no `contextDiscovery` is possible** — `hotelID` must be collected at connect.
5. **No booking write, and no cancel/modify at all.** The only booking mutations in the swagger are `checkin`/`checkout`; `POST /hotel/{hotelID}/booking/new` exists in the swagger but Erbon says create is not functional yet. Confirmed in `sandbox-evidence.md` §4.
6. **Read path works; prices are empty in the sandbox.** `GET /availability`, `/mapping/roomtype`, `/mapping/rates` return real data. `GET /mapping/rateprices` returns `[]` for every rate×roomType×date combo tried — endpoint healthy, hotel has no prices loaded. Waiting on Erbon to seed sandbox prices. **Not a blocker** for building the provider (fixtures).
7. **Request params travel in HEADERS, not query.** `availability` takes `checkinDate`/`checkoutDate` headers; `rateprices` takes `dateFrom`/`dateTo`/`idRate`/`idRoomType` headers. Diverges from Siigo's query-param client.
8. **Availability keys rooms by DESCRIPTION, not id.** `availability` rows carry `roomTypeDescription` + `statusAvailability`, no `id`; `mapping/roomtype` carries `id`+`description`. Joining the two is the backend adapter's job.

## 3. Resolved decisions (grill)

- **D1 — Provider stays faithful and granular.** The MCP exposes raw Erbon reads; it does **not** compose a quote and does **not** do price arithmetic. Rationale (soul.md order): (a) *Fidelity over Unification* (ADR-0009) — no canonical DTO; (b) money truth belongs to the backend where `StayQuote` lives (see D2); (c) the provider is testable with fixtures without waiting on seeded prices. *Rejected:* a composed `search_availability` tool that fuses the 4 endpoints into a quote-shaped result — moves domain logic into the MCP and risks the agent narrating a pre-tax price.
- **D2 — Menu vs backend-only split (the money guard).** The only Erbon read that returns money is `rateprices`. It is published as **routable-but-not-listed** (`routableToolNames`, absent from `listTools`) so the agent structurally cannot narrate a raw, pre-tax price; the backend `erbon-stay-truth` adapter consumes it to compose the tax-correct `StayQuote`. The four money-free reads are the agent menu. This is soul.md backend-driven applied to the tool menu. (Motivation: the `stay-truth.port.ts` scars — the agent quoted pre-tax totals to real guests twice.)
- **D3 — `credentialDelivery: 'reference'`** (same as Siigo). A `credential_exchange` provider's durable secret (username/password) must live in Rail A regardless; `reference` reuses the proven end-to-end path with **zero new MCP code**. `forwarded` would require Rail A to mint-and-forward, a path that does not exist today (Siigo is the only credential_exchange provider and it uses `reference`). The "non-financial → forwarded" heuristic is about providers whose stored credential is directly usable (OAuth/API key); a token-minting provider is a different shape. If the backend grill prefers `forwarded`, it is a one-line descriptor flip.
- **D4 — `hotelID` via `contextSchema`, pasted at connect.** `contextSchema: { hotelID: string }`, carried per call on `X-Provider-Metadata`. **No `contextDiscovery`** (no listing endpoint — recon §4), **no `connectionProbe`** (a `credential_exchange` proves itself by minting once at connect, like Siigo), **no `accountContextKeys`** (default = all context keys = `hotelID`, which *is* the connection identity — identical to Cloudbeds `propertyID`). A connection = (ECONOMY credential + one `hotelID`); multiple hotels = multiple connections.
- **Settled by code (not grilled):** data returned **verbatim**; errors → `ProviderErrorCode` on top of `mapHttpStatusToErrorCode` (401/403 → `PROVIDER_AUTH_EXPIRED`); tools declared with `defineTool` (zod input = single source of truth); factory `createErbonProvider(deps?)` with injectable `fetchImpl`; one line in `src/providers/index.ts`.

## 4. ADRs to create

| ADR | Status | Reason |
| --- | --- | --- |
| `reference` for a non-financial provider | **Not needed** | Real trade-off and mildly surprising vs the glossary's "reference = financial" framing, but reversible in one line → fails the 3-criteria test. At most a one-sentence refinement to the *Credential delivery strategy* glossary entry (clarifying that `credential_exchange` implies `reference` by mechanics, not risk) — pending confirmation. |
| Absolute-datetime expiry field in the descriptor | **Conditional / backend** | Only if Rail A cannot parse `expirationUTCDate` and the fix needs a new `responseFields.expiry` format field — that touches `src/core` → exceptional ADR. Decided in the backend grill (Q1), not here. |

## 5. Open questions (deferred to the backend grill — do not block the MCP phase)

- **Q1 (technical) — Expiry format.** Erbon returns `expirationUTCDate` (absolute ISO), Siigo returns `expires_in` (relative seconds). Does Rail A's `credential_exchange` mint parse an absolute datetime? If not → backend fix, possibly a core descriptor field (→ ADR). The MCP just declares `responseFields: { token: 'bearerToken', expiry: 'expirationUTCDate' }`.
- **Q2 (technical) — `reference` end-to-end for a non-financial provider.** Reconfirm the `credential_exchange` + `reference` resolve path runs unchanged for Erbon (it should — it is provider-agnostic).
- **Q3 (correctness · the scar) — `StayQuote` composition.** The `erbon-stay-truth` adapter must return the full `total` (tax + extra-person included), never `subtotal`. Needs Erbon to confirm the price composition: does `rateprices` include tax? extra-person charge? meal-plan pricing (`/sales/rate/prices/mealplan`)? Do not ship a quote until this is certain. (Pending Giovanni seeding prices.)
- **Q4 (data) — Availability↔room-type join.** `availability` gives `roomTypeDescription`, not id; the adapter joins to `mapping/roomtype` by description/code. Confirm the join key is stable.
- **Q5 (product) — Handoff.** With no booking, the agent quotes and hands off to the hotel to book. Where does the hotel contact come from — `GET /hotel/{hotelID}` or tenant config? (Backend/agent-behavior decision.)

## 6. How the integration works (end-to-end, this phase)

1. A guest writes on WhatsApp; the agent calls an `mcp_erbon_*` menu tool (availability / room types / rates / hotel).
2. `xcale-backend` resolves the tenant's Erbon connection in **Rail A**. Because delivery is `reference`, it forwards an **ephemeral reference** (not the token) as `X-Provider-Token`; the MCP resolves it just-in-time against the Credential Authority (Hop-B), which mints/reuses the Erbon bearer from the stored username/password. `hotelID` rides `X-Provider-Metadata`.
3. The **`erbon` provider** runs the tool: `client.ts` GETs the `/hotel/{hotelID}/…` endpoint with the Erbon-specific **header** params; the core materializer applies `Authorization: bearer <jwt>`.
4. Erbon responds JSON; the provider normalizes to a `ToolResult` (standard envelope, `data` verbatim). The server **discards** the credential — Credential-in-Transit-Only.
5. For a **price** (quote), the backend `booking` module's `price-enquiry.usecase` → `IStayTruthPort.validate` calls the **backend-only** `mcp_erbon_get_rate_prices`, joins availability + rate + price, and composes the tax-correct `StayQuote`. The agent narrates that total; it never sees a raw price.
6. A 401/403 from Erbon → `PROVIDER_AUTH_EXPIRED` → backend `markConnectionAuthFailure()` → reconnect prompt.

## 7. Endpoints and proposed tools

Host `https://api.erbonsoftware.com`. `hotelID` from `contextSchema` (metadata). All reads (GET); params in headers.

### Agent menu (`listTools`) — money-free reads

| Tool | Endpoint | Params (headers) | Returns |
| --- | --- | --- | --- |
| `mcp_erbon_check_availability` | `GET /hotel/{hotelID}/availability` | `checkinDate`, `checkoutDate` | rows of `{ date, roomTypeDescription, statusAvailability }` |
| `mcp_erbon_list_room_types` | `GET /hotel/{hotelID}/mapping/roomtype` | — | `{ id, code, description, minPax, maxPax, roomCount }` |
| `mcp_erbon_list_rates` | `GET /hotel/{hotelID}/mapping/rates` | — | `{ id, code, description, allowRO/BB/HB/FB/AI, isDerived, derivation }` |
| `mcp_erbon_get_hotel` | `GET /hotel/{hotelID}` | — | hotel info (name/contact/currency for the handoff) |

### Backend-only (`routableToolNames`, NOT in `listTools`) — the only money read

| Tool | Endpoint | Params (headers) | Why hidden |
| --- | --- | --- | --- |
| `mcp_erbon_get_rate_prices` | `GET /hotel/{hotelID}/mapping/rateprices` | `dateFrom`, `dateTo`, `idRate`, `idRoomType` | returns money; consumed by `erbon-stay-truth` to compose the tax-correct `StayQuote`. Off the menu = the agent cannot narrate a pre-tax price. |

## 8. Auth and errors

- **Auth:** `authDescriptor = { type: 'credential_exchange', credentialDelivery: 'reference', tokenEndpoint: 'https://api.erbonsoftware.com/auth/login', method: 'POST', bodyFields: { username: 'username', password: 'password' }, responseFields: { token: 'bearerToken', expiry: 'expirationUTCDate' }, tokenPlacement: 'bearer_header' }`. No `staticHeaders` (no institutional-identity header observed, unlike Siigo's `Partner-Id`).
- **Errors** (glossary: never interpolate the provider `body` into the message): 401/403 → `PROVIDER_AUTH_EXPIRED`; 400 → typed input/business error. `GET /mapping/errors` publishes Erbon's own error-code table — version it as provider reference and normalize on top of `mapHttpStatusToErrorCode` in `errors.ts`.

## 9. Sandbox and round-trip proof

`add-provider` DoD: `server/discover` lists `erbon` with its `authDescriptor`; `tools/list` returns the 4 menu tools; `tools/call` runs `check_availability` against the Erbon sandbox with a real token; a forced 401 returns `PROVIDER_AUTH_EXPIRED`. Availability/room-types/rates can be verified live **now**; `rateprices` needs Erbon to seed prices (build against a hand-made fixture until then). Reference for the proven pattern: `docs/design/siigo-read-only-provider/` (Colombia, read-only first, sandbox evidence). Live probes captured in `sandbox-evidence.md`.

## 10. CONTEXT.md

No new glossary terms resolved in this session (decisions are provider-config, not domain vocabulary). Candidate one-liner: refine the *Credential delivery strategy* entry to note that `credential_exchange` pairs with `reference` by mechanics — pending, not applied.

## 11. Next step

- **feature-design → api-contract → implementation-plan** in this folder, then build `src/providers/erbon/` (+1 line in `src/providers/index.ts`).
- Ask Erbon (Giovanni): (a) seed rate prices in the sandbox hotel; (b) confirm price composition (tax / extra-person / meal-plan) — blocks Q3, not the MCP build.
- Backend grill (later): Q1–Q5 above.
