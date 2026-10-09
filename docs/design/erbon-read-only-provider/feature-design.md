# Erbon Read-Only (Quote) Provider — Feature Design

> **Feature**: Onboard Erbon (LATAM hotel PMS) as an MCP provider so an xcale agent can quote real availability and rates for a hotel, read-only. Booking write is a later phase (Erbon has not shipped the API yet).
> **Priority**: P3 (integrations board, Esteban 2026-09-21) — hotels vertical.
> **Owner**: Sara (design lead) · **Epic**: `matesjara/xcale-backend#1040`
> **Status**: Draft
> **Target Release**: Slice 1 — read-only provider (availability + rates + prices)
> **Last Updated**: 2026-09-28
> **Language note**: authored in English per this repo's `CLAUDE.md` (design docs are durable → English), not the backend's Spanish-prose convention.

---

> **Architectural guardrail (binding).** This design introduces **no new architectural concept** — it only *instantiates* the `credential_exchange` + `reference` machinery already validated by Siigo (`docs/design/siigo-read-only-provider/`) and the canonical provider pattern (`docs/adr/0009-canonical-provider-pattern.md`). If implementation surfaces a need for a core change (e.g. an absolute-datetime expiry field in the auth descriptor, or a new resolver), **stop and reopen an ADR** — do not absorb architecture into this feature. The one known candidate (expiry parsing) is a **backend** concern, deferred to the backend grill.

> **Grounding.** Decisions here come from the grill (`grill-notes.md`) and live sandbox probes (`sandbox-evidence.md`) in this folder. Read those first.

---

## 1. Problem Statement

**What's happening?** Hotels on Erbon (a LATAM PMS) are onboarding to xcale. Their guests ask, over WhatsApp, the two questions every hotel gets: *"do you have room for these dates?"* and *"how much?"*. Today the xcale agent cannot answer for an Erbon hotel — there is no Erbon provider on the MCP server, so the agent has no way to read that hotel's real availability or rates. The hotel's staff answers by hand, slowly, and only in business hours.

**Why now?** Erbon published its API and issued sandbox credentials (2026-09). Cloudbeds already proves the hotel/PMS shape end-to-end (`booking` ports + provider), so Erbon is a well-paved second PMS. The one caveat: **Erbon's API cannot yet create/cancel/modify a reservation** (confirmed by Erbon; ~3 weeks out from 2026-09-22). So the value we can ship *now* is the quote, not the booking.

**Why not wait for booking?** Because the quote is most of the guest's question, and it is unblocked. Answering availability + price instantly, 24/7, is real value on its own; the guest is then handed off to the hotel to close the booking. When Erbon ships the write API, a follow-up phase turns the handoff into an in-agent booking with **zero rework of the quote path**.

## 2. Goals & Success Metrics

| Goal | Metric | Target |
|:--|:--|:--|
| The agent answers availability for an Erbon hotel | `mcp_erbon_check_availability` returns live rooms for a date range | Round-trip green against sandbox |
| The agent quotes a **correct** price | Backend `StayQuote.total` (tax + extra-person included) for an Erbon room/rate/window | No pre-tax total ever narrated (the scar) |
| Onboarding an Erbon hotel is self-contained | Files touched to add the provider | Only `src/providers/erbon/` + 1 line in `src/providers/index.ts` |
| No credential ever persists on the server | `SecretString` at egress; nothing logged | CI credential-boundary checks green |

**Non-goals as metrics:** we are not measuring booking conversion this phase (no booking); we are measuring *quote availability and correctness*.

## 3. Target Users

| User | Role | What they get |
|:--|:--|:--|
| **Hotel guest** (WhatsApp) | End user | An instant, correct answer to "any room for these dates, and how much?" — then a clear handoff to book with the hotel. |
| **Hotel staff** (Erbon customer) | Operator | Fewer manual availability/price questions; the agent fields them 24/7 from the real PMS. |
| **xcale agent** (LLM) | Consumer of tools | A curated, money-safe tool menu for the Erbon hotel. |
| **xcale-backend** (Rail A + `booking`) | Consumer system | A consumer-agnostic MCP surface it composes into `StayQuote` and the booking flow. |

## 4. User Stories

- **US-1** — As a guest, I ask "do you have a room from Oct 20 to 23?" and the agent tells me which room types are available for those nights.
- **US-2** — As a guest, I ask "how much for a Suite Estándar those nights for 2?" and the agent tells me the **full price** (tax and any extra-person charge included), or explicitly says "plus charges for extra guests" when it could not confirm the full figure.
- **US-3** — As a guest, once I want to book, the agent hands me off to the hotel (contact/next step) because booking is not yet available through the agent.
- **US-4** — As hotel staff, I connect my Erbon hotel once (paste credentials + `hotelID`) and the agent can immediately quote.
- **US-5** — As the backend, when Erbon's token expires or is revoked, I get `PROVIDER_AUTH_EXPIRED` and prompt the hotel to reconnect.

## 5. Feature Scope (MoSCoW)

**Must have**
- Erbon provider on the MCP server: `credential_exchange` auth (`reference` delivery), `contextSchema { hotelID }`.
- Agent menu tools (money-free reads): `check_availability`, `list_room_types`, `list_rates`, `get_hotel`.
- Backend-only tool (money): `get_rate_prices` (routable, not listed) — feeds the backend `StayQuote`.
- Verbatim data (Fidelity over Unification); typed errors (`PROVIDER_AUTH_EXPIRED` on 401/403).
- Conformance suite + sandbox round-trip proof.

**Should have**
- `errors.ts` mapping seeded from Erbon's `GET /mapping/errors` table.
- A hand-made `rateprices` fixture until Erbon seeds sandbox prices.

**Could have**
- `currencies` read if `get_hotel` does not carry currency.

**Won't have (this phase)**
- Any booking write: create / cancel / modify / check-in / check-out — Erbon has no API for it yet.
- Quote composition or price math **in the MCP** (that is the backend's `erbon-stay-truth` adapter).
- Canonical cross-provider DTOs (`Reservation`, `Guest`).
- Multi-hotel auto-discovery (`contextDiscovery`) — Erbon exposes no listing endpoint.

## 6. UX & Interaction Design (agent + guest experience)

There is no GUI; the "UX" is the agent's tool experience and the resulting guest conversation.

**The agent's menu.** For an Erbon hotel the agent sees four tools: check availability, list room types, list rates, get hotel. It never sees a raw price tool — pricing is a backend-composed step. This is deliberate: the agent can describe *what exists and for whom*, but the *number* always comes from the backend.

**Quote conversation (happy path).** The guest gives dates and party size. The agent calls `check_availability` (dates) and `list_room_types` (pax limits, names), presents the available rooms, and — when the guest asks the price — the backend `price-enquiry` use case composes the tax-correct `StayQuote` (calling the backend-only `get_rate_prices`). The agent narrates the **total**, then, because booking is unavailable, hands off: *"to confirm, I'll connect you with the hotel."*

**Key states.**
- *Empty availability* — no rooms for the window: the agent says so and offers to try other dates.
- *Price unconfirmed* — `StayQuote.occupancyPriced = false` (occupancy read failed or room type absent for the party): the agent gives the base figure and explicitly adds "plus any charge for extra guests" — never a settled total.
- *Prices not loaded* (current sandbox reality) — `get_rate_prices` returns empty: the backend surfaces "price unavailable right now," never a fabricated number.
- *Auth expired* — `PROVIDER_AUTH_EXPIRED`: the hotel is prompted to reconnect; the guest gets a graceful "one moment."

**Connect experience (hotel staff).** One-time: paste the Erbon username/password and the `hotelID` Erbon provides. The connection is proven by minting a token once (no separate probe). Done.

## 7. Data Model Sketch

No canonical DTOs — data is returned **verbatim** (Fidelity over Unification). The shapes below are what Erbon returns (observed), for orientation only; exact fields live in the api-contract.

- **Availability** (`/availability`) → rows `{ date, roomTypeDescription, statusAvailability }`. Keyed by *description*, not id → the backend joins to room types.
- **Room type** (`/mapping/roomtype`) → `{ id, code, description, minPax, maxPax, roomCount }`.
- **Rate** (`/mapping/rates`) → `{ id, code, description, allowRO/BB/HB/FB/AI, isDerived, derivation }` (meal plans as flags).
- **Rate price** (`/mapping/rateprices`, backend-only) → the money; consumed by the backend to build `StayQuote { subtotal, extraPersonCharge, taxes, total, currency, taxesIncluded, occupancyPriced }`.
- **Hotel** (`/hotel/{hotelID}`) → name/contact/currency for the handoff.

**Context:** `hotelID` (string) — per-call, on `X-Provider-Metadata`. It is the connection identity (like Cloudbeds `propertyID`).

## 8. Architectural Decisions

| # | Decision | Rationale |
|:--|:--|:--|
| **AD-1** | **Faithful & granular provider** — MCP exposes raw reads, no quote composition, no price math. | Fidelity over Unification; money truth stays in the backend's `StayQuote`; provider testable via fixtures without seeded prices. |
| **AD-2** | **Menu vs backend-only split** — `get_rate_prices` is `routableToolNames` but not in `listTools`; the other 4 reads are the agent menu. | The only money read is structurally off the agent's menu → the agent cannot narrate a pre-tax price (the `stay-truth.port.ts` scar). soul.md backend-driven applied to the menu. |
| **AD-3** | **`credentialDelivery: 'reference'`** (same as Siigo). | A `credential_exchange` durable secret must live in Rail A regardless; `reference` reuses the proven path with zero new MCP code. `forwarded` would need a mint-and-forward path that does not exist. Reversible in one line if the backend grill decides otherwise. |
| **AD-4** | **`hotelID` via `contextSchema`, pasted at connect.** No `contextDiscovery`, no `connectionProbe`, no `accountContextKeys`. | The credential is account-scoped (JWT proves it); Erbon exposes no hotel-listing endpoint; a `credential_exchange` proves itself by minting at connect; `hotelID` is the connection identity. |

Auth descriptor (from `grill-notes.md` §8): `credential_exchange`, `tokenEndpoint /auth/login`, `responseFields { token: 'bearerToken', expiry: 'expirationUTCDate' }`, `bearer_header`, no `staticHeaders`.

## 9. Risks & Open Questions

| Risk / Question | Owner | Mitigation / Status |
|:--|:--|:--|
| **Prices not seeded in sandbox** — `rateprices` returns `[]` | Erbon (Giovanni) | Ask Erbon to seed; build against a hand-made fixture meanwhile. Not a build blocker. |
| **Price composition unknown** — does `rateprices` include tax / extra-person / meal-plan? | Backend grill | The scar risk. Confirm with Erbon before the backend ships a quote. Deferred to backend. |
| **Absolute-datetime expiry** — Rail A may expect `expires_in` seconds | Backend grill | May need a core descriptor field → ADR. MCP just declares the field. Deferred. |
| **`reference` for a non-financial provider** | Backend grill | Reconfirm the resolve path runs unchanged; expected to. |
| **Availability↔room-type join by description** | Backend | Confirm the join key (description/code) is stable. |
| **Booking never ships** (Erbon slips) | Product | Quote-only still delivers value; handoff covers booking. Re-scope epic if needed. |

## 10. Phasing & Roadmap

- **Slice 1 (this design) — MCP read-only provider.** `src/providers/erbon/` with the 4 menu tools + backend-only `get_rate_prices`, auth, conformance, sandbox round-trip. Ships independently of the backend.
- **Slice 2 (backend, separate grill) — quote path.** `erbon-stay-truth` adapter composes `StayQuote`; wire to `price-enquiry`; `present_room_rates`; handoff-to-hotel behavior. Depends on Erbon seeding prices + confirming composition.
- **Slice 3 (future) — booking write.** New `erbon-booking` design folder when Erbon ships create/cancel/modify. Plugs into the existing `booking` ports; no rework of the quote path.

## 11. Agentic Context

- **Repo scope:** `xcale-mcp-server` only. Backend work (Rail A wiring, `booking/adapters/erbon/`, `StayQuote` composition) is a separate phase with its own grill.
- **Templates:** copy Siigo (`credential_exchange` auth, read-only tools) and Cloudbeds (`contextSchema`/hotel domain). Provider anatomy: `manifest.ts`, `auth.ts`, `client.ts` (params in **headers**), `tools.ts` (`defineTool`, zod = single source of truth), `provider.ts` (factory + DI), `index.ts`, `__fixtures__/`, conformance test.
- **Invariants:** Provider Self-Containment (touch only `src/providers/erbon/` + 1 line); Consumer-Agnostic (no tenant/xcale concepts on the wire); Credential-in-Transit-Only (`SecretString`, `.reveal()` only at egress).
- **DoD:** `server/discover` lists `erbon` with its `authDescriptor`; `tools/list` returns the 4 menu tools (not `get_rate_prices`); `tools/call check_availability` green against sandbox; forced 401 → `PROVIDER_AUTH_EXPIRED`.
- **Next skill:** `/api-contract-authoring` → `api-contract.md` in this folder, then `/implementation-plan`.
