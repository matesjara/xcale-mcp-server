# HotelSync — grill notes (pre feature-design)

- **Status:** alignment (grill) — decisions resolved; the feature-design follows in this folder.
- **Date:** 2026-10-29
- **Issue:** matesjara/xcale-mcp-server#187 (the CTO's decision on auth is its first comment).
- **Code target repos:** `xcale-mcp-server` (core change + the `hotelsync` provider); `xcale-backend` (Rail A,
  the `booking` module, the webhook receiver); `xcale-frontend` (the connect form).
- **Source:** HotelSync OpenAPI 3.1 (`https://api-docs.hotelsync.com/openapi.yaml`, `info.version`
  `2026-10-28`). **Nothing here is observed on the wire yet** — no login, no staging property. Every wire fact
  below is read from the spec and stays an open question until observed (evidence before contract).
- **First customer:** a short-term rentals operator whose HotelSync account is resold by **Kunas**, a
  reseller running on HotelSync. Kunas issued a partner token (in Doppler-to-be, never in the repo) and said
  the integration logs in with "the Kunas account's user" — no dedicated integration user.

> Working document. Records the decisions and open questions of the grill; the feature-design is authorized.

---

## 1. Scope

A **HotelSync** PMS provider so an xcale agent can quote real availability and prices and **book, modify and
cancel** reservations for a hotel over WhatsApp, and so xcale-backend learns of reservation changes made
elsewhere (webhooks).

- **Phase 1a — reads**, built first: properties, room types, rate plans, availability, restrictions, prices.
- **Phase 1b — writes**, built once a staging sandbox exists: create, modify and cancel a reservation, and
  webhook registration. No write tool enters the API contract before it is observed in staging: in
  production every call creates real reservations, invoices and fiscal records.

## 2. Recon findings (from the spec — unobserved)

1. **Auth is a session login.** `POST /api/user/auth/login` with JSON `{token, username, password}` → JSON
   carrying `pkey` (the session key), the user's permission levels and `properties` (the properties the user
   can access). The response's `Content-Type` is `text/html`; the body is JSON.
2. **Every other call is a POST whose JSON body carries the auth**: `token` (partner token), `key` (the
   `pkey`) and `id_properties`. Nothing travels in a header.
3. **No documented session lifetime.** `401 Session key invalid` → log in again. `remember` is "reserved".
4. **2FA:** a login on an account with 2FA that is "not recognised" answers `511` with a challenge; its
   `pkey` is not a session.
5. **Two environments, two partner tokens:** staging `https://beta.hotelsync.com` (create one test property and
   tell HotelSync which) and production `https://app.hotelsync.com`.
6. **Two ways to book:** the booking engine (`/api/engine/*`, keyed by `engine_code`) creates and reads a
   reservation but **cannot modify or cancel one**; the PMS surface (`/api/reservation/*`) creates, edits
   (`edit/basics_new`, `edit/update_room`, `edit/status`, …) and deletes.
7. **Pricing by occupancy exists on the PMS surface:** `/api/prices/data/reservation_room_type_prices`
   computes a room type's total for a stay and a guest composition. `/api/prices/data/prices` is the per-date
   matrix per rate plan; restrictions (minimum stay, closures) are their own read
   (`/api/restrictions/data/restrictions`).
8. **Webhooks carry no signature.** `POST /api/webhooks/insert/webhook` takes only a `url`, is active at once
   and posts reservations, invoices, etc.; max 20 per property. `test_webhook` returns a sample payload for a
   `data_type` without delivering it.
9. **No "my properties" endpoint** outside the login response (`/api/engine/data/properties` is a
   booking-engine group listing that needs `id_multiproperties`).

## 3. Resolved decisions

- **D1 — Scope: reads, then writes.** Everything in §1 is phase 1; reads are built now, writes join once
  staging exists. *Why:* the customer needs the agent to book, modify and cancel; but a write cannot be
  verified safely without staging.
- **D2 — Auth: `credential_exchange` + `reference`, session key in the body** — the CTO's decision on #187,
  recorded in the ADR `credential-exchange-session-key-in-body` (this folder's PR). In short: (1) the minted
  `pkey` is placed in the JSON body as `key`; (2) the partner `token` is a per-connection secret in Rail A,
  used in the login body and returned at resolve as a **body companion** placed as `token`; (3) with no
  expiry declared, Rail A **reuses the session until rejected**; a data-call `401` → `PROVIDER_AUTH_EXPIRED`
  → the consumer drops the cached session and retries once with a fresh reference before any reconnect; a
  login `511` is never retried and asks the hotel to reconnect ("two-factor authentication required").
  *Rejected:* logging in on every call (forwards the durable credential to the server on every call — ADR
  0010's rejected alternative — and is the likeliest way to trip `511`); a server-side session cache (ADR
  0005).
- **D3 — The money guard, as Erbon and Cloudbeds.** The agent menu carries no money. Price reads are
  routable but not listed (`controlPlane`, ADR 0013); xcale-backend's `booking` module composes the quote
  (`StayQuote`) and the agent narrates its total. *Why:* the agent quoted pre-tax totals to real guests twice
  (`stay-truth.port.ts`).
- **D4 — The PMS surface for everything, not the booking engine.** The engine cannot modify or cancel (§2.6);
  one surface and one property identifier keep the provider simple. Quotes use
  `reservation_room_type_prices` (occupancy-aware), and the hotel's restrictions are read as they are, so the
  agent never offers a stay the hotel does not sell — the hotel's own configuration, read faithfully, not a
  rule of ours. `engine_code` is not needed.
- **D5 — Modify and cancel follow Cloudbeds' identity model.** The write tools that name a reservation
  declare an `identityPolicy` (ADR 0019, 0023: `subject-bound`, `recordKind: reservation`, `recordAction:
  change | cancel`, the reservation's phone/email as identity fields); xcale-backend enforces it against what
  the person writing has proven (its ADR 0062). Whether the agent cancels on its own, asks to confirm or hands
  the case to the front desk is the hotel's policy, in its agent's instructions — not code.
- **D6 — Webhooks: an unguessable URL, the event is a hint.** No signature exists (§2.8), so xcale-backend
  generates a per-connection secret and registers `…/api/webhooks/hotelsync/<secret>` (Cloudbeds' shape,
  `xcale-backend/src/modules/cloudbeds/webhooks/webhook-secret.ts`). An event is never trusted: the backend
  re-reads the reservation from the API and acts on that. xcale-backend registers the webhook at connect and
  removes it at disconnect; this server only exposes register / list / delete tools, none on the agent menu.
- **D7 — `id_properties` is the connection's identity.** A `contextSchema` key collected at connect, carried
  on `X-Provider-Metadata`, never a tool input; a `connectionProbe` reads `/api/property/data/property`. One
  connection per property. A login that sees several properties (a Kunas-managed user may) still reaches only
  the property the tenant connected — honouring the tenant's configuration, fail-closed.
- **Settled by code (not grilled):** data returned verbatim (*Fidelity over Unification*); errors through
  `mapHttpStatusToErrorCode`, plain-text error bodies never interpolated; tools via `defineTool`; factory
  `createHotelSyncProvider(deps?)`; one line in `src/providers/index.ts`; the host is deployment config,
  allowlisted to `app.hotelsync.com` / `beta.hotelsync.com`, never consumer-supplied.

## 4. Proposed tools

All POST; `token`, `key` and `id_properties` are placed by the core, never by a handler or an input.

### Agent menu (`listTools`) — money-free

| Tool | Endpoint | Phase |
| --- | --- | --- |
| `hotelsync_get_property` | `/api/property/data/property` | 1a |
| `hotelsync_list_room_types` | `/api/room/data/rooms` | 1a |
| `hotelsync_list_rate_plans` | `/api/pricingPlan/data/pricing_plans` | 1a |
| `hotelsync_check_availability` | `/api/avail/data/avail` | 1a |
| `hotelsync_list_restrictions` | `/api/restrictions/data/restrictions` | 1a |
| `hotelsync_get_reservation` | `/api/reservation/data/reservation` (identity-bound) | 1a |
| `hotelsync_create_reservation` | `/api/reservation/insert/reservation` | 1b |
| `hotelsync_modify_reservation` | `/api/reservation/edit/basics_new`, `edit/update_room` (identity-bound) | 1b |
| `hotelsync_cancel_reservation` | `/api/reservation/edit/status` (identity-bound) | 1b |

### Routable, not listed (`controlPlane`)

| Tool | Endpoint | Why hidden | Phase |
| --- | --- | --- | --- |
| `hotelsync_get_prices` | `/api/prices/data/prices` | money | 1a |
| `hotelsync_quote_room_type` | `/api/prices/data/reservation_room_type_prices` | money — composes `StayQuote` | 1a |
| `hotelsync_register_webhook` / `_list_webhooks` / `_delete_webhook` | `/api/webhooks/*` | lifecycle, run by the consumer | 1b |

Names and the exact endpoint for each edit are the contract's to fix once observed; cancel via `edit/status`
vs `delete/delete` is open (Q7).

## 5. Open questions — settled only by Kunas or staging

| # | Question | Owner |
| --- | --- | --- |
| Q1 | Is Kunas's token a production or a staging partner token; per reseller, per account or per integrator? | Esteban → Kunas |
| Q2 | Whose login — the customer's own Kunas user or one Kunas manages? Is 2FA on? Does a datacenter login trip `511`? | Esteban → Kunas |
| Q3 | How long does a `pkey` live, idle and absolute? Does a new login invalidate earlier ones? | staging |
| Q4 | Is a dead session always `401`, or sometimes `403`? | staging |
| Q5 | Which properties does the login list? (isolation check for a Kunas-managed user) | first login |
| Q6 | Do prices include taxes and extra-person charges? | staging / HotelSync |
| Q7 | Is cancel `edit/status` (kept as a cancelled record) or `delete/delete`? Does a read-only token `403` every write? | staging |
| Q8 | Webhook payload shape and event types; does an event carry enough to re-read the reservation by id? | staging (`test_webhook`) |

## 6. ADRs

| ADR | Status | Reason |
| --- | --- | --- |
| `credential-exchange-session-key-in-body` | Proposed (this PR) | Changes `src/core` and the published `authDescriptor`, the Hop-B resolve shape and ADR 0010's resolve policy; hard to reverse once connections exist. |

## 7. CONTEXT.md

Two terms from the ADR, added in this PR: **Body companion** and **Reuse until rejected**.

## 8. Next step

feature-design (this folder) → implementation-plan for the core + Rail A changes, which need no HotelSync
evidence → api-contract for reads once the login is in hand → for writes once staging exists.
