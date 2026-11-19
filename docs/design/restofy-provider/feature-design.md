# Restofy Provider — Feature Design

> **Feature**: Onboard Restofy (Colombian restaurant POS) as an MCP provider, so an xcale agent can read a restaurant's real menu, quote and place orders into its POS, follow an order, and book, find and cancel tables.
> **Priority**: P1. A customer is waiting: Basto, a restaurant on Restofy.
> **Owner**: Sara · **Issues**: epic matesjara/xcale-backend#2933 · access #2934 · adapter #2935 · CRM #2936
> **Status**: Draft
> **Target Release**: Phase 1, the provider with the menu, orders and reservations without deposit
> **Last Updated**: 2026-11-18

---

> **Grounding.** The decisions here come from the grill of 2026-11-18 (Sara) and from Restofy's published API docs (`https://restofy.pro/apps/docs/api/`, v11). **Everything on the wire was observed on 2026-11-18** against a free Básico account we own, restaurant _xcale Test Restaurante_: the token exchange, the menu, a dry-run and three real orders, the idempotency behaviour, contacts, a reservation created and cancelled, the public reservation slots, and the delivery-status values. The evidence is on xcale-backend#2934 and in [api-contract.md](api-contract.md) §A. Where the docs and the wire disagree, §7 says so.

> **Architectural guardrail.** This design instantiates machinery that already exists: `credential_exchange` with `reference` delivery and a dotted token path with a declared TTL (Avirato, ADR `credential-exchange-response-path-and-token-ttl`), control-plane tools (ADR 0013), thin write passthrough (ADR 0015), identity policies with record lookups (ADR 0019, 0023) and the audience declaration (ADR 0021). **It changes nothing in `src/core`.** Anything implementation finds it needs there stops the work and opens an ADR.

---

## 1. Problem Statement

**What's happening?** Restaurants on Restofy get WhatsApp messages all day: _what do you have, how much is it, send me two burgers, where is my order, do you have a table for four on Friday_. xcale has no Restofy provider, so the agent can answer none of it from the restaurant's real POS, and every order is retyped by hand.

**Why now?** Basto, a Restofy restaurant, is waiting to go live. Restofy's API is public, documented and self-serve: the restaurant creates an API key in its own panel, with no partner agreement and no IP allowlist (unlike LobbyPMS).

**Cost of inaction.** A waiting customer cannot go live, and orders stay manual and bound to the staff's hours. Restofy is Colombian and has a free plan, so more restaurants on it will follow.

## 2. Goals & Success Metrics

| Type      | Metric                                                  | Target                                                                                                | How Measured                            |
| :-------- | :------------------------------------------------------ | :---------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| Leading   | The agent reads the real menu and quotes an order       | `list_catalog` + `quote_order` green against the test restaurant, totals equal to Restofy's           | Provider tests + `mcp-contract-qa`      |
| Leading   | An order the agent closes lands in the POS exactly once | `create_order` repeated with the same reference returns the same order (observed)                     | Contract QA against the test account    |
| Leading   | A table is booked for a diner                           | contact found or created, reservation created, found by phone, cancelled                              | Contract QA against the test account    |
| Lagging   | Basto goes live                                         | Live connection with real orders by agent                                                             | Backend phase, the first conversation   |
| Guardrail | No credential persists on the server                    | The API key never reaches the server; the minted JWT only in transit (`SecretString`, nothing logged) | Credential-boundary and redaction tests |
| Guardrail | Self-contained provider                                 | Only `src/providers/restofy/` + 1 line in `src/providers/index.ts` + its logo                         | PR diff                                 |

## 3. Target Users

| User                                    | Role              | What they get                                                                                                                                |
| :-------------------------------------- | :---------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| **Diner** (WhatsApp)                    | End user          | The real menu and prices, an order placed in the conversation, its status on request, a table booked or cancelled.                           |
| **Restaurant staff** (Basto)            | Operator          | Orders and reservations that land in Restofy without retyping; the restaurant's own rules for channels, prices and capacity.                 |
| **xcale agent** (LLM)                   | Consumer of tools | The menu, quote, order status, contacts and reservation tools on its menu. The order write goes through the backend's commerce port.         |
| **xcale-backend** (Rail A + `commerce`) | Consumer system   | A consumer-agnostic surface: Rail A mints the token; the commerce adapters (catalog truth, materialization) call it by name, as Toteat's do. |

## 4. User Stories

### Must Have (P0)

- **US-01**: As a diner, I ask what there is, and the agent answers from the restaurant's real menu, with prices, options and extras.
- **US-02**: As a diner, I say "two burgers, medium, with extra cheese, for delivery", and the agent tells me the exact total Restofy computes before I confirm.
- **US-03**: As a diner, I confirm, and the order lands in the restaurant's POS once, with my name, phone and address, unpaid; I pay on delivery or at pickup.
- **US-04**: As a diner, I ask "where is my order?", and the agent tells me what Restofy knows about it.
- **US-05**: As a diner, I ask for a table for four on Friday at 8 pm; the agent checks the restaurant's slots and its area rules, and books it in my name.
- **US-06**: As a diner, I ask to see or cancel my reservation, and only mine (identity policy).
- **US-07**: As restaurant staff, I connect Restofy once by pasting my API key and my account key.
- **US-08**: As the backend, when Restofy rejects the token, I get `PROVIDER_AUTH_EXPIRED` and mint again or prompt a reconnect.

## 5. Feature Scope (MoSCoW)

### ✅ Must Have — Phase 1

- [ ] A `restofy` provider: `credential_exchange` against `POST /api/auth/create-api-token`, `reference` delivery, no `contextSchema` (AD-1, AD-2, AD-3).
- [ ] The 16 tools of the contract §C: 13 on the agent's menu, 3 control plane (AD-4).
- [ ] The order idempotency key, derived by the provider from the order (AD-6).
- [ ] `create_contact` that never overwrites an existing contact (AD-7).
- [ ] Verbatim data (Fidelity over Unification), typed errors per contract §D, no internal retries.
- [ ] Identity policies on every tool that reads or names an order, a reservation or a person (ADR 0019, 0023), and every published tool classified `customer` (ADR 0021).
- [ ] Fixtures from the observed responses of the test restaurant (synthetic data only), the conformance suite, a redaction test, and `mcp-contract-qa` against the test account.

### 🟡 Should Have

- [ ] `list_guest_occasions` (birthday, anniversary…), if Basto uses them when booking.

### 🔵 Could Have

- [ ] Assigning a table to a reservation (`set-assigned-table`).

### ⛔ Won't Have — Out of Scope

- **Payment.** v1 orders go in unpaid (`paymentStatus: "unpaid"`, observed); the restaurant collects on delivery or at pickup. Online payment through xcale's Payment Request, and registering it on the Restofy order, is a fast-follow (xcale-backend#2933, comment of 2026-11-18). Restofy's own diner payment needs the diner's Restofy session and cannot be driven by an agent.
- **Reservation deposits** (`create-reservation-advance`, PSE). Fast-follow, once observed.
- **Proactive status updates and CRM sync.** Restofy publishes no webhooks. Polling orders, reservations and contacts is the backend's, built once in xcale-backend#2936. `list_reservations` (control plane) is the only piece this provider ships for it.
- **Modifying a reservation** (`update-reservation`) and **editing a contact**. On demand.
- **Restaurant administration**: products, prices, areas, channels, cash registers, kitchen stages. Operations decisions, not a conversation.
- **The diner surface for writes** (`/api/diner-*`). It needs the diner's own Restofy session. Only its public slots read is used (AD-8).
- **A canonical order or reservation model.** Data is returned verbatim; the backend's commerce adapters compose what the agent narrates.

## 6. UX & Interaction Design (agent, diner and restaurant)

There is no screen in this repo. The experience is the agent's tools and the conversation they produce.

### 6.1 The tools

| Tool                                     | Restofy endpoint                                                       | Surface       | Identity                                                        |
| :--------------------------------------- | :--------------------------------------------------------------------- | :------------ | :-------------------------------------------------------------- |
| `mcp_restofy_get_business_profile`       | `business-profile/get-business-profile`                                | menu          | none                                                            |
| `mcp_restofy_list_fulfillments`          | `integration/list-fulfillments`                                        | menu          | none                                                            |
| `mcp_restofy_list_catalog`               | `integration/list-catalog-products`                                    | menu          | none                                                            |
| `mcp_restofy_quote_order`                | `integration/create-order` with `dryRun: true`                         | menu          | none                                                            |
| `mcp_restofy_create_order`               | `integration/create-order`                                             | control plane | none (its creator owns what it creates)                         |
| `mcp_restofy_get_order`                  | `integration/get-order`                                                | menu          | subject-bound, owner of the order (`restofy:order`)             |
| `mcp_restofy_find_contact_by_phone`      | `parties/get-party-by-phone`                                           | menu          | subject-bound on `phone`                                        |
| `mcp_restofy_create_contact`             | `parties/get-party-by-phone`, then `parties/set-party`                 | menu          | subject-bound on `phone`                                        |
| `mcp_restofy_list_reservation_areas`     | `reservation-areas/list-…` + `get-reservation-area`                    | menu          | none                                                            |
| `mcp_restofy_list_reservation_slots`     | `tenants/get-tenant-info` + `diner-reservation/list-reservation-slots` | menu          | none                                                            |
| `mcp_restofy_create_reservation`         | `reservations/create-reservation`                                      | menu          | none (its creator owns what it creates)                         |
| `mcp_restofy_find_reservations_by_phone` | `reservations/list-reservations` (`search`)                            | menu          | subject-bound on `phone`, record lookup                         |
| `mcp_restofy_get_reservation`            | `reservations/get-reservation-detail`                                  | menu          | subject-bound, owner of the reservation (`restofy:reservation`) |
| `mcp_restofy_cancel_reservation`         | `reservations/cancel-reservation`                                      | menu          | subject-bound, owner of the reservation, `cancel`               |
| `mcp_restofy_list_reservations`          | `reservations/list-reservations`                                       | control plane | subject-scoped                                                  |
| `mcp_restofy_find_order_by_reference`    | `integration/get-order` by `externalReference`                         | control plane | none — reconciliation by the caller's own reference             |

Every published tool is `audience: 'customer'`.

### 6.2 Read the menu

The agent calls `list_fulfillments` to learn the restaurant's delivery channels, and `list_catalog` with one of them to read the menu: products with base prices, price variants, modifier groups with their min/max selections, modifiers with their prices, and allergens. **The menu depends on the channel** (`fulfillmentUuid` is required by Restofy), so prices can differ between delivery and takeout if the restaurant sets them so.

- **Browsing**: the agent reads the menu on the restaurant's main channel, chosen in the connection's configuration on the consumer's side; without one, the first channel `list_fulfillments` returns. It answers at once, without interrogating the diner.
- **No channel at all** (observed on a new restaurant: only "En mesa" exists, and Restofy hides it from integrations): `list_fulfillments` returns an empty list. The tool's description says what that means, and the connect guide tells the restaurant to create a delivery or takeout channel.
- **Large menus** page at 100 products. Modifier groups and modifiers come with the page of products they belong to (observed).

### 6.3 Quote and order

The diner says what they want and how they get it (delivery or pickup). The agent builds the lines with the menu's ids and calls `quote_order` on **that** channel: Restofy validates everything and computes the totals without saving (`dryRun`). The total the agent confirms comes from the quote, never from the menu it showed before.

- **A required option missing** (e.g. the burger's doneness): Restofy refuses with a message naming the group (observed); the agent asks the diner.
- **Delivery without an address**: refused, "Falta el nombre, el teléfono o la dirección del cliente" (observed).

The diner confirms. The backend's commerce materialization calls `create_order` with the same lines and its own `externalReference`. **Restofy creates the order atomically and at most once per reference** (observed): a retry with the same reference returns the existing order with `isExistingOrder: true`. The order goes in `open` and `unpaid`; the channel's rules decide whether it goes straight to the kitchen.

### 6.4 Follow an order

When the diner asks, the agent calls `get_order` with the order id, and narrates `lifecycleStatus`, `paymentStatus` and, on delivery, `deliveryStatus`, verbatim.

**What Restofy does not tell an integration (observed):** moving the order through the kitchen board (`cooking`, `ready`, `dispatched`) does not change anything `get-order` returns; the order stays `open`. On delivery, `deliveryStatus` moves from `pending` to `in_transit`, `delivered`, `failed` or `cancelled` (the last observed, the others documented). So "your order is being cooked" cannot be read from the API; the tool's description says so, and the agent never invents it.

### 6.5 Book a table

1. **Who**: `find_contact_by_phone` with the diner's phone in E.164 (`+573001112233`). **The lookup is exact** (observed: `573001112233` and `3001112233` do not find `+573001112233`). Not found → `create_contact` with name and phone.
2. **Where and when**: `list_reservation_areas` returns each area with the restaurant's own rules (capacity, min and max party size, minimum notice, how far ahead, online-bookable). `list_reservation_slots` returns the half-hour slots of a day and whether each is full, **computed by Restofy from the restaurant's own rules** — only for areas the restaurant made bookable online.
3. **Book**: `create_reservation` with the contact, the area, the time, the party size and notes. It is confirmed at once.

**Restofy's management API does not check capacity or party size (observed):** a party of 60 in an area for 50 with a maximum party of 8 was accepted. The provider does not block it either — that would narrow the agent (`tenant-autonomy.md`). It hands the agent the facts (the area's rules, the slots) and says in the description that the booking is not checked against them; the restaurant's instructions decide the conduct.

**Restofy sends the diner its own WhatsApp reminder** a few hours before, when the contact has a phone (documented). That is the restaurant's configuration in Restofy; the connect guide tells it.

### 6.6 Find and cancel a reservation

`find_reservations_by_phone` lists a diner's reservations (upcoming by default), and `get_reservation` reads one by id; the identity policy lets the consumer show only the diner's own. `cancel_reservation` takes a reason, cancels a `pending`, `confirmed` or `seated` reservation, and refuses one already cancelled (observed).

### 6.7 Connect (restaurant staff)

Once, in Restofy's panel (**Administración › Sistema › API Keys**), the restaurant creates a key and copies it (shown once), and copies its account key (`tenantKey`), shown on the same page. The key's user needs the permissions of the tools the restaurant wants: `orders.integration` for the menu and orders, `reservations.module` for reservations, contacts for parties. In xcale it pastes both. Rail A mints a token, which proves the credential. One key reaches one restaurant; several branches are several connections.

The connect guide also tells the restaurant: create a delivery or takeout channel (§6.2); make an area bookable online if it wants slots (§6.5); Restofy reminds diners by WhatsApp on its own (§6.5).

## 7. Data Model Sketch

No canonical DTOs: data is returned verbatim. Every Restofy response is `{ success, message, data }`, every call a `POST` with a JSON body, every amount an integer in **cents** of the restaurant's currency (COP 32.000 → `3200000`, observed). The contract fixes the fields.

```
connection (apiKey + tenantKey, in Rail A) ──mints──▶ JWT (7 days) ──seals──▶ one restaurant
restaurant ──has──▶ fulfillments (delivery, takeout…) ──price──▶ menu (menus → products → price variants, modifier groups → modifiers)
order (externalReference, at most once) ──has──▶ items ──have──▶ itemModifiers
contact (party, by exact phone) ──books──▶ reservation ──in──▶ reservation area (rules) ──offers──▶ slots
```

**Where the docs and the wire disagree (observed):**

- `create-order` requires an **`Idempotency-Key` header**, undocumented; without it, `400 Falta la clave de idempotencia`, dry runs included.
- `X-Tenant-Key` is not needed: the auth guide is right, the request page is not.
- `get-my-tenants` does not exist; `tenants/get-tenant-info` does, and returns the restaurant's public `slug`, timezone and currency.
- `list-parties` does not exist under that name; the actions are `get-party-by-phone`, `search` and `set-party`.
- `set-party` without an id, on a phone that already exists, **renames** that contact (observed).
- `list-catalog-products` takes `page` and `limit`, though its parameter table lists neither; `limit` is capped at 100 silently.
- The integration surface does not expose kitchen stages (§6.4).

## 8. Architectural Decisions

| #     | Decision          | Choice                                                                                                                                                                                                                                | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| :---- | :---------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AD-1  | Auth              | `credential_exchange` against `POST https://restofy.pro/api/auth/create-api-token`, `bodyFields { apiKey, tenantKey }`, `responseFields { token: 'data.accessToken' }`, `reference` delivery, `bearer_header`                         | Avirato's shape, no core change. The API key never reaches this server; Rail A mints and holds it.                                                                                                                                                                                                                                                                                                                                                                            |
| AD-2  | Token lifetime    | `tokenTtlSeconds: 86400` (1 day), though the JWT's `exp` is 7 days (observed)                                                                                                                                                         | The response carries no expiry field Rail A can read. A day sits well inside the real lifetime, does not depend on Restofy's clock, and costs one mint a day per connection. A 401 still answers `PROVIDER_AUTH_EXPIRED`, and Rail A mints again.                                                                                                                                                                                                                             |
| AD-3  | Context           | **No `contextSchema`**                                                                                                                                                                                                                | `1 connection → 1 scope`: the restaurant is sealed in the token (observed). Branches are several connections (Explicit Context).                                                                                                                                                                                                                                                                                                                                              |
| AD-4  | Surface           | The order write and the two reconciliation/history reads are **control plane** (ADR 0013); every other tool is on the menu, classified `customer`.                                                                                    | Grill decision: like Toteat in `commerce`. The order is placed by the backend's commerce materialization (Avirato AD-4, Toteat), which owns the confirm, the reference and the duplicate check; the agent still orders through the commerce tools. Reservations and contacts reach the agent through the gateway, with no backend port. `list_reservations` returns everyone's bookings and `find_order_by_reference` exists for reconciliation, so neither is an agent move. |
| AD-5  | Writes            | Thin passthrough (ADR 0015): validate the shape, send, return verbatim. One tool call is at most one mutation, never retried here.                                                                                                    | Duplicate detection, the confirmation and retries live in the consumer.                                                                                                                                                                                                                                                                                                                                                                                                       |
| AD-6  | Order idempotency | The provider **derives** the `Idempotency-Key` from the request: a UUID-shaped SHA-256 of `externalReference` + the canonical body. The caller supplies `externalReference`, required.                                                | Observed: the same key with the same body replays; the same key with another body is refused; a new key with a used reference returns the existing order. A derived key makes a retry of the same call replay, and a changed call with the same reference come back as the existing order — at most one order per reference, with no state in the server.                                                                                                                     |
| AD-7  | Contacts          | `create_contact` looks the phone up first and returns the existing contact untouched (`created: false`); it calls `set-party` only when none exists. It never updates.                                                                | Observed: `set-party` on an existing phone renames the contact. A diner typing another name must never rename the restaurant's customer. Knowing that is provider knowledge.                                                                                                                                                                                                                                                                                                  |
| AD-8  | Slots             | `list_reservation_slots` reads the restaurant's public slug with `get-tenant-info`, then calls the **public** diner endpoint `list-reservation-slots` (it answers with or without the token, observed).                               | The management API has no availability read. The diner surface's slots are the restaurant's own rules, and its writes need the diner's session, so only this read is used. Two calls, no metadata from the consumer.                                                                                                                                                                                                                                                          |
| AD-9  | Capacity          | Not enforced, not blocked. The area rules and slots are returned as facts; `create_reservation`'s description says Restofy does not check them on this path.                                                                          | Return the fact instead of acting (`tenant-autonomy.md`). Over-booking is the restaurant's call through its instructions.                                                                                                                                                                                                                                                                                                                                                     |
| AD-10 | Phones            | Phone inputs are E.164 (`^\+[1-9]\d{6,14}$`), validated, sent as given.                                                                                                                                                               | The lookup is exact-string (observed). One format end to end is what makes a contact findable again. Normalizing a local number is the consumer's (it knows the channel's number).                                                                                                                                                                                                                                                                                            |
| AD-11 | Errors            | `401` → `PROVIDER_AUTH_EXPIRED`; `400` → `PROVIDER_INVALID_INPUT` with Restofy's `message` (plain, user-facing Spanish, observed); `429` → `PROVIDER_RATE_LIMITED`; `403` → `PROVIDER_ERROR`; `5xx`/network → `PROVIDER_UNAVAILABLE`. | Restofy has no error codes, only `success: false` and a message that explains the problem to a person. The message is the fact the agent needs; it is forwarded under the redaction rule of §D of the contract.                                                                                                                                                                                                                                                               |

## 9. Risks & Open Questions

### Risks

| #   | Risk                                                                                                                                                                                 | Likelihood | Impact | Mitigation                                                                                                                         |
| :-- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------- | :----- | :--------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | **No rate limits are documented or sent** (no headers observed). A busy restaurant may hit an unknown wall.                                                                          | Med        | Med    | `429` → `PROVIDER_RATE_LIMITED`. Menu reads are the heavy ones; the backend may mirror the menu as it does Toteat's, its own call. |
| R-2 | **The kitchen stages are invisible to integrations** (§6.4). Diners ask "is it ready?".                                                                                              | High       | Low    | Described in the tool; the agent says what it knows. Asked of Restofy as a feature.                                                |
| R-3 | **Over-booking**: the management API books past capacity (observed).                                                                                                                 | Med        | Med    | Facts in front of the agent (AD-9); the restaurant's instructions decide.                                                          |
| R-4 | **A new restaurant has no integration channel** (observed), so the menu cannot be read.                                                                                              | High       | High   | `list_fulfillments` returns `[]` with a description that says why; the connect guide; the consumer checks it at connect.           |
| R-5 | **The key's user lacks a permission** (`reservations.module`, contacts), and a tool answers 403.                                                                                     | Med        | Low    | `PROVIDER_ERROR` with Restofy's message; the connect guide lists the permissions per capability.                                   |
| R-6 | **Phones stored by staff in another format** are not found by the exact lookup, and `create_contact` creates a duplicate.                                                            | Med        | Low    | E.164 end to end (AD-10). A duplicate contact is visible and mergeable in Restofy; never a rename.                                 |
| R-7 | **The public slug** was observed with a custom slug and with the account key; that a restaurant that never set one gets its account key from `get-tenant-info` is assumed, not seen. | Low        | Low    | Contract QA on a fresh restaurant. If it comes back empty, the tool says slots are not available rather than guessing.             |

### Open Questions

| #   | Question                                                                                   | Needed By     | Owner      | Resolution                                                                                                                                                                                                                          |
| :-- | :----------------------------------------------------------------------------------------- | :------------ | :--------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1 | Is `X-Tenant-Key` required?                                                                | Contract      | Sandbox    | Resolved: no. The restaurant is sealed in the token (observed).                                                                                                                                                                     |
| P-2 | Token lifetime and refresh?                                                                | Contract      | Sandbox    | Resolved: 7-day JWT (`exp`), no refresh; 401 on a bad token (observed). Declared 1 day (AD-2).                                                                                                                                      |
| P-3 | How is an order made idempotent?                                                           | Contract      | Sandbox    | Resolved: `Idempotency-Key` header + `externalReference` (AD-6, observed).                                                                                                                                                          |
| P-4 | Does one key reach reservations and contacts?                                              | Contract      | Sandbox    | Resolved: yes, with the user's permissions (observed).                                                                                                                                                                              |
| P-5 | Which status values does an order take?                                                    | Contract      | Sandbox    | Partly: `lifecycleStatus` `open`, `paymentStatus` `unpaid`, `deliveryStatus` `pending`/`cancelled` observed; `in_transit`/`delivered`/`failed` documented. Closing and paying an order not exercised. Returned verbatim either way. |
| P-6 | Webhooks?                                                                                  | Backend phase | Restofy    | None documented. Polling is #2936's.                                                                                                                                                                                                |
| P-7 | How are deposits paid, and through which gateway?                                          | Fast-follow   | Sandbox    | Pending; out of v1.                                                                                                                                                                                                                 |
| P-8 | Can an external payment be registered on an integration order?                             | Fast-follow   | Sandbox    | Pending (`pos-payment`, `payments`); for the Payment Request follow-up.                                                                                                                                                             |
| Q-1 | Which channel is Basto's main one for browsing, and does it price differently per channel? | Backend phase | Restaurant | Pending. The tenant's configuration, never code.                                                                                                                                                                                    |

## 10. Phasing & Roadmap

| Phase                       | Scope Summary            | Key Deliverables                                                                                                                                                           | Dependencies                              | Est. Effort |
| :-------------------------- | :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------- | :---------- |
| **0 — Spike**               | Observe the test account | Done 2026-11-18: auth, menu, quote, orders, idempotency, contacts, reservations, slots (xcale-backend#2934).                                                               | The test account and its key              | Done        |
| **1 — Provider**            | This design              | `src/providers/restofy/` with the 16 tools; conformance; `mcp-contract-qa` against the test account                                                                        | Phase 0                                   | M           |
| **2 — Backend** (own issue) | Consumer                 | Rail A's `credential-exchange-providers` entry; `commerce/adapters/restofy/` behind the existing ports; the restaurant template; connect flow with the main-channel choice | Phase 1 merged (provider before consumer) | M           |
| **3 — Live**                | Basto                    | Real connection, E2E over WhatsApp, release                                                                                                                                | Phase 2                                   | S           |
| **Fast-follow**             | —                        | Payment Request + registering the payment; deposits; polling for status updates and the CRM (#2936)                                                                        | Phase 3                                   | —           |

## 11. Agentic Context

- **Repo scope:** xcale-mcp-server only. No core change. The backend half is Phase 2, in its own issue.
- **Templates:** Avirato (`src/providers/avirato/`) for `credential_exchange` + `reference` with a dotted token path and a TTL, and for the control-plane split; Toteat for the restaurant shape and order reconciliation; WooCommerce and Cloudbeds for identity policies with record lookups and ownership.
- **Provider anatomy:** `manifest.ts`, `auth.ts`, `client.ts` (base `https://restofy.pro/api`, `POST` only, the envelope), `errors.ts`, `idempotency.ts`, `tools.ts` (`defineTool`, zod as the single source of truth), `provider.ts` (factory + DI), `index.ts`, `__fixtures__/`, `__tests__/`.
- **Invariants:** Provider Self-Containment; Consumer-Agnostic (no tenant or xcale concept on the wire); Credential-in-Transit-Only.
- **DoD:** `server/discover` lists `restofy` with its `authDescriptor` and no `contextSchema`; `tools/list` returns the 13 menu tools, each with `audience: 'customer'`; `quote_order` against the test account returns Restofy's totals; a forced 401 returns `PROVIDER_AUTH_EXPIRED`.
- **Next:** [api-contract.md](api-contract.md), then [implementation-plan.md](implementation-plan.md).
