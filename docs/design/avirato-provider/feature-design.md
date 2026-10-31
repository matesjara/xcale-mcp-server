# Avirato Provider — Feature Design

> **Feature**: Onboard Avirato (Spanish hotel PMS, API v3) as an MCP provider, so an xcale agent can quote real availability and prices for a hotel, and create, change, find and cancel its reservations.
> **Priority**: P1. The first tenant, Reserva Donato, has its onboarding blocked on this provider.
> **Owner**: Sara · **Issue**: `matesjara/xcale-mcp-server#189`
> **Status**: Draft
> **Target Release**: Phase 1, the provider with reads and reservation writes
> **Last Updated**: 2026-10-30

---

> **Grounding.** The decisions here come from the grill of 2026-10-30 (the comment on #189) and from Avirato's published OpenAPI (`https://apiv3.avirato.com/swagger.json`, 69 operations under `/v3`; the sandbox's spec is byte-identical). **Observed on production, read-only, 2026-10-30** (the comments on #189): the login, the token's behaviour, the rate-limit headers, every v1 read, the quote, and the reservation reads and links. Where they contradict the spec, §7 says so. Three test reservations, created and cancelled on production with Sara's go, observed create and cancel. On the sandbox, 2026-10-31, all 14 tools ran through the provider itself, modify included (reservations 238–240).

> **Architectural guardrail.** This design instantiates machinery that already exists: `credential_exchange` with `reference` delivery (Siigo, Erbon), Explicit Context (Cloudbeds' `propertyID`), control-plane tools (ADR 0013), thin write passthrough (ADR 0015), and identity policy (ADR 0019, 0023). It adds **one** core change to the `credential_exchange` descriptor, a closed dotted key path in `responseFields` and a declared `tokenTtlSeconds` (AD-2, CTO decision of 2026-10-30 on #189), under one ADR. Anything else implementation finds in the core stops the work and reopens an ADR.

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
- **US-02**: As a guest, I ask how much, and the agent tells me the price Avirato quotes for the stay, at the rate the hotel sells through the agent.
- **US-03**: As a guest, I say "book it", and the reservation is created in Avirato with my data as the client, at the price I was quoted. Avirato prices it, and the price matches the quote.
- **US-04**: As a guest, I get the link to pay for my reservation through the hotel's gateway, and the AutoCheckIn link.
- **US-05**: As a guest who booked, I can find my reservation, change its dates or party, or cancel it, and only mine (identity policy).
- **US-06**: As a guest with a promotional code, the agent validates it and the reservation carries it.
- **US-07**: As hotel staff, I connect my Avirato account once (the API user's email and password) and choose the establishment.
- **US-08**: As the backend, when Avirato rejects the token or the credential, I get `PROVIDER_AUTH_EXPIRED` and prompt the hotel to reconnect. When Avirato answers 429, I get `PROVIDER_RATE_LIMITED`.

## 5. Feature Scope (MoSCoW)

### ✅ Must Have — Phase 1

- [ ] An `avirato` provider: `credential_exchange` auth against `POST /v3/token/login`, `reference` delivery, and a `contextSchema` with `web_code` (AD-1, AD-3).
- [ ] The core change AD-2: a closed dotted key path in `responseFields` and a declared `tokenTtlSeconds`, with one ADR. The backend's reader follows in a linked PR.
- [ ] The 14 tools of §6.1, published or control-plane as that table says.
- [ ] Verbatim data (Fidelity over Unification), with typed errors: 401/403 → `PROVIDER_AUTH_EXPIRED` or `PROVIDER_ERROR` per the error-ownership boundary, 429 → `PROVIDER_RATE_LIMITED`, no internal retries.
- [ ] Identity policies on every tool that reads or names a reservation or a person (ADR 0019, 0023).
- [ ] Fixtures from observed sandbox responses with no personal data, the conformance suite, a redaction test, and `mcp-contract-qa` against the sandbox.

### 🟡 Should Have

- [ ] `errors.ts` mapping Avirato's observed `errorCode` values to `ProviderErrorCode`. Observed so far: `UNAUTHORIZED` and `USER_NOT_FOUND` (login), `Unauthorized` (`Invalid token`), `INPUT_DATA_VALIDATION_FAILED`, `ERROR_RETRIEVING_RESERVATIONS` and `FORBBIDEN`.

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

| Tool                                     | Endpoint                               | Surface                       | Identity                                                        |
| :--------------------------------------- | :------------------------------------- | :---------------------------- | :-------------------------------------------------------------- |
| `mcp_avirato_get_establishment`          | `GET /v3/establishment`                | menu                          | none                                                            |
| `mcp_avirato_list_room_types`            | `GET /v3/space`                        | menu                          | none                                                            |
| `mcp_avirato_list_rates`                 | `GET /v3/rate`                         | menu                          | none                                                            |
| `mcp_avirato_list_regimes`               | `GET /v3/regime`                       | menu                          | none                                                            |
| `mcp_avirato_list_extras`                | `GET /v3/extra`                        | menu                          | none                                                            |
| `mcp_avirato_check_availability`         | `GET /v3/availability`                 | menu                          | none                                                            |
| `mcp_avirato_validate_promotional_code`  | `GET /v3/promotional_codes/{code}`     | menu                          | none                                                            |
| `mcp_avirato_quote_stay`                 | `POST /v3/price/price_for_reservation` | control plane (money)         | none                                                            |
| `mcp_avirato_create_reservation`         | `POST /v3/reservation`                 | control plane (write + money) | none (reads nobody; its creator owns what it creates)           |
| `mcp_avirato_modify_reservation`         | `PATCH /v3/reservation/{id}`           | control plane (write)         | subject-bound, owner of the reservation (`avirato:reservation`) |
| `mcp_avirato_cancel_reservation`         | `DELETE /v3/reservation/{id}`          | control plane (write)         | subject-bound, owner of the reservation (`avirato:reservation`) |
| `mcp_avirato_get_reservation`            | `GET /v3/reservation/{id}`             | menu                          | subject-bound, owner of the reservation (`avirato:reservation`) |
| `mcp_avirato_find_reservations_by_guest` | `GET /v3/reservation/client/{doc}`     | menu                          | subject-bound on `client_doc`; rows filtered to their owner     |
| `mcp_avirato_get_reservation_links`      | `GET /v3/reservation/urls/{id}`        | menu                          | subject-bound, owner of the reservation (`avirato:reservation`) |

Names are provisional until the contract. The surface follows Erbon's and Profitroom's precedent (AD-4).

### 6.2 Quote

The guest gives dates and party size. The agent calls `check_availability` and `list_room_types`, and shows the free room types with their names and capacity. When the guest asks the price, the backend's `stay-truth` calls `quote_stay` for the rates the hotel sells through the agent (`rate_ids`), and hands the agent the total for the stay, which the agent narrates. Which rates those are is the hotel's policy: Reserva Donato's list mixes its own rates with channel rates (`Booking`, `AIRBNB`), and the hotel decides which one a WhatsApp guest gets (Q-2). A promotional code is checked with `validate_promotional_code` before it is promised.

- **Nothing free**: the agent says so and offers other dates.
- **A price Avirato cannot give** (no rate for that party or those dates): the quote comes back empty, and the agent says the price is not available. It never makes one up.

### 6.3 Book

The guest says "book it". The backend's materialization port collects the client data the agent gathered and calls `create_reservation`. It sends the stay, the rate, the regime, the full client (document, name, surname, email), the status the tenant's instructions set, the promotional code if there is one, and our reconciliation tag in `external_code`.

**Avirato prices the reservation itself (observed).** No amount is sent: the input `price` only says how it is paid. The created price matched the quote for the same stay and rate exactly. The quote is still what the agent narrates, and the consumer compares it with the created price.

Avirato answers `201` with the reservation, its charges and a draft bill. The backend then calls `get_reservation_links`, so the agent sends the payment link (P-1) and the AutoCheckIn link.

- **A lost response** (timeout after the POST): the consumer looks for its tag before it retries, so it never books twice. Avirato returns `external_code` as `promotional_package` on every read (observed).
- **Avirato refuses** (no availability in the meantime, invalid data): the error comes back typed, and the agent offers another option.

### 6.4 Change, cancel, find

A returning guest asks about their stay. The agent finds it with `find_reservations_by_guest` (by document) or `get_reservation` (by id). The identity policy lets the consumer show it only to the person it belongs to. Changing dates or party goes through the backend's `reservation-change` port to `modify_reservation`, which needs a new quote first. Cancelling goes through `reservation-cancellation` to `cancel_reservation`.

That `DELETE` keeps the reservation with status `Reserva cancelada` (observed). After it, the reservation is no longer readable by id, while the list by date still shows it. Its draft bill and charges stay attached (R-8).

**Modify takes the full record (observed on the sandbox):**

- **Every field, every time.** The backend sends the room as it should stand after the change, not a patch: a partial record is refused.
- **Avirato reprices.** One night to two doubled the price, matching the quote.
- **The tag is cleared.** A modify clears the reconciliation tag, so the consumer keeps the `reservation_id` it got from the create; `observations` survive.
- **A cancelled reservation cannot be modified.**

### 6.5 Connect (hotel staff)

Once, in the hotel's Avirato back-office (_Mi cuenta → Usuarios y seguridad_), the hotel creates a user with **Usuario API** on and the reservation permissions (view, create, modify, delete). In xcale it pastes that user's email and password. Rail A mints a token, which proves the credential, and the login's `web_codes` tell which establishments the user reaches. The hotel picks one, and it becomes the connection's `web_code`. A user that reaches several establishments is several connections (Explicit Context).

**One API user per connection, and never shared.** A second login invalidates the first token (observed). A person testing with the same user, or dev and production sharing it, therefore logs the hotel's agent out. Each environment and each person who tests gets its own Avirato API user.

### 6.6 Notifications

None from this provider. The agent tells the guest. Avirato may send its own emails on a reservation, which is the hotel's configuration in Avirato (Q-1).

## 7. Data Model Sketch

There are no canonical DTOs: data is returned verbatim. Every response is wrapped in `{ status, data }`. The reads below are **observed** on production (2026-10-30, shapes only); the writes are read from the spec. The contract fixes the fields.

- **Token** (`/token/login`, **observed** 2026-10-30 on production) → `201`, `{ status: "success", data: { token, web_codes[] } }`. There is **no `expiry`**, although the spec marks it required, and the JWT (HS256) carries only `securityCode` and `iat`, no `exp`. A wrong password gives `401 UNAUTHORIZED`; an unknown user gives `404 USER_NOT_FOUND`.
- **Token reuse** (observed): **a second login invalidates the first token**, which then gets `401`. A rejected token on a data call answers `401 {errorCode: "Unauthorized", message: "Invalid token"}`.
- **Rate limit** (observed): `X-RateLimit-Limit: 600`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (epoch seconds). The limit is 600, not the 750 Avirato's email states.
- **Establishment** (`/establishment`) → name, address, `currency` (Reserva Donato: `COP`), `country`, `default_vat`, and `booking_online` texts (legal, info, refundable, non-refundable) per language.
- **Availability** (`/availability`, `start_date`, `end_date`, `web_code`, optional `space_subtype_id`) → `space_subtypes[] { space_subtype_id, days[] { day, available_rooms, is_available } }`.
- **Space / room type** (`/space`) → space types → `space_subtypes` (capacity, adults, check-in and check-out times) → `spaces`. A subtype is what a reservation books.
- **Rate** (`/rate`) → `{ rate_id, rate_name, minimum_stay, maximum_stay, refundable, linked, master, mode, … }`.
- **Regime** (`/regime`) → `{ regime_id, name, active }`.
- **Extra** (`/extra`) → cost, VAT, stock, the subtypes and rates it applies to, and names and descriptions in 8 languages.
- **Promotional codes** → `[]` for Reserva Donato today.
- **Price** (`POST /price/price_for_reservation`, answers `201`, creates nothing):
  - Request: `{ start_date, end_date, rooms: [{ adults, children, space_subtype_id }], rate_ids? }`.
  - Response: one row per rate, `{ …, rate_id, price, base, increase { pax_increase, bed_increase }, regimes { cost, quantity }, fee }`. `price` is the stay's total.
  - **Every row comes twice, identical**, so the consumer de-duplicates.
- **Reservations by date** (`/reservation/dates`):
  - Field names are **camelCase** (`reservationId`, `checkInDate`, …).
  - `data` is an **array of arrays**, grouped by master reservation, with cursor pagination (`meta { take, itemCount, itemRemaining, hasNextPage, cursor }`).
  - **`charges` is required in practice**, although the spec marks it optional.
  - Deleted reservations are listed, with status `Eliminada`.
- **Reservation by id** (`/reservation/{id}`):
  - Field names are **snake_case** (`reservation_id`, …).
  - It returns `client { client_doc, name, surname, email, phone, … }`, `status`, `is_paid`, `advance` and `operator_reservation_id`.
  - A deleted reservation answers `400 ERROR_RETRIEVING_RESERVATIONS`.
  - **Neither reservation read returns `external_code`.**
- **Reservation create** (`POST /reservation`, **observed** on production: 3 test reservations, cancelled at once):
  - Request: `{ external_code?, promotional_code?, validateCode?, rooms[] }`. Each room has `space_subtype_id, quantity, adults, children, check_in, check_out` (ISO datetimes), `regime` (`"BB"`), `rate_id`, `status` (`"RESERVATION"`), `client { client_doc, name, surname, email, … }`, `price { payment_type, is_paid }` (**not an amount**), `operator_reservation_id`, `advance { total_advance, advance_type }`, `observations`, `additional_beds`, `extras[]`, `predefinedCharges[]`.
  - Response: `201`, the reservation with Avirato's own `price`, `status: "Reserva"` (the input is English, the reads are Spanish), `charges[]` and `billing[]` (a `Factura`, `status: "Pendiente"`, `bill_number: "0"`).
  - `external_code` comes back as **`promotional_package`**.
  - Sending only `client_doc` for an existing client sets `client_name` to `"undefined undefined"`, so the full client is always sent.
- **Reservation modify** (`PATCH /reservation/{reservation_id}`, **observed** on the sandbox 2026-10-31, reservations 239–240):
  - The room's **full record**: `action: "MODIFY"`, the stay, the party, `regime`, **`rateId`** (camelCase), `status: "RESERVATION"`, `client`, `price { payment_type, is_paid }`, `advance`, `operator_reservation_id`, `observations`, `additional_beds`, `extras`. No `quantity`.
  - **What Avirato refuses:**
    - a partial record → `400 ERROR_ON_UPDATE`;
    - a top-level `external_code` → `400 property externalCode should not exist`, though the spec lists it;
    - a cancelled reservation → `400 ERROR_RETRIEVING_DATA`.
  - It answers `200` with the updated reservation. Avirato reprices: 395000 → 790000 for one night → two. `promotional_package`, the tag, becomes `""`.
- **Reservation cancel** (`DELETE /reservation/{id}`, observed) → `200`, the reservation with `status: "Reserva cancelada"`. It is kept, no longer readable by id, and still listed by date, with its draft bill and charges.
- **Reservations by client** (`/reservation/client/{doc}`, observed) → snake_case rows. With 3 reservations under one document it returned **one** (R-9). An unknown document answers `400 ERROR_RETRIEVING_RESERVATIONS`, not an empty list.
- **Promotional code** (`/promotional_codes/{code}`, observed) → an unknown code answers `200 { data: "" }`.
- **Reservation links** (`/reservation/urls/{id}?type=AutoCheck|Guest|Shop`, observed) → `{ url }`. `Guest` is `https://guest.avirato.com/…`; **`Shop` is plain `http://shop.avirato.com/…`** (R-7).

```
connection (email + password, in Rail A) ──mints──▶ token ──reaches──▶ web_codes[]
web_code ──has──▶ space types ──have──▶ space subtypes ──booked by──▶ reservation rooms
reservation (master) ──has many──▶ rooms ──each has──▶ client, regime, rate, price
reservation ──has──▶ links (AutoCheck · Guest · Shop)
```

**Context:** `web_code` on `X-Provider-Metadata`, sent as the `web_code` query parameter on the 63 operations that take it.

## 8. Architectural Decisions

| #    | Decision                 | Choice                                                                                                                                                                                                                                                                               | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| :--- | :----------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AD-1 | Auth                     | `credential_exchange` against `POST /v3/token/login` (`bodyFields { email, password }`), `reference` delivery, `bearer_header`                                                                                                                                                       | Same shape as Erbon. The durable secret lives in Rail A, and the server only sees the minted JWT. Rail A reuses the token for the declared window (AD-2), which also keeps the logins out of the rate limit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AD-2 | Token shape and lifetime | `responseFields { token: 'data.token' }`, using a **closed dotted key path** (keys joined by `.`, no indices, wildcards or escapes), and `tokenTtlSeconds: 900`: with no expiry in the response, Rail A stores `expiresAt = now + TTL`. **Minting is single-flight** per connection. | CTO decision, 2026-10-30 (#189). A second login invalidates the first token (observed), so two concurrent mints would break each other: the backend mints one at a time per connection. The token comes nested, with no stated lifetime; without a declared window Rail A mints on every call (`credential-resolve.service.ts:79-81`). Both are data, not behaviour, so ADR 0010's declarative rule holds, and Siigo and Erbon are untouched. One ADR amends ADR 0010 and the glossary; the backend follows in a linked PR (provider before consumer). "Reuse until rejected" is not built: it needs a new cross-repo signal, its own ADR and a `cto-mission` issue, only if the spike shows the window is not enough. |
| AD-3 | Context                  | `contextSchema { web_code }`, chosen at connect from the login's `web_codes`                                                                                                                                                                                                         | `1 connection → N scopes`: the token alone cannot say which establishment (Explicit Context, as Cloudbeds' `propertyID`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AD-4 | Surface                  | Reads that touch nobody's money are on the menu. The quote and the writes are **control plane** (ADR 0013), called by the backend's booking ports.                                                                                                                                   | The quote is the number the agent narrates, composed by the backend's `stay-truth` (Erbon AD-2, Profitroom). Avirato prices a reservation itself (observed), so no write carries an amount. Even so, every write creates a reservation, charges and a draft bill in the hotel's own PMS, so it goes through the ports that carry identity, the quote and the duplicate check. The capability is not narrowed: the tenant's agent still books, changes and cancels, through the backend's booking tools it is assigned.                                                                                                                                                                                                 |
| AD-5 | Writes                   | Thin passthrough (ADR 0015): validate the shape, send, return verbatim. One tool call is at most one mutation.                                                                                                                                                                       | Duplicate detection, the confirmation and retries live in the consumer. The provider passes through whatever field carries the consumer's reconciliation tag. Which field that is waits on P-4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| AD-6 | Reservation status       | `status` is a required input of `create_reservation`, with no default in the provider                                                                                                                                                                                                | It is the hotel's policy (`tenant-autonomy.md`). The tenant's instructions decide, and the backend passes the value through.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AD-7 | Rate limit               | 429 → `PROVIDER_RATE_LIMITED`, with no retries and no in-process limiter. The transport does not expose response headers, so the reset time is not surfaced in v1.                                                                                                                   | Canonical pattern (ADR 0009) and complexity on demand. The limit is 600 requests per 5 minutes (observed), per IP, shared by every tenant (R-2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AD-8 | Identity                 | Identity policies per §6.1 (ADR 0019, 0023), declared by the provider and enforced by the consumer                                                                                                                                                                                   | The reservation reads and writes take an id or a document and act with the hotel's token, so the consumer must know whose record each one is.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## 9. Risks & Open Questions

### Risks

| #   | Risk                                                                                                                                                  | Likelihood           | Impact     | Mitigation                                                                                                                                                                                                  |
| :-- | :---------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------- | :--------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | **The token's real lifetime is unknown.**                                                                                                             | Low                  | Med        | A sandbox token was still accepted after 17 minutes (2026-10-31), so the declared 15-minute window sits inside the real lifetime. A second login invalidates the first, hence single-flight minting (AD-2). |
| R-2 | **Per-IP rate limit shared across tenants** (600 / 5 min, observed). One busy hotel can starve another.                                               | Low now (one tenant) | High later | `PROVIDER_RATE_LIMITED` is surfaced, and tokens are reused. Revisit with the second Avirato tenant: a shared guard would be new infrastructure, which needs an ADR.                                         |
| R-3 | **The sandbox holds real guest data** (yesterday's copy of production).                                                                               | High                 | Med        | Fixtures carry no personal data. Test writes are created and cancelled the same day, with an `external_code` that marks them.                                                                               |
| R-4 | **The API user's permissions are too narrow** (a 403 on a read we need).                                                                              | Med                  | Low        | The spike exercises every tool and turns on the missing permission. The connect guide lists the permissions.                                                                                                |
| R-5 | **Rail A's behaviour on a 401 with a cached token** (does it mint again?) has not been checked in the code.                                           | Med                  | Med        | Checked in the backend phase before the first live call (CTO, 2026-10-30).                                                                                                                                  |
| R-6 | **A shared API user logs the agent out.** Any login with the same user (a person testing, another environment) invalidates the token the agent holds. | High if shared       | High       | One Avirato API user per environment and per tester (§6.5), named in the connect guide.                                                                                                                     |
| R-7 | **The `Shop` link is plain HTTP.** A payment page reached over `http://` can be read or altered in transit.                                           | Med                  | High       | If P-1 shows `Shop` carries the payment, raise it with Avirato, and prefer `Guest` when it also pays. The provider never rewrites a URL it did not build.                                                   |
| R-8 | **Every reservation leaves a draft bill and charges in the hotel's billing**, and cancelling keeps them (observed).                                   | High                 | Med        | The connect guide tells the hotel; the API has no bill delete. The consumer never creates a reservation it is not about to keep (quote first, confirm, then create).                                        |
| R-9 | **Find-by-document returned one reservation of three** under the same document (observed). A guest with several stays may see only one.               | Med                  | Med        | The tool says it returns what Avirato returns; the consumer falls back to the reservation id the guest holds. Raised with Avirato.                                                                          |

### Open Questions

| #   | Question                                                                                                                          | Needed By            | Owner                    | Resolution                                                                                                                                                                   |
| :-- | :-------------------------------------------------------------------------------------------------------------------------------- | :------------------- | :----------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1 | Which link carries the payment: `Guest` or `Shop`?                                                                                | Backend phase        | A production reservation | Pending. It cannot be answered on the sandbox: a sandbox reservation's Guest link opens Avirato's production guest app, which answers "Reserva no encontrada (404)".         |
| P-2 | How long does a token live, does a second login invalidate the first, and which code does a rejected token return on a data call? | Merge to `dev`       | Spike                    | Partly resolved (production, 2026-10-30): a second login invalidates the first, and a rejected token answers `401 Unauthorized "Invalid token"`. The lifetime is still open. |
| P-3 | Does `DELETE /reservation/{id}` leave the reservation as `Reserva cancelada` or as `Eliminada`?                                   | Contract             | Spike                    | Resolved (production, 2026-10-30): `Reserva cancelada`, kept and listed, no longer readable by id.                                                                           |
| P-4 | Which field carries the consumer's reconciliation tag, so it can be read back after a lost response?                              | Contract             | Spike                    | Resolved: `external_code` on create comes back as `promotional_package` on every read.                                                                                       |
| P-5 | Which `client` fields are required on create, and does Avirato create the client inline?                                          | Contract             | Spike                    | Resolved: `client_doc` is required, and Avirato creates the client inline. Send the full client every time (doc only → `"undefined undefined"`).                             |
| P-6 | Do `/regime`, `/extra` and `/availability` need permissions beyond the reservation ones?                                          | Contract             | Spike                    | Pending                                                                                                                                                                      |
| Q-1 | Does Avirato email the guest when a reservation is created or cancelled through the API?                                          | Backend phase        | Spike / hotel            | Pending. The hotel's configuration in Avirato, surfaced to the tenant.                                                                                                       |
| Q-2 | Which rate does Reserva Donato sell through the agent? Its list mixes its own rates with channel rates (`Booking`, `AIRBNB`).     | Backend phase        | Hotel                    | Pending. The tenant's policy, held in its configuration, never in code.                                                                                                      |
| P-7 | How is a reservation modified?                                                                                                    | `modify_reservation` | Sandbox                  | Resolved (2026-10-31): the full record with `rateId` and no `quantity`. Avirato reprices and clears the tag; `external_code` is refused on modify.                           |

## 10. Phasing & Roadmap

| Phase                       | Scope Summary       | Key Deliverables                                                                                                                                                                                 | Dependencies                                                                               | Est. Effort |
| :-------------------------- | :------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- | :---------- |
| **0 — Spike**               | Observe the sandbox | Login, every read, a test reservation created, modified and cancelled; answers to P-1, P-3 to P-6 and the token's lifetime; `sandbox-evidence.md`. The reads are already observed on production. | The API user's credentials in Doppler (created 2026-10-30, in the sandbox from 2026-10-31) | S           |
| **1 — Provider**            | This design         | ADR for AD-2 + core change; `src/providers/avirato/` with the 14 tools; contract; conformance; `mcp-contract-qa`                                                                                 | Phase 0                                                                                    | M           |
| **2 — Backend** (own issue) | Consumer            | Rail A: the path reader and Avirato's `credential-exchange-providers` entry; `booking/adapters/avirato/` behind the existing ports; connect flow with the `web_code` choice                      | Phase 1 merged (provider before consumer)                                                  | M           |
| **3 — Live**                | Reserva Donato      | Real connection, E2E over WhatsApp, release                                                                                                                                                      | Phase 2                                                                                    | S           |

## 11. Agentic Context

- **Repo scope:** xcale-mcp-server, plus the one core change of AD-2 under its own ADR. The backend half is Phase 2, in its own issue.
- **Templates:** Erbon (`src/providers/erbon/`) for `credential_exchange` + `reference` and the control-plane split; Cloudbeds (`src/providers/cloudbeds/`) for `contextSchema`, reservation writes and identity policies; Profitroom for the money tool off the menu.
- **Provider anatomy:** `manifest.ts`, `auth.ts`, `context.ts`, `client.ts` (base `https://apiv3.avirato.com`, the `web_code` query parameter), `errors.ts`, `tools.ts` (`defineTool`, zod as the single source of truth), `provider.ts` (factory + DI), `index.ts`, `__fixtures__/`, `__tests__/`.
- **Invariants:** Provider Self-Containment; Consumer-Agnostic (no tenant or xcale concept on the wire); Credential-in-Transit-Only (`SecretString`, `.reveal()` only at egress).
- **DoD:** `server/discover` lists `avirato` with its `authDescriptor` and `contextSchema`; `tools/list` returns the 10 menu tools; `tools/call check_availability` is green against the sandbox; a forced 401 returns `PROVIDER_AUTH_EXPIRED`; a forced 429 returns `PROVIDER_RATE_LIMITED`.
- **Next:** the Phase 0 spike, then `/api-contract-authoring` → `api-contract.md` in this folder, then `/implementation-plan`.
