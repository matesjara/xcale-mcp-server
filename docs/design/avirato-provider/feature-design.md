# Avirato Provider — Feature Design

> **Feature**: Onboard Avirato (Spanish hotel PMS, API v3) as an MCP provider, so an xcale agent can quote real availability and prices for a hotel, and create, change, find and cancel its reservations.
> **Priority**: P1. The first tenant, Reserva Donato, has its onboarding blocked on this provider.
> **Owner**: Sara · **Issue**: `matesjara/xcale-mcp-server#189`
> **Status**: Draft
> **Target Release**: Phase 1, the provider with reads and reservation writes
> **Last Updated**: 2026-10-30

---

> **Grounding.** The decisions here come from the grill of 2026-10-30 (the comment on #189) and from Avirato's published OpenAPI (`https://apiv3.avirato.com/swagger.json`, 69 operations under `/v3`; the sandbox's spec is byte-identical). **No wire fact has been observed yet.** The sandbox spike (§9, P-1 to P-6) runs before the API contract, which carries only observed facts.

> **Architectural guardrail.** This design instantiates machinery that already exists: `credential_exchange` with `reference` delivery (Siigo, Erbon), Explicit Context (Cloudbeds' `propertyID`), control-plane tools (ADR 0013), thin write passthrough (ADR 0015), and identity policy (ADR 0019, 0023). It adds **one** core change, a closed dotted key path in `responseFields` (AD-2, CTO decision of 2026-10-30 on #189), which gets its own ADR. Anything else implementation finds in the core stops the work and reopens an ADR.

---

## 1. Problem Statement

**What's happening?** Reserva Donato runs on Avirato, and its guests ask over WhatsApp what every hotel's guests ask: _is there a room for these dates, how much is it, book it for me, move my dates, cancel it_. xcale has no Avirato provider, so the agent can answer none of it from the real PMS, and the hotel's onboarding (planned for 2026-10-20–21) is blocked on it.

**Why now?** Avirato answered on 2026-10-30 with API v3: a public OpenAPI, a sandbox that mirrors production with the previous day's data, and credentials the hotel generates in its own back-office. Unlike Erbon, Avirato's API already covers the full reservation lifecycle (create, modify, cancel, find), so the booking is not deferred.

**Cost of inaction.** A paying hotel cannot go live, and every quote and booking stays manual and bound to business hours.

## 2. Goals & Success Metrics

| Type      | Metric                                                                | Target                                                                                                                       | How Measured                               |
| :-------- | :-------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------- |
| Leading   | The agent quotes an Avirato hotel from the real PMS                   | `check_availability` + `quote_stay` green against the sandbox                                                                | Sandbox round trip, `mcp-contract-qa`      |
| Leading   | A reservation the agent closes lands in Avirato with the quoted price | Created, found by id, modified and cancelled in the sandbox                                                                  | Spike + contract QA                        |
| Lagging   | Reserva Donato goes live                                              | Live connection with real bookings by agent                                                                                  | Backend phase, the first live conversation |
| Guardrail | No credential persists on the server                                  | `SecretString` at egress, nothing logged                                                                                     | CI credential-boundary and redaction tests |
| Guardrail | Self-contained provider                                               | Only `src/providers/avirato/` + 1 line in `src/providers/index.ts` + its logo (plus AD-2's core change, reviewed on its own) | PR diff                                    |

## 3. Target Users

| User                                   | Role              | What they get                                                                                                                                                                     |
| :------------------------------------- | :---------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hotel guest** (WhatsApp)             | End user          | An instant answer on rooms and price, a booking closed in the conversation, and the link to pay and to check in.                                                                  |
| **Hotel staff** (Reserva Donato)       | Operator          | Bookings that land in Avirato without retyping, paid through the hotel's own gateway.                                                                                             |
| **xcale agent** (LLM)                  | Consumer of tools | Avirato's reads on its menu. Writes go through the backend's booking tools.                                                                                                       |
| **xcale-backend** (Rail A + `booking`) | Consumer system   | A consumer-agnostic surface its booking ports (`stay-truth`, `reservation-materialization`, `reservation-change`, `reservation-cancellation`, `reservation-lookup`) call by name. |

## 4. User Stories

### Must Have (P0)

- **US-01**: As a guest, I ask for a room from Nov 20 to 23 for two, and the agent tells me which room types are free those nights.
- **US-02**: As a guest, I ask how much, and the agent tells me the price Avirato quotes for each meal plan (regime).
- **US-03**: As a guest, I say "book it", and the reservation is created in Avirato at the quoted price, with my data as the client.
- **US-04**: As a guest, I get the link to pay for my reservation through the hotel's gateway, and the AutoCheckIn link.
- **US-05**: As a guest who booked, I can find my reservation, change its dates or party, or cancel it, and only mine (identity policy).
- **US-06**: As a guest with a promotional code, the agent validates it and the reservation carries it.
- **US-07**: As hotel staff, I connect my Avirato account once (the API user's email and password) and choose the establishment.
- **US-08**: As the backend, when Avirato rejects the token or the credential, I get `PROVIDER_AUTH_EXPIRED` and prompt the hotel to reconnect. When Avirato answers 429, I get `PROVIDER_RATE_LIMITED`.

## 5. Feature Scope (MoSCoW)

### ✅ Must Have — Phase 1

- [ ] An `avirato` provider: `credential_exchange` auth against `POST /v3/token/login`, `reference` delivery, and a `contextSchema` with `web_code` (AD-1, AD-3).
- [ ] The core change AD-2: a closed dotted key path in `responseFields`, with its ADR. The backend's reader follows in a linked PR.
- [ ] The 14 tools of §6.1, published or control-plane as that table says.
- [ ] Verbatim data (Fidelity over Unification), with typed errors: 401/403 → `PROVIDER_AUTH_EXPIRED` or `PROVIDER_ERROR` per the error-ownership boundary, 429 → `PROVIDER_RATE_LIMITED`, no internal retries.
- [ ] Identity policies on every tool that reads or names a reservation or a person (ADR 0019, 0023).
- [ ] Fixtures from observed sandbox responses with no personal data, the conformance suite, a redaction test, and `mcp-contract-qa` against the sandbox.

### 🟡 Should Have

- [ ] `errors.ts` mapping Avirato's `errorCode` values (e.g. `FORBBIDEN`, observed on `/docs/json`) to `ProviderErrorCode`.

### 🔵 Could Have

- [ ] `list_promotional_packages`, if Reserva Donato sells packages over WhatsApp.

### ⛔ Won't Have — Out of Scope

- **Registering payments** (`POST /v3/payment`). The hotel's gateway in Avirato charges and reconciles the reservation itself (grill decision 2), so nothing is registered by hand.
- **Companions** (`/guest`), **check-in and check-out**, **access codes** and **charges** (`/charge`). Fast-follow, on demand.
- **Hotel administration**: daily prices, minimum stays, channel-manager and online-restriction blocks. These are operations decisions, not a conversation.
- **Polling or webhooks.** Avirato publishes no webhooks, and v1 reads on demand. Whether the consumer needs a sync is the backend's call, and its own design.
- **A quota guard in the server.** The server is stateless. The per-IP limit is surfaced as `PROVIDER_RATE_LIMITED` (R-2).
- **Price math in the MCP.** The quote is returned verbatim; the backend's `stay-truth` composes what the agent narrates.

## 6. UX & Interaction Design (agent, guest and hotel)

There is no screen in this repo. The experience is the agent's tools and the guest conversation they produce.

### 6.1 The tools

| Tool                                     | Endpoint                               | Surface                       | Identity                              |
| :--------------------------------------- | :------------------------------------- | :---------------------------- | :------------------------------------ |
| `mcp_avirato_get_establishment`          | `GET /v3/establishment`                | menu                          | none                                  |
| `mcp_avirato_list_room_types`            | `GET /v3/space`                        | menu                          | none                                  |
| `mcp_avirato_list_rates`                 | `GET /v3/rate`                         | menu                          | none                                  |
| `mcp_avirato_list_regimes`               | `GET /v3/regime`                       | menu                          | none                                  |
| `mcp_avirato_list_extras`                | `GET /v3/extra`                        | menu                          | none                                  |
| `mcp_avirato_check_availability`         | `GET /v3/availability`                 | menu                          | none                                  |
| `mcp_avirato_validate_promotional_code`  | `GET /v3/promotional_codes/{code}`     | menu                          | none                                  |
| `mcp_avirato_quote_stay`                 | `POST /v3/price/price_for_reservation` | control plane (money)         | none                                  |
| `mcp_avirato_create_reservation`         | `POST /v3/reservation`                 | control plane (write + money) | ownership by construction             |
| `mcp_avirato_modify_reservation`         | `PATCH /v3/reservation/{id}`           | control plane (write)         | subject-bound, `recordAction: change` |
| `mcp_avirato_cancel_reservation`         | `DELETE /v3/reservation/{id}`          | control plane (write)         | subject-bound, `recordAction: cancel` |
| `mcp_avirato_get_reservation`            | `GET /v3/reservation/{id}`             | menu                          | subject-bound, `recordAction: read`   |
| `mcp_avirato_find_reservations_by_guest` | `GET /v3/reservation/client/{doc}`     | menu                          | subject-bound, document identifies    |
| `mcp_avirato_get_reservation_links`      | `GET /v3/reservation/urls/{id}`        | menu                          | subject-bound, `recordAction: read`   |

Names are provisional until the contract. The surface follows Erbon's and Profitroom's precedent (AD-4).

### 6.2 Quote

The guest gives dates and party size. The agent calls `check_availability` and `list_room_types`, and shows the free room types with their names and capacity. When the guest asks the price, the backend's `stay-truth` calls `quote_stay` and hands the agent the price per regime, which the agent narrates. A promotional code is checked with `validate_promotional_code` before it is promised.

- **Nothing free**: the agent says so and offers other dates.
- **A price Avirato cannot give** (no rate for that party or those dates): the quote comes back empty, and the agent says the price is not available. It never makes one up.

### 6.3 Book

The guest says "book it". The backend's materialization port collects the client data the agent gathered (which fields are required: P-5) and calls `create_reservation`. It sends the price from the quote, the status the tenant's instructions set, the promotional code if there is one, and our reconciliation tag in `external_code`. Avirato answers with the reservation, and the backend calls `get_reservation_links`, so the agent sends the payment link (`Guest` or `Shop`, P-1) and the AutoCheckIn link.

- **A lost response** (timeout after the POST): the consumer looks for its tag before it retries (P-4), so it never books twice.
- **Avirato refuses** (no availability in the meantime, invalid data): the error comes back typed, and the agent offers another option.

### 6.4 Change, cancel, find

A returning guest asks about their stay. The agent finds it with `find_reservations_by_guest` (by document) or `get_reservation` (by id). The identity policy lets the consumer show it only to the person it belongs to. Changing dates or party goes through the backend's `reservation-change` port to `modify_reservation`, which needs a new quote first. Cancelling goes through `reservation-cancellation` to `cancel_reservation`. Whether that `DELETE` cancels or erases the reservation is P-3.

### 6.5 Connect (hotel staff)

Once, in the hotel's Avirato back-office (_Mi cuenta → Usuarios y seguridad_), the hotel creates a user with **Usuario API** on and the reservation permissions (view, create, modify, delete). In xcale it pastes that user's email and password. Rail A mints a token, which proves the credential, and the login's `web_codes` tell which establishments the user reaches. The hotel picks one, and it becomes the connection's `web_code`. A user that reaches several establishments is several connections (Explicit Context).

### 6.6 Notifications

None from this provider. The agent tells the guest. Avirato may send its own emails on a reservation, which is the hotel's configuration in Avirato (Q-1).

## 7. Data Model Sketch

There are no canonical DTOs: data is returned verbatim. These shapes are read from the spec, not observed yet, and the contract fixes the fields.

- **Token** (`/token/login`) → `{ status, data: { token, web_codes[], expiry } }`. `expiry` is `"YYYY-MM-DD HH:mm:ss"`, with no offset.
- **Availability** (`/availability`, `start_date`, `end_date`, `web_code`, optional `space_subtype_id`) → rooms per date for each space subtype.
- **Space / room type** (`/space`) → space types and subtypes. A subtype is what a reservation books (`space_subtype_id`).
- **Price** (`/price/price_for_reservation`) → price possibilities for every regime.
- **Reservation create** (`/reservation`) → `{ external_code?, promotional_code?, validateCode?, rooms[] }`. Each room requires `space_subtype_id, quantity, adults, children, check_in, check_out, regime, rate_id, status, client, price, operator_reservation_id, advance, observations, additional_beds, extras, predefinedCharges`.
- **Reservation modify** (`PATCH /reservation/{master_reservation_id}`) → rooms with a required `action` and the same fields.
- **Reservation links** (`/reservation/urls/{id}?type=AutoCheck|Guest|Shop`) → the URLs.

```
connection (email + password, in Rail A) ──mints──▶ token ──reaches──▶ web_codes[]
web_code ──has──▶ space types ──have──▶ space subtypes ──booked by──▶ reservation rooms
reservation (master) ──has many──▶ rooms ──each has──▶ client, regime, rate, price
reservation ──has──▶ links (AutoCheck · Guest · Shop)
```

**Context:** `web_code` on `X-Provider-Metadata`, sent as the `web_code` query parameter on the 63 operations that take it.

## 8. Architectural Decisions

| #    | Decision           | Choice                                                                                                                                                     | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                           |
| :--- | :----------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AD-1 | Auth               | `credential_exchange` against `POST /v3/token/login` (`bodyFields { email, password }`), `reference` delivery, `bearer_header`                             | Same shape as Erbon. The durable secret lives in Rail A, and the server only sees the minted JWT. Rail A reuses the token until `expiry`, which also keeps the logins out of the rate limit.                                                                                                                                                                                                                                        |
| AD-2 | Nested token       | `responseFields { token: 'data.token', expiry: 'data.expiry' }`, using a **closed dotted key path** (keys joined by `.`, no indices, wildcards or escapes) | CTO decision, 2026-10-30 (#189). It is data, not behaviour, so ADR 0010's declarative rule holds. Top-level keys keep working, so Siigo and Erbon are untouched. A new ADR amends ADR 0010 and the glossary, and the backend's reader follows in a linked PR (provider before consumer).                                                                                                                                            |
| AD-3 | Context            | `contextSchema { web_code }`, chosen at connect from the login's `web_codes`                                                                               | `1 connection → N scopes`: the token alone cannot say which establishment (Explicit Context, as Cloudbeds' `propertyID`).                                                                                                                                                                                                                                                                                                           |
| AD-4 | Surface            | Reads that touch nobody's money are on the menu. The price and the three writes are **control plane** (ADR 0013), called by the backend's booking ports.   | Avirato makes the caller send `price`, so the number must come from the quote, composed by the backend's `stay-truth`, never typed by a model (Erbon AD-2, Profitroom). The writes go through the same ports that already carry identity, the quote and the duplicate check for Cloudbeds. The capability is not narrowed: the tenant's agent still books, changes and cancels, through the backend's booking tools it is assigned. |
| AD-5 | Writes             | Thin passthrough (ADR 0015): validate the shape, send, return verbatim. One tool call is at most one mutation.                                             | Duplicate detection, the confirmation and retries live in the consumer. `external_code` is passed through for the consumer's reconciliation tag.                                                                                                                                                                                                                                                                                    |
| AD-6 | Reservation status | `status` is a required input of `create_reservation`, with no default in the provider                                                                      | It is the hotel's policy (`tenant-autonomy.md`). The tenant's instructions decide, and the backend passes the value through.                                                                                                                                                                                                                                                                                                        |
| AD-7 | Rate limit         | 429 → `PROVIDER_RATE_LIMITED`, with no retries and no in-process limiter                                                                                   | Canonical pattern (ADR 0009) and complexity on demand. The limit is per IP and shared by every tenant (R-2).                                                                                                                                                                                                                                                                                                                        |
| AD-8 | Identity           | Identity policies per §6.1 (ADR 0019, 0023), declared by the provider and enforced by the consumer                                                         | The reservation reads and writes take an id or a document and act with the hotel's token, so the consumer must know whose record each one is.                                                                                                                                                                                                                                                                                       |

## 9. Risks & Open Questions

### Risks

| #   | Risk                                                                                                                                                                                                        | Likelihood           | Impact     | Mitigation                                                                                                                                                          |
| :-- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------- | :--------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R-1 | **Expiry read in the wrong timezone.** `readExpiry` does `new Date("2023-10-28 11:41:00")`, which reads server-local time. If Avirato means Madrid time, a token is used one or two hours after it expired. | Med                  | Med        | P-2 observed in the spike. It blocks the release to `main`, not the merge to `dev`. A declarative expiry timezone is its own change after the evidence.             |
| R-2 | **Per-IP rate limit shared across tenants** (750 / 5 min). One busy hotel can starve another.                                                                                                               | Low now (one tenant) | High later | `PROVIDER_RATE_LIMITED` is surfaced, and tokens are reused. Revisit with the second Avirato tenant: a shared guard would be new infrastructure, which needs an ADR. |
| R-3 | **The sandbox holds real guest data** (yesterday's copy of production).                                                                                                                                     | High                 | Med        | Fixtures carry no personal data. Test writes are created and cancelled the same day, with an `external_code` that marks them.                                       |
| R-4 | **The API user's permissions are too narrow** (a 403 on a read we need).                                                                                                                                    | Med                  | Low        | The spike exercises every tool and turns on the missing permission. The connect guide lists the permissions.                                                        |
| R-5 | **Rail A's behaviour on a 401 with a cached token** (does it mint again?) has not been checked in the code.                                                                                                 | Med                  | Med        | Checked in the backend phase before the first live call (CTO, 2026-10-30).                                                                                          |

### Open Questions

| #   | Question                                                                                     | Needed By         | Owner         | Resolution                                                             |
| :-- | :------------------------------------------------------------------------------------------- | :---------------- | :------------ | :--------------------------------------------------------------------- |
| P-1 | Which link carries the payment: `Guest` or `Shop`?                                           | Contract          | Spike         | Pending                                                                |
| P-2 | Which timezone is `expiry` in?                                                               | Release to `main` | Spike         | Pending                                                                |
| P-3 | Does `DELETE /reservation/{id}` cancel the reservation (it stays, as cancelled) or erase it? | Contract          | Spike         | Pending                                                                |
| P-4 | Can a reservation be found by `external_code` (reconciliation after a lost response)?        | Contract          | Spike         | Pending                                                                |
| P-5 | Which `client` fields are required on create, and does Avirato create the client inline?     | Contract          | Spike         | Pending                                                                |
| P-6 | Do `/regime`, `/extra` and `/availability` need permissions beyond the reservation ones?     | Contract          | Spike         | Pending                                                                |
| Q-1 | Does Avirato email the guest when a reservation is created or cancelled through the API?     | Backend phase     | Spike / hotel | Pending. The hotel's configuration in Avirato, surfaced to the tenant. |

## 10. Phasing & Roadmap

| Phase                       | Scope Summary       | Key Deliverables                                                                                                                                                            | Dependencies                                                                               | Est. Effort |
| :-------------------------- | :------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- | :---------- |
| **0 — Spike**               | Observe the sandbox | Login, every read, a test reservation created, modified and cancelled; answers to P-1 to P-6; `sandbox-evidence.md`                                                         | The API user's credentials in Doppler (created 2026-10-30, in the sandbox from 2026-10-31) | S           |
| **1 — Provider**            | This design         | ADR for AD-2 + core change; `src/providers/avirato/` with the 14 tools; contract; conformance; `mcp-contract-qa`                                                            | Phase 0                                                                                    | M           |
| **2 — Backend** (own issue) | Consumer            | Rail A: the path reader and Avirato's `credential-exchange-providers` entry; `booking/adapters/avirato/` behind the existing ports; connect flow with the `web_code` choice | Phase 1 merged (provider before consumer)                                                  | M           |
| **3 — Live**                | Reserva Donato      | Real connection, E2E over WhatsApp, release                                                                                                                                 | Phase 2, P-2 settled                                                                       | S           |

## 11. Agentic Context

- **Repo scope:** xcale-mcp-server, plus the one core change of AD-2 under its own ADR. The backend half is Phase 2, in its own issue.
- **Templates:** Erbon (`src/providers/erbon/`) for `credential_exchange` + `reference` and the control-plane split; Cloudbeds (`src/providers/cloudbeds/`) for `contextSchema`, reservation writes and identity policies; Profitroom for the money tool off the menu.
- **Provider anatomy:** `manifest.ts`, `auth.ts`, `context.ts`, `client.ts` (base `https://apiv3.avirato.com`, the `web_code` query parameter), `errors.ts`, `tools.ts` (`defineTool`, zod as the single source of truth), `provider.ts` (factory + DI), `index.ts`, `__fixtures__/`, `__tests__/`.
- **Invariants:** Provider Self-Containment; Consumer-Agnostic (no tenant or xcale concept on the wire); Credential-in-Transit-Only (`SecretString`, `.reveal()` only at egress).
- **DoD:** `server/discover` lists `avirato` with its `authDescriptor` and `contextSchema`; `tools/list` returns the 10 menu tools; `tools/call check_availability` is green against the sandbox; a forced 401 returns `PROVIDER_AUTH_EXPIRED`; a forced 429 returns `PROVIDER_RATE_LIMITED`.
- **Next:** the Phase 0 spike, then `/api-contract-authoring` → `api-contract.md` in this folder, then `/implementation-plan`.
