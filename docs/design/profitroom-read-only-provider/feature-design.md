# Profitroom Read-Only Provider (v1) — Feature Design

> **Feature**: Onboard Profitroom as a credential-less MCP provider (`none` auth), read-only, with 5 tools over a hotel's public booking engine: hotel info, room types, rates, availability calendar, and a priced quote with a pre-filled booking link.
> **Priority**: P1 High
> **Owner**: Sara
> **Status**: Draft
> **Target Release**: v1 — Read-only slice
> **Last Updated**: 2026-10-14
> **Issue**: matesjara/xcale-mcp-server#142 · **Epic**: matesjara/xcale-backend#1598 · **Consumer**: matesjara/xcale-backend#1599

---

> **Architectural guardrail (binding).** This design instantiates the decisions resolved in the `/grill` of 2026-10-14 and in ADR [credential-less-provider-auth](../../adr/credential-less-provider-auth.md). The **only** concession to the core (`src/core`) is the `none` auth variant, and it ships as its **own PR ahead of the provider**. If implementation surfaces any other need in `src/core|protocol|auth`, **stop and reopen the ADR**; do not absorb it into this feature.
>
> **The API is not a contract.** Profitroom publishes no documentation for this surface. It is the JSON API its own booking engine page calls, observed on 2026-10-14. Everything below assumes it can change without notice, so the provider fails closed and a daily probe detects drift.

---

## 1. Problem Statement

### What's happening?

La Pausa Hotelbistró (tenant since 2026-10-05, Starter plan) runs its whole operation on Profitroom: booking engine, channel manager and CRM. It is not going through Erbon. Its xcale agent sits in **informative mode with a no-quote rule**: a guest who asks on WhatsApp "how much for two nights next weekend?" gets no price, and the hotel loses the conversation to its own booking engine or to an OTA.

Profitroom has a partner API that would let us book for real, but access goes through a partner program we do not have yet (matesjara/xcale-backend#1600, blocked). Meanwhile, the hotel's public booking engine (`booking.profitroom.com/es/hotellapausa`) already serves rooms, rates, a calendar and **live priced availability** to any visitor, without authentication. That is enough to quote with real data and hand the guest a link that lands on the exact search, ready to pay.

### Who's affected?

- **The guest** writing on WhatsApp, who wants a real price and a way to book, now.
- **La Pausa's team**, who today answer every quote request by hand or lose it.
- **xcale**, which cannot sell the hotel vertical to Profitroom hotels without this. Profitroom also sells its own AI agent with native engine access, so it is a direct competitor.

### What's the cost of inaction?

La Pausa pays for an agent that cannot do the one thing a hotel most needs from it. Every other Profitroom hotel is out of reach until the partner API arrives, and that date is outside our control.

---

## 2. Goals & Success Metrics

### North Star

A guest asking La Pausa's agent for a stay gets a **real, live price** and a **one-tap link** to book that exact stay, and never a made-up number.

### Metrics

| Metric                                                   | Target  | How measured                                                          |
| :------------------------------------------------------- | :------ | :-------------------------------------------------------------------- |
| Quotes that match the engine's price for the same search | 100%    | MCP round trip vs. engine page, on QA dates                           |
| Invented or stale prices returned                        | 0       | Price always from live `availability`; fail-closed on schema mismatch |
| `check_availability` latency (P95, warm cache)           | < 1.5 s | Server logs                                                           |
| Drift detected → issue opened                            | < 24 h  | Daily drift workflow                                                  |
| Calls to Profitroom per quote (warm cache)               | 1       | Only `availability` is uncached                                       |

---

## 3. Target Users

### Guest (over WhatsApp, via the xcale agent)

Asks about rooms, prices and dates in Spanish or English. Wants an answer in the same conversation and a simple way to book. Never sees the provider; sees the agent's words and a link.

### Hotel operator (La Pausa)

Connects the hotel once by pasting its booking-engine URL. Expects the agent to quote exactly what the engine shows, and to send guests to the engine to pay. Does not want to configure rates twice.

### Consumer (xcale-backend, Rail A + booking module)

Discovers the provider in the catalog, connects it without a secret, calls its tools and turns the results into agent behavior (matesjara/xcale-backend#1599).

---

## 4. User Stories

### Must Have (P0)

- As a **guest**, I want to ask for a price for specific dates and number of people so that I get the real amount the hotel charges.
- As a **guest**, I want a link that opens the hotel's engine with my dates and party already filled in so that I can pay without starting over.
- As a **guest**, I want to know what a rate includes and its cancellation and deposit terms so that I can choose with confidence.
- As a **guest**, I want to hear "there is no availability for those dates" when that is the case, rather than a vague "let me check".
- As an **operator**, I want to connect my hotel by pasting the booking-engine URL I already know.
- As **xcale**, I want the agent to never state a price that did not come from the live engine.

### Should Have (P1)

- As a **guest**, I want to see which nights are open over the next weeks so that I can pick dates that work.
- As a **guest**, I want to ask "what rooms do you have?" without giving dates.

### Could Have (P2)

- As a **guest**, I want to quote several rooms at once for a group (fast-follow; `rooms` max 1 in v1).

---

## 5. Feature Scope (MoSCoW)

### ✅ Must Have — v1 (read-only)

- `none` auth variant in the core (separate PR, ADR [credential-less-provider-auth](../../adr/credential-less-provider-auth.md)).
- `profitroom` provider in `src/providers/profitroom/` with `contextSchema` `{ bookingEngineUrl }`, strictly parsed.
- Five agent-facing tools, named like Erbon's: `get_hotel`, `list_room_types`, `list_rates`, `get_availability_calendar`, `check_availability`. **None returns money.**
- `check_availability` joins live proposals with room and rate names, inclusions, cancellation and deposit terms, and remaining rooms — no price.
- One **backend-only** (`controlPlane`) tool, `get_stay_prices`: the same proposals **with** price, original price, `taxesIncluded` and a per-proposal `bookingUrl`. The consumer turns it into a `StayQuote`; the agent never sees it (the money guard, as in Erbon).
- In-memory cache (15 min) for `details`, `rooms`, `offers`; never for `availability`.
- Fail-closed error mapping (see §8).
- Fixture tests in CI + a daily live drift workflow sharing the provider's zod schemas.

### 🟡 Should Have

- `locale` input honored in names, descriptions and `bookingUrl` (validated against the hotel's live locales).

### 🔵 Could Have

- Multi-room quotes (`rooms` max > 1) — additive contract change.
- Custom-domain (white-label) booking engines in `bookingEngineUrl`.

### ⛔ Won't Have — Explicit Out of Scope

- Creating, modifying or cancelling reservations; any checkout or payment through this surface (matesjara/xcale-backend#1600, partner API).
- CRM sync of stays (matesjara/xcale-backend#1600).
- Computing taxes or a gross total (no tax data in the engine; would be a hard-coded tenant rule).
- Promo codes, vouchers, loyalty prices, group offers.
- Any consumer behavior (agent wording, quote-only booking flow, Rail A connect form): those belong to matesjara/xcale-backend#1599.

---

## 6. UX & Interaction Design

The provider has no UI. Its UX is the **shape of what the agent can say**, plus the consumer's connect step.

### 6.1 Connect flow (consumer dashboard, operator)

The operator picks Profitroom in the integrations list. The catalog says `auth: { type: 'none' }`, so the consumer shows **no secret field**, only the `contextSchema` field: _"Booking engine URL"_, with the example `https://booking.profitroom.com/es/yourhotel`. On submit, the consumer stores the URL and calls `get_hotel` to verify it. A valid hotel shows its name and currency as confirmation; an invalid URL shows _"This doesn't look like a Profitroom booking engine address"_.

### 6.2 Conversational behavior (guest over WhatsApp)

A guest writes _"Hola, ¿cuánto cuesta para 2 personas del 23 al 25 de octubre?"_. The agent calls `check_availability` with those dates and 2 adults and learns which room and rate are open, what the rate includes (e.g. breakfast) and its cancellation and deposit terms. **The price does not come from the agent's tools.** The consumer's price enquiry calls `get_stay_prices`, builds a `StayQuote` (which states whether taxes are included or unknown) and hands the agent a figure it may only narrate, together with the `bookingUrl`. Opening the link lands on the engine with the dates and party pre-filled, and the guest pays there and sees the exact total with taxes.

Why the split: on 2026-07-16 and 2026-09-02 guests were under-quoted (missing tax, missing extra-person charge) because the agent presented a component as the total. The backend's `StayQuote` exists to stop that; Erbon keeps its price tool backend-only for the same reason (`src/modules/booking/ports/stay-truth.port.ts` in xcale-backend).

If the guest asks _"¿qué fechas tienen libres en noviembre?"_, the agent calls `get_availability_calendar` and lists open nights, respecting minimum stay. If the guest asks _"¿qué cabañas tienen?"_, it calls `list_room_types`.

### 6.3 Key states

| State                                                                                | What the provider returns                                                                                               | What the agent can say                                        |
| :----------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------ |
| Available                                                                            | `check_availability`: proposals with names and terms; `get_stay_prices` (backend): price, `taxesIncluded`, `bookingUrl` | Room, terms, the consumer's `StayQuote` + link                |
| No availability                                                                      | Success, `available: false`, empty proposals                                                                            | "No hay disponibilidad para esas fechas" (+ suggest calendar) |
| Invalid input (bad dates, too many people, a child older than the hotel's child age) | `PROVIDER_INVALID_INPUT`                                                                                                | Ask the guest to adjust (older children count as adults)      |
| Engine down / slow                                                                   | `PROVIDER_UNAVAILABLE`                                                                                                  | "Déjame confirmarte y te escribo"                             |
| Rate-limited                                                                         | `PROVIDER_RATE_LIMITED`                                                                                                 | Same as above                                                 |
| Response shape changed                                                               | `PROVIDER_ERROR` (logged loudly)                                                                                        | Same as above, never a price                                  |

### 6.4 Notifications & Feedback

- Schema mismatches return `PROVIDER_ERROR` whose message names the endpoint and failing field path (never response data); the consumer logs it.
- The daily drift workflow fails red and opens or updates a `profitroom-drift` issue.

---

## 7. Data Model Sketch

The provider stores nothing durable. The sketch below is the **shape of what crosses the boundary**; exact fields belong to the API contract.

### Provider (MCP) — `authDescriptor` and context

- `authDescriptor`: `{ type: 'none' }`.
- `contextSchema`: `{ bookingEngineUrl: string }`. Accepted form: `https://booking.profitroom.com/{locale}/{hotelKey}` (optional trailing path ignored). The provider extracts `hotelKey`. The `{locale}` segment is **not** the guest's language.

### Engine resources (Profitroom, observed 2026-10-14)

| Resource     | Endpoint                                                                  | Used for                                                                                                   | Cached |
| :----------- | :------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------- | :----- |
| Hotel        | `GET /api/{hotelKey}/details`                                             | name, `defaultCurrency`, `locales`, `defaultLocale`, check-in/out times, `taxesPresentationMode`           | 15 min |
| Room type    | `GET /api/{hotelKey}/rooms`                                               | names, translations, occupancy `limits`, `totalRooms`, `offerIds`                                          | 15 min |
| Rate (offer) | `GET /api/{hotelKey}/offers`                                              | names, inclusions, `profiles` (deposit %, `cancelTime`/`cancelUnit`, `remainingPaymentType`), restrictions | 15 min |
| Calendar day | `GET /api/{hotelKey}/calendar?from&to`                                    | `availability`, `minLOS`, `maxLOS`, `CTD` per date                                                         | never  |
| Proposal     | `GET /api/{hotelKey}/availability?checkIn&checkOut&occupancy[0][adults]…` | `OfferID`, `RoomID`, `profileId`, `price`, `originalPrice`, `discounts`, `roomCount`                       | never  |

All calls send `X-Requested-With: XMLHttpRequest` and are built from the fixed base `https://booking.profitroom.com/api/`.

### Relationships

- A **proposal** references one **room type** (`RoomID`), one **rate** (`OfferID`) and one rate **profile** (`profileId`). `check_availability` resolves all three before returning.
- A **rate** lists the room types it applies to (via `rooms[].offerIds`).

### Booking link (derived, not stored)

```
https://booking.profitroom.com/{locale}/{hotelKey}/pricelist/rooms/{RoomID}?check-in={YYYY-MM-DD}&check-out={YYYY-MM-DD}&r1_adults={n}[&{childrenParam}]&currency={code}
```

`{childrenParam}` depends on `details.enabledNewChildrenOccupancyPicker`: `false` (La Pausa) → `r1_child{minAge}-{maxAge}={count}` per child `personTypes` bucket (e.g. `r1_child0-2=1`); `true` → `r1_children_age={a,b}`.

Verified live: dates, adults, children (`r1_child0-2=1` → "2 adultos • 1 niño") and currency pre-fill the engine. The `{RoomID}` path segment opens the quoted room with its rates and "book now" button (verified 2026-10-14); `room-id`/`offer-id` query params pre-select nothing.

---

## 8. Architectural Decisions

| #   | Decision                                 | Choice                                                                                                                                                                                                                                                                                                    | Rationale                                                                                                                                                                                                     |
| :-- | :--------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Auth shape                               | New `none` variant; target hotel in `contextSchema.bookingEngineUrl`                                                                                                                                                                                                                                      | Honest catalog; a public URL is routing data, not a credential. ADR [credential-less-provider-auth](../../adr/credential-less-provider-auth.md)                                                               |
| 2   | SSRF                                     | Parse `bookingEngineUrl` against `https://booking.profitroom.com/{locale}/{hotelKey}`; build every request from a fixed base; **never** fetch the supplied URL                                                                                                                                            | Consumer-supplied URLs must not steer server egress                                                                                                                                                           |
| 3   | Tool surface                             | Agent menu (Erbon's names, no money): `get_hotel`, `list_room_types`, `list_rates`, `get_availability_calendar`, `check_availability`. Backend-only (`controlPlane`): `get_stay_prices`                                                                                                                   | Same shape as Erbon eases #1599; money only reaches the agent through the consumer's `StayQuote` (reopened 2026-10-14 after reading the backend's money guard)                                                |
| 4   | Joining IDs                              | Done in the provider, not by the LLM                                                                                                                                                                                                                                                                      | Provider knowledge; avoids mismatched names and extra LLM round trips                                                                                                                                         |
| 5   | Caching                                  | In-memory per process, keyed by `hotelKey`, TTL 15 min, for `details`/`rooms`/`offers` only                                                                                                                                                                                                               | Cuts P95 (~1.4 s → ~0.75 s) and traffic to an API that isn't ours; price stays live                                                                                                                           |
| 6   | Drift / fail-closed                      | zod on **only the fields we use**; mismatch → `PROVIDER_ERROR` naming the field path                                                                                                                                                                                                                      | One schema definition shared by runtime and drift probe                                                                                                                                                       |
| 7   | Unknown `RoomID`/`OfferID` in a proposal | Refresh cache once; still unknown → `PROVIDER_ERROR`                                                                                                                                                                                                                                                      | Never show a nameless option, never drop one silently                                                                                                                                                         |
| 8   | HTTP errors                              | 429 → `PROVIDER_RATE_LIMITED`; 5xx/timeout (8 s) → `PROVIDER_UNAVAILABLE`; 422 → `PROVIDER_INVALID_INPUT`                                                                                                                                                                                                 | Existing closed error set; no new codes                                                                                                                                                                       |
| 9   | No availability                          | Success with `available: false`                                                                                                                                                                                                                                                                           | It is an answer, not a failure                                                                                                                                                                                |
| 10  | Taxes                                    | `get_stay_prices` returns the engine's price with `taxesIncluded` derived from `details` `taxesPresentationMode`; no tax amount                                                                                                                                                                           | No tax data exists anywhere before checkout (checked `details`, `offers`, `policies`, `extra-beds`); computing it would be a hard-coded tenant rule. How `StayQuote` represents unknown taxes is #1599's call |
| 11  | Booking link                             | `bookingUrl` per proposal inside `get_stay_prices`; optional `locale` input validated against the hotel's live locales, default `defaultLocale`                                                                                                                                                           | Deterministic from the quote's inputs; travels with the price it belongs to                                                                                                                                   |
| 12  | Occupancy                                | Input `rooms: [{ adults, childrenAges? }]`, **max 1** in v1. A child age above the hotel's child `personTypes` range → `PROVIDER_INVALID_INPUT`; a response the engine re-split into several rooms, or whose echoed occupancy differs, is `available: false` with `reason: 'party_does_not_fit_one_room'` | Multi-room later is additive. The engine **re-splits** a party one room cannot take (observed: 2 adults + age 7 → two rooms), so quoting group 1 alone would under-quote the party                            |
| 13  | Drift detection                          | Fixtures in CI + daily `profitroom-drift.yml` (cron + manual) on `hotellapausa`, +30 days, 2 nights, 2 adults; failure opens/updates an issue                                                                                                                                                             | Detects change without making every PR depend on Profitroom                                                                                                                                                   |
| 14  | Calendar range                           | Max 60 days per call                                                                                                                                                                                                                                                                                      | Bounds payload and upstream load                                                                                                                                                                              |
| 15  | Currency                                 | The hotel's `defaultCurrency`; no conversion                                                                                                                                                                                                                                                              | Matches what the guest pays in the engine                                                                                                                                                                     |
| 16  | Tool metadata                            | All five tools `readOnly`; audience `customer` per the (Proposed) audience ADR                                                                                                                                                                                                                            | Guest-safe reads                                                                                                                                                                                              |

### Agent Tools

The five menu tools above are the agent's tools: read-only, guest-facing, money-free. `get_stay_prices` is `controlPlane` (callable by the consumer, absent from `listTools`). Nothing writes anywhere.

---

## 9. Risks & Open Questions

### Risks

| Risk                                                                    | Likelihood      | Impact                    | Mitigation                                                             |
| :---------------------------------------------------------------------- | :-------------- | :------------------------ | :--------------------------------------------------------------------- |
| Profitroom changes the internal API                                     | Medium          | Quotes stop (fail closed) | zod fail-closed + daily drift probe + issue within 24 h                |
| Profitroom blocks or throttles our traffic (it sells a competing agent) | Medium          | Quotes stop               | Cache static data; ~1 upstream call per quote; respect `X-RateLimit-*` |
| Terms-of-use exposure from using an undocumented API                    | Low–Medium      | Legal / relationship      | Get La Pausa's written OK alongside the partner-API request (#1600)    |
| Guest reads the net price as final                                      | Medium          | Trust                     | `taxesIncluded: false` enforced in agent wording (#1599)               |
| SSRF via `bookingEngineUrl`                                             | Low (mitigated) | High                      | Parse-only against a fixed host; requests built from a fixed base      |
| Room/rate created minutes ago not in cache                              | Low             | One failed quote          | Refresh once on unknown ID                                             |

### Open Questions

| #   | Question                                                                                                                 | Owner | How to resolve                      |
| :-- | :----------------------------------------------------------------------------------------------------------------------- | :---- | :---------------------------------- |
| 1   | ~~Do `room-id`/`offer-id` pre-select in the engine?~~ Resolved 2026-10-14: no; the `/pricelist/rooms/{RoomID}` path does | Sara  | Done                                |
| 2   | Window of `X-RateLimit-Limit: 1500` (per minute? hour?)                                                                  | Sara  | Observe headers over time           |
| 3   | Does the consumer support a secret-less connection and a quote-only provider?                                            | Sara  | matesjara/xcale-backend#1599 design |

---

## 10. Phasing & Roadmap

| Phase | Scope                                                   | Repo             | Status            |
| :---- | :------------------------------------------------------ | :--------------- | :---------------- |
| 0     | `none` auth variant + ADR (core PR)                     | xcale-mcp-server | This design       |
| 1     | `profitroom` read-only provider + drift workflow (#142) | xcale-mcp-server | This design       |
| 2     | Wire into the booking module: quote + link (#1599)      | xcale-backend    | Next              |
| 3     | Partner API: real bookings + CRM sync (#1600)           | both             | Blocked on access |

---

## 11. Agentic Context

### Related Modules

- `src/providers/erbon/` — the closest precedent (read-only hotel, same tool names).
- `src/providers/cloudbeds/` — `contextSchema` precedent (`propertyID`), availability calendar handling, fixtures.
- `src/core/auth/`, `src/core/provider-port.ts`, `src/core/testing/provider-conformance.ts` — where the `none` variant lands (phase 0 only).

### Codebase Entry Points

- `src/core/provider-port.ts:16` — `ProviderAuthDescriptor` union.
- `src/core/auth/authentication-materializer.ts:18` — exhaustive switch + reveal.
- `src/protocol/mcp-server.ts:84` — credential resolution per `tools/call`.
- `src/providers/index.ts` — provider registration (one line).
- `src/providers/erbon/tools.ts:70` — `check_availability` naming precedent.

### Conventions to Follow

- The xcale layer's `add-provider` recipe and ADR [canonical-provider-pattern](../../adr/0009-canonical-provider-pattern.md): single-source schemas, typed handlers, explicit context, DI + fixtures + conformance.
- `CONTEXT.md` terms: **Credential-less provider**, **Booking-engine URL**, `contextSchema`, `ProviderErrorCode`.
- Phase 0 and phase 1 are **separate PRs**; the autonomous pipeline escalates phase 0 (it touches `src/core`).

### Next Steps After Approval

1. Mateo reviews this design and the ADR.
2. `/api-contract-authoring` → `docs/design/profitroom-read-only-provider/api-contract.md` (tool input/output schemas).
3. Phase 0 PR (`none` variant), then phase 1 PR (provider), each via `/git-workflow`.
4. Open the consumer design for matesjara/xcale-backend#1599.
