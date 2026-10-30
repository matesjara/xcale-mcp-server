# HotelSync provider — Feature Design

> **Feature**: A HotelSync PMS provider — an xcale agent quotes, books, modifies and cancels a hotel's
> reservations over WhatsApp, and the consumer learns of reservation changes made elsewhere.
> **Priority**: P1 High — a customer is waiting to connect.
> **Owner**: Sara Estrada
> **Status**: Draft
> **Target Release**: Phase 1a (reads) as soon as the login is in hand; Phase 1b (writes, webhooks) once a
> staging property exists.
> **Last Updated**: 2026-10-29

Decisions come from the grill (`grill-notes.md`, this folder) and the CTO's decision on #187, recorded in the
ADR [`credential-exchange-session-key-in-body`](../../adr/credential-exchange-session-key-in-body.md).

---

## 1. Problem Statement

### What's happening?

Hotels whose PMS is **HotelSync** — including those that buy it through the reseller **Kunas** — cannot be
served by an xcale agent: no provider reaches their availability, prices or reservations. The first is a
short-term rentals operator that authorized xcale to answer its **direct bookings** on WhatsApp. Without a
provider the agent can only hand the guest to a person, and the hotel loses the bookings that arrive out of
hours.

### Who's affected?

- The hotel's guests, who write on WhatsApp to ask for prices, book, or change or cancel a stay.
- The hotel's staff, who answer each of those by hand in HotelSync.
- xcale, which cannot onboard any HotelSync or Kunas hotel.

### What's the cost of inaction?

Every HotelSync hotel is out of reach, the first customer cannot go live, and Kunas — a reseller with more
HotelSync accounts behind it — stays closed as a channel.

---

## 2. Goals & Success Metrics

### North Star

A guest of a HotelSync hotel gets a correct quote and a confirmed reservation from the agent on WhatsApp, with
nobody at the front desk involved.

### Metrics

| Type | Metric | Target | How Measured |
| :-- | :-- | :-- | :-- |
| **Leading** | Tool-call success for HotelSync tools | ≥ 98% of calls return `ok` or a typed provider error, never an opaque failure | Server logs by provider and tool |
| **Leading** | Logins per connection per day | ≤ a handful (a session is reused, not minted per message) | Rail A mint counter |
| **Lagging** | Reservations created by the agent in the first customer's account | ≥ 1 in the first week of Phase 1b in production | HotelSync reservations with the agent's source |
| **Lagging** | Quotes that differ from the hotel's own price for the same stay | 0 | Spot-checks against HotelSync's UI during the soak |

---

## 3. Target Users

This feature has no screen of its own in this repo. Its users are its consumers.

### The guest's agent (xcale-backend's agent runtime)

- **Context**: a guest asks on WhatsApp for dates, prices, a booking, a change or a cancellation.
- **Motivation**: answer with the hotel's real data and act on it.
- **Pain Today**: no HotelSync tools; it can only hand off.
- **Expected Benefit**: a money-free menu to explore and identity-bound tools to act, with quotes composed by
  the backend.

### xcale-backend (the MCP client)

- **Context**: holds the connection (Rail A), composes quotes (`booking`), receives webhooks.
- **Motivation**: consume HotelSync generically, from the catalog, like any provider.
- **Pain Today**: none of HotelSync's auth fits the current `credential_exchange` variant.
- **Expected Benefit**: one descriptor drives connect, mint, resolve and reconnect.

### The hotel operator (in xcale's dashboard)

- **Context**: connects its HotelSync account once.
- **Motivation**: let the agent work without handing over more than needed.
- **Pain Today**: nothing to connect.
- **Expected Benefit**: one form; reconnect asked only when it is truly needed.

---

## 4. User Stories

### Must Have (P0)

- **US-01**: As the hotel operator, I want to connect my HotelSync property with my partner token, user and
  password so that the agent can work on my property.
- **US-02**: As the agent, I want to read the property's room types, rate plans, availability and
  restrictions so that I only offer what the hotel sells.
- **US-03**: As xcale-backend, I want an occupancy-aware price for a room type and a stay so that I can
  compose the tax-correct quote the agent narrates.
- **US-04**: As the agent, I want to create a reservation for the guest so that the stay is booked without
  the front desk.
- **US-05**: As the agent, I want to modify or cancel a reservation of the person writing — and only theirs —
  so that a guest can change plans on WhatsApp.
- **US-06**: As the hotel operator, I want to be asked to reconnect only when my credentials stopped working,
  not every time a session ends.

### Should Have (P1)

- **US-07**: As xcale-backend, I want to be told when a reservation is created, changed or cancelled outside
  the agent so that the conversation and the reservation stay in step.
- **US-08**: As the agent, I want to read a reservation by its number for the person who made it.

### Could Have (P2)

- **US-09**: As the hotel operator, I want to pick my property from the list my login sees instead of typing
  its id.

---

## 5. Feature Scope (MoSCoW)

### ✅ Must Have — Phase 1

- [ ] Core: `credential_exchange` body placement, body companions (ADR).
- [ ] xcale-backend Rail A: pinned HotelSync entry, resolve companions, reuse until rejected,
      invalidate-and-retry, `511` as an auth failure.
- [ ] Provider reads (1a): property, room types, rate plans, availability, restrictions, reservation by id;
      prices and the occupancy quote routable but not listed.
- [ ] Provider writes (1b): create, modify, cancel — the latter two identity-bound.
- [ ] Connect form in xcale-frontend (partner token, user, password, property id).

### 🟡 Should Have — High Value

- [ ] Webhook register / list / delete tools (control plane) and the receiver in xcale-backend.

### 🔵 Could Have — Nice to Have

- [ ] Property pick list at connect from the login's `properties` (needs its own descriptor field).

### ⛔ Won't Have — Explicit Out of Scope

- **The booking engine (`/api/engine/*`)** — it cannot modify or cancel; one surface is enough.
- **Payments, invoices, extras, guests CRUD, channels, statistics** — not needed to quote and book; each would
  add write surface with fiscal effects.
- **A composed "quote" tool in this server** — money composition is the consumer's (Fidelity over
  Unification; the money guard).
- **Any write in production before staging evidence** — the contract carries no unobserved write.
- **Deciding whether the agent cancels alone** — the hotel's policy, in its agent's instructions.

---

## 6. UX & Interaction Design

### 6.1 Entry Point

The hotel operator opens Integrations in xcale's dashboard and finds **HotelSync** in the catalog, with its
logo, among the hotel PMSs. The card comes from `server/discover`: the backend renders the connect form from
the provider's `authDescriptor` and `contextSchema`, so nothing is hard-coded per provider.

### 6.2 Connect

Clicking **Connect** opens a form with four fields: **Partner token** (secret, masked), **User** (the HotelSync
or Kunas login, usually an email), **Password** (secret, masked) and **Property ID**. Help text under the
token says it is issued by HotelSync or by the hotel's reseller.

On submit, the backend logs in once. The operator sees a spinner on the button, then:

- **Success** — the card turns **Connected**, showing the property's name read by the connection probe.
- **Wrong user or password** — an inline error: "HotelSync rejected the user or the password."
- **Two-factor authentication** — an inline error: "This HotelSync user has two-factor authentication on.
  Ask HotelSync or your reseller for a user the integration can use."
- **Property not reachable** — "This user cannot access property <id>."

### 6.3 The agent's experience

A guest writes "¿Tienen algo del 12 al 15 de diciembre para dos adultos?". The agent sees money-free tools:
it reads room types and availability for those dates, and the restrictions (a three-night minimum, say). It
asks the backend for a price; the backend calls the hidden occupancy quote and returns a `StayQuote` with the
total, taxes included. The agent answers with that total.

The guest says "resérvalo". The agent creates the reservation (Phase 1b) with the guest's name, phone and
email, and answers with the reservation number.

Days later the guest writes "cancela mi reserva 4521". The agent looks it up; the backend checks the phone or
email on the reservation against what the person writing has proven. If they match, the agent proceeds as the
hotel's instructions say (cancel, confirm first, or hand off). If not, it learns that this person has not
proven to be the guest, and cannot act on that reservation.

### 6.4 When a session ends

Silently. A data call answers `401`; the backend logs in once more and repeats the call; the guest notices
nothing. Only if that login fails does the card turn **Reconnect needed**, with the reason.

### 6.5 Key Interactions

| Interaction | Trigger | Behavior |
| :-- | :-- | :-- |
| Session renewal | A data call answers `401 Session key invalid` | Backend drops the cached session, mints once (single-flight), retries the call once. |
| Reconnect | The re-mint is rejected (401/403/511) | Connection marked expired; the dashboard asks to reconnect, with the reason. |
| Property mismatch | A data call answers `403` for the property | Reconnect asked: re-entering the connection fixes the user, the token or the property. |
| Webhook event | HotelSync posts to `/api/webhooks/hotelsync/<secret>` | Backend re-reads the reservation from the API and acts on that; the payload is never trusted. |

### 6.6 Responsive Behavior

The connect form is the dashboard's standard integration form; nothing specific.

### 6.7 Notifications & Feedback

None new. Reconnect uses the existing connection-expired notice.

---

## 7. Data Model Sketch

No storage in this server. The connection lives in xcale-backend.

### Entities

#### HotelSync connection (xcale-backend, Rail A)

| Field | Type | Description |
| :-- | :-- | :-- |
| partnerToken | secret | Issued by HotelSync or a reseller; a login input and a body companion. |
| username / password | secret | The HotelSync login. |
| id_properties | string | The property — the connection's identity, on `X-Provider-Metadata`. |
| cached session (`pkey`) | secret | Minted by Rail A; reused until rejected. |
| webhookSecret | secret | Per-connection path segment of the webhook URL (Phase 1b). |

### Relationships

```
Tenant ──has many──▶ HotelSync connection (one per property)
HotelSync connection ──has one──▶ cached session (pkey)
HotelSync connection ──has up to one──▶ registered webhook
```

### State Machine

```
connected ──[401 on data call]──▶ re-minting ──[login ok]──▶ connected
                                      │
                                      └──[401/403/511 on login]──▶ expired (reconnect)
```

---

## 8. Architectural Decisions

| # | Decision | Choice | Rationale |
| :-- | :-- | :-- | :-- |
| AD-1 | Credential path | `credential_exchange` + `reference` | The durable password never reaches the server; same path as Erbon and Siigo (ADR 0010). |
| AD-2 | Token placement | Body (`key`), plus the partner token as a body companion (`token`) | HotelSync reads no header; ADR `credential-exchange-session-key-in-body`. |
| AD-3 | Session policy | Reuse until rejected; one retry after a re-mint; `511` never retried | No declared lifetime; avoids login per message and 2FA challenges. |
| AD-4 | Surface | PMS endpoints only, not the booking engine | Only the PMS can modify and cancel. |
| AD-5 | Money guard | Price reads routable, not listed; quote composed by the consumer | Fidelity over Unification; the pre-tax quote incidents. |
| AD-6 | Context | `contextSchema: { id_properties }`, `connectionProbe` on the property read, no `contextDiscovery` | No listing endpoint outside the login; one connection per property. |
| AD-7 | Identity | `identityPolicy` on modify, cancel and reservation read (ADR 0019, 0023) | Consumer enforces; the hotel sets the conduct. |
| AD-8 | Webhooks | Control-plane tools here; receiver, secret URL and re-read in the consumer | No signature exists; the event is a hint. |
| AD-9 | Host | Deployment config, allowlisted to `app.hotelsync.com` / `beta.hotelsync.com` | The durable credential is POSTed there; a consumer-supplied host is SSRF and exfiltration. |
| AD-10 | Provider shape | `src/providers/hotelsync/`, `defineTool`, `createHotelSyncProvider(deps?)`, fixtures + conformance | ADR 0009. |

---

## 9. Risks & Open Questions

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
| :-- | :-- | :-- | :-- | :-- |
| R-1 | The login has 2FA on and a datacenter login trips `511` | Med | High | Ask Kunas now; `511` surfaces a clear reconnect reason; never retried. |
| R-2 | A Kunas-managed login reaches other Kunas customers' properties | Med | High | `id_properties` only from metadata, never an input; check the login's `properties` at first login; Kunas's written authorization (GTM). |
| R-3 | A new login invalidates earlier sessions, so two connections or a human in the UI cause churn | Med | Med | Single-flight re-mint; measure logins per day in the soak. |
| R-4 | Prices exclude taxes or extra-person charges | Med | High | The quote waits on Q6; no quote ships before it is known. |
| R-5 | A forged webhook | Low | Med | Secret URL; the event triggers a re-read, never an action. |
| R-6 | The shared token is production and someone tests a write with it | Low | High | No write tool before staging; writes are Phase 1b. |

### Open Questions

| # | Question | Needed By | Owner | Resolution |
| :-- | :-- | :-- | :-- | :-- |
| Q-1 | Is Kunas's token production or staging; per reseller, account or integrator? | Phase 1a | Esteban → Kunas | Pending |
| Q-2 | Whose login, and is 2FA on? | Phase 1a | Esteban → Kunas | Pending |
| Q-3 | `pkey` lifetime; does a new login invalidate earlier ones? | Phase 1a soak | Staging / first login | Pending |
| Q-4 | Is a dead session always `401`? | Phase 1a | Staging | Pending |
| Q-5 | Which properties does the login list? | Phase 1a | First login | Pending |
| Q-6 | Do prices include taxes and extra-person charges? | Phase 1a quote | Staging / HotelSync | Pending |
| Q-7 | Cancel by `edit/status` or `delete/delete`; does a read-only token `403` writes? | Phase 1b | Staging | Pending |
| Q-8 | Webhook payload and event types | Phase 1b | Staging (`test_webhook`) | Pending |

---

## 10. Phasing & Roadmap

| Phase | Scope Summary | Key Deliverables | Dependencies | Est. Effort |
| :-- | :-- | :-- | :-- | :-- |
| **0 — Core + Rail A** | The auth mechanism | Core PR (ADR), xcale-backend Rail A PR | None — no HotelSync evidence needed | M |
| **1a — Reads** | Explore and quote | Sandbox/first-login evidence, api-contract (reads), provider reads, connect form, backend `booking` adapter | Phase 0; Q-1, Q-2 answered; the login | L |
| **1b — Writes + webhooks** | Book, modify, cancel; change notifications | Staging evidence, contract (writes), write tools with identity policies, webhook tools + receiver | Phase 1a; a staging property | L |
| **2 — Polish** | Property pick list at connect | Descriptor field for a login-listed context | Phase 1b | S |

---

## 11. Agentic Context

### Related Modules

| Module | Relationship | Key Files |
| :-- | :-- | :-- |
| Core descriptor | Gains body placement and companions | `src/core/provider-port.ts` |
| Materializer | Places the session key and companions in the body | `src/core/auth/authentication-materializer.ts` |
| Reference resolver | Wraps resolve companions | `src/core/credential/reference-resolver.ts`, `resolved-credential.ts` |
| Erbon provider | The closest precedent (credential_exchange + reference, money guard) | `src/providers/erbon/`, `docs/design/erbon-read-only-provider/` |
| Cloudbeds provider | Identity policies on reservation tools; webhook shape | `src/providers/cloudbeds/tools.ts` |
| xcale-backend Rail A | Mint, reuse, resolve | `src/modules/connections/credential-exchange*.ts`, `credential-resolve.service.ts` |
| xcale-backend MCP executor | Invalidate-and-retry | `src/modules/mcp/mcp-tool-executor.ts` |
| xcale-backend webhooks | Receiver pattern | `src/modules/cloudbeds/webhooks/`, `src/modules/booking/webhooks/` |

### Conventions to Follow

- Provider Self-Containment: the provider PR touches only `src/providers/hotelsync/`, its tests, one line in
  `src/providers/index.ts` and its logo; the core change lands first, in its own PR with the ADR.
- Credential-in-Transit-Only: `.reveal()` only in the materializer; never log a request body.
- `defineTool` with zod inputs as the single source of the schema; `PaginatedResult` for lists.
- Errors through `mapHttpStatusToErrorCode`; never interpolate a provider body.

### Next Steps After Approval

1. `/implementation-plan` for Phase 0 (core + Rail A) — needs no HotelSync evidence.
2. Once the login is in hand: capture `sandbox-evidence.md`, then `/api-contract-authoring` for reads.
3. Once a staging property exists: evidence and contract for writes and webhooks.
