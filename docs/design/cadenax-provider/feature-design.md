# Cadenax Provider — Feature Design

> **Feature**: Onboard Cadenax (Cofinet's coffee-trading management backend) as an MCP provider, so a consumer's agent can read an office's inventory, reservations, contracts, delivery orders and clients, and later write them on behalf of a named staff member and pull the office's book for a CRM.
> **Priority**: P1. Mateo decided on 2026-11-23 to start building the xcale half of the Cadenax integration.
> **Owner**: Mateo · **Issue**: `matesjara/xcale-mcp-server#56` (onboard Cadenax as an api_key provider) · **Epic**: `matesjara/xcale-backend#602` (Cadenax integration — internal WhatsApp agent + CRM sync)
> **Status**: Draft
> **Target Release**: Phase 1, the read-only provider. Writes and the sync pull are their own slices.
> **Last Updated**: 2026-11-23

---

> **Grounding.** The consumer-side design is `xcale-backend/docs/design/cadenax-integration/feature-design.md` (grill of 2026-08-22/23). The Cadenax side shipped to `main` of `CofinetCol/cofinet-backend`: PRD #399, PRs #400 and #411, ADR 0026 (an API key is a principal scoped at authentication) and ADR 0027 (the outbound surface is a state projection). **Every wire fact in this document was read from that repository at `bf7ce56` — its source, its integration tests and its OpenAPI — and none was observed**: no Cadenax key has been issued to this server. §7 marks each fact; the API contract is written from the first observed calls (Q-1).

> **Architectural guardrail.** This design instantiates machinery that already exists: `api_key` in a header with `forwarded` delivery (Echo, Toteat), Explicit Context discovered after connect (Cloudbeds' `propertyID`), a no-context probe (Cloudbeds' `list_properties`), control-plane tools (ADR 0013), thin passthrough (ADR 0015) and identity policy (ADR 0019). It changes nothing in `src/core`, `src/protocol` or `src/auth`. Anything implementation finds it needs there stops the work and reopens an ADR.

---

## 1. Problem Statement

**What's happening?** Cofinet runs its coffee trading on Cadenax: lots and stock per office, lot reservations for roasteries, volume contracts, delivery orders, clients and their contacts. Its Account Managers work all day on WhatsApp and switch to the web application for every fact. Nothing in Cadenax reaches a conversation.

**Why now?** The blocker was Cadenax itself: its only machine credential was a global administrator over every office, with no way to ask who a key is. That is gone — a key now carries its own role, offices and purpose, answers "who am I", and Cadenax can say whether a phone belongs to an office's staff.

**Cost of inaction.** The consumer's whole integration (an internal agent, then a CRM sync) has no provider to call.

## 2. Goals & Success Metrics

| Type      | Metric                                           | Target                                                                             | How Measured                         |
| :-------- | :----------------------------------------------- | :--------------------------------------------------------------------------------- | :----------------------------------- |
| Leading   | A pasted key connects one office with no form    | The probe answers the key's office; the consumer stores it as context              | Contract probe, then a real dev key  |
| Leading   | An agent reads an office's book                  | The eleven read tools green against Cadenax's development environment              | First observed calls (Q-1)           |
| Guardrail | The office is never an agent's choice            | No tool takes an office; every transactional call carries the connection's         | Tests over every tool                |
| Guardrail | No credential persists or leaks                  | Key in a header, never in a URL or an error                                        | Containment tests                    |
| Guardrail | Self-contained provider                          | `src/providers/cadenax/`, one registry line, one optional config field, its docs   | PR diff                              |

## 3. Target Users

| User                         | Role              | What they get                                                                                  |
| :--------------------------- | :---------------- | :--------------------------------------------------------------------------------------------- |
| **Account Manager** (staff)  | End user          | Their office's stock, reservations, contracts, deliveries and clients, answered in a chat.     |
| **A consumer's agent** (LLM) | Consumer of tools | Eleven reads on its menu, all scoped to the connection's office.                               |
| **A consumer** (backend)     | Consumer system   | A probe that proves a key and names its office, and a tool that answers "is this phone staff". |

## 4. User Stories

### Must Have (P0)

- As a consumer, I connect a Cadenax key and learn from one call who it is and which office it works in.
- As an agent, I search the lots of my office and read one lot.
- As an agent, I search reservations, contracts and delivery orders of my office, read one of each, and list what is about to lapse.
- As an agent, I find a client company and its contacts.
- As a consumer, I ask whether an inbound phone number is an active staff member of the connection's office.

## 5. Feature Scope (MoSCoW)

### ✅ Must Have — Phase 1 (this slice)

- [ ] `api_key` auth in `X-API-Key`, `forwarded`.
- [ ] `mcp_cadenax_whoami` as `connectionProbe` and `contextDiscovery` (control plane).
- [ ] `mcp_cadenax_resolve_staff_by_phone` (control plane).
- [ ] Eleven published read tools (§6.1).
- [ ] Errors through one unwrap, with Cadenax's `details.code` and sentence.

### 🟡 Should Have — later slices

- [ ] Write tools acting for a named staff member (`matesjara/xcale-mcp-server#233`, Cadenax write tools).
- [ ] The sync pull over `GET /sync/changes` (`matesjara/xcale-mcp-server#234`, the sync cursor tool).

### ⛔ Won't Have

- A key that works in several offices as one connection (AD-2).
- Cross-office dashboards, inventory summaries, PDF and Excel exports, Xero and HubSpot surfaces, purchase orders, key management (a key cannot manage keys).

## 6. UX & Interaction Design

### 6.1 The tools

Published (`audience: operator`, `readOnly`):

| Tool                                  | Cadenax endpoint               | Office  | Notes                                                        |
| :------------------------------------ | :----------------------------- | :------ | :----------------------------------------------------------- |
| `mcp_cadenax_search_lots`             | `GET /lots/search`             | context | Paginated. Expected vs physical stock, availability.         |
| `mcp_cadenax_get_lot`                 | `GET /lots/{id}`               | context |                                                              |
| `mcp_cadenax_search_reservations`     | `GET /reservations/search`     | context | Paginated. `expiringWithinDays`, expiry window, client.      |
| `mcp_cadenax_get_reservation`         | `GET /reservations/{id}`       | context |                                                              |
| `mcp_cadenax_search_contracts`        | `GET /contracts/search`        | context | Paginated.                                                   |
| `mcp_cadenax_list_expiring_contracts` | `GET /contracts/expiring`      | context | Cadenax's envelope, with its summary.                        |
| `mcp_cadenax_get_contract`            | `GET /contracts/{id}`          | context | `includeDeliveries`.                                         |
| `mcp_cadenax_search_deliveries`       | `GET /deliveries/search`       | context | Paginated.                                                   |
| `mcp_cadenax_get_delivery`            | `GET /deliveries/{id}`         | context |                                                              |
| `mcp_cadenax_search_companies`        | `GET /companies/search`        | none    | Paginated. One client book across offices (R-2).             |
| `mcp_cadenax_search_contacts`         | `GET /contacts/search`         | none    | Paginated.                                                   |

Control plane (dispatched by name, never listed):

| Tool                                 | Cadenax endpoint          | Why it is the consumer's                                                    |
| :----------------------------------- | :------------------------ | :-------------------------------------------------------------------------- |
| `mcp_cadenax_whoami`                 | `GET /auth/me`            | Proves the key and names its office, before a connection exists.            |
| `mcp_cadenax_resolve_staff_by_phone` | `GET /users/by-phone`     | Answers who is on the other end of a channel; an agent has no use for it.   |

A paginated search returns the uniform page (`items`, `page`, `pageSize`, `totalPages`, `totalResults`, `hasMore`) with Cadenax's rows untouched; `pageSize` is Cadenax's `limit`. Every other tool returns Cadenax's body as sent, envelope included (Fidelity over Unification).

### 6.2 Connect

The consumer shows one field, the API key. It calls `whoami`; the answer carries the key's name, role, purpose, environment, expiry and one office with its migration state and default currency. The consumer reads `assignedOffices.0.code` as the `office` context and keys the connection on it. A key that reaches several offices is refused with the list of offices in the message.

### 6.3 Who is on the line

`resolve_staff_by_phone` takes a phone in any format and answers `{ found: true, staff }` or `{ found: false }`. Cadenax answers `404` for every "no" — unknown number, another office, a deactivated account — and that is the question's answer, so it is a success. A failure (the key is dead, Cadenax is down) stays a failure: a consumer that fails closed must be able to tell "no" from "I could not ask".

## 7. Data Model Sketch — wire facts

**D** = Documented (read from Cadenax's source, tests or OpenAPI at `bf7ce56`). **O** = Observed. Nothing is Observed yet.

| #  | Fact                                                                                                                                                                                         | Status | Source                                                             |
| :- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----- | :----------------------------------------------------------------- |
| 1  | Base URLs: production `https://api-cofinet.cadenax.com/api`, staging `https://staging-api-cofinet.cadenax.com/api`                                                                           | D      | OpenAPI `servers`                                                  |
| 2  | An integration authenticates with `X-API-Key`; an unknown, revoked or expired key answers `401 { error: "Invalid or expired API key" }`                                                      | D      | `src/middleware/auth.ts`                                           |
| 3  | `GET /auth/me` for a key answers `{ kind: "api_key", keyId, name, role, purpose, environment, expiresAt, assignedOffices: [{ code, name, isActive, migrationState, defaultCurrency }] }`     | D      | `apiKeyService.getPrincipalProfile`, `authMe.apiKey` test          |
| 4  | A key with no declared offices is answered with every active office; "all" and "several" are the same shape                                                                                  | D      | Cadenax ADR 0026 clause 2, same test                               |
| 5  | `role` is `admin`/`manager`/`sales`/`viewer`; `purpose` is `agent` (writes for a named person) or `sync` (never writes); `environment` is `production`/`staging`/`development`               | D      | `src/models/ApiKey.ts`                                             |
| 6  | Transactional endpoints require `?office=CODE`, validated against the key; another office is `403 { error: "Access denied for this office" }`                                                | D      | `lotController`, `reservationController`, `contractController`     |
| 7  | `/contracts/expiring` and `/contracts/{id}` require `office` though the OpenAPI does not list the parameter                                                                                  | D      | `contractController`                                               |
| 8  | Search endpoints answer `{ success, data: [...], pagination: { page, limit, total, totalPages } }` and take `page` and `limit`                                                               | D      | OpenAPI                                                            |
| 9  | Detail envelopes differ: `{ lot }`, `{ success, reservation }`, `{ success, contract, deliveries? }`, a bare delivery object, `{ success, contracts, summary }`                              | D      | OpenAPI                                                            |
| 10 | `/companies/search` and `/contacts/search` take no office and are not narrowed for a key                                                                                                     | D      | `companyController`, `contactController`, their services           |
| 11 | `GET /users/by-phone?phone=&office=` answers `{ data: { id, name, role, isActive, assignedOffices } }`, or `404` for every "no"; the phone is normalized by Cadenax                          | D      | `src/routes/userRoutes.ts`, `userController.getUserByPhone`        |
| 12 | Errors are `{ error: "<sentence>", details?: { code } }`; the code is never at the root                                                                                                      | D      | Cadenax ADR 0026 clause 9                                          |
| 13 | `403 API_KEY_SCOPE_UNRESOLVED` (every office of the key is inactive), `403 API_KEY_READ_ONLY_PURPOSE`, `503 OFFICE_DIRECTORY_UNAVAILABLE`, `423 OFFICE_MIGRATION_MIRROR_READ_ONLY` on writes | D      | OpenAPI `ApiKeyAuth` description                                   |
| 14 | A reservation that ran out of time reads `cancelled`; `expired` is unreachable (`CofinetCol/cofinet-backend#397`)                                                                            | D      | PRD #399 §2                                                        |

**Call context** (`contextSchema`): `{ office: string }` — an office code. Required by every tool but `whoami`.

## 8. Architectural Decisions

| #    | Decision                                                                                             | Why                                                                                                                                                                                                                                                              |
| :--- | :--------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AD-1 | The office is call context, discovered by the probe, and no tool takes an office                     | Cadenax validates `office` against the key, so isolation holds on its side; taking it from the connection means an agent cannot name another one. Discovering it removes the pasted-field class of mistakes (Cloudbeds' lesson).                                  |
| AD-2 | A connection is one key in one office; the probe refuses a key that reaches any other count          | Fact 4: Cadenax expands "every office" to a list, so "all" cannot be told from "several", and neither names one office to work in. Picking the first would connect an office nobody chose. The consumer design's `global` connection (its D-2) has no honest identity; a multi-office agent is a later, explicit design. |
| AD-3 | `forwarded` delivery                                                                                 | Non-financial, one office per key — the risk Toteat and Cloudbeds already run (the consumer design's D-9).                                                                                                                                                       |
| AD-4 | `401` is the only `PROVIDER_AUTH_EXPIRED`; `403` and `423` are `PROVIDER_ERROR`                      | A `401` is a dead key, fixed by a new one. A `403` is a live key refused an act — an office, a role, a purpose; Cadenax's own text for one of them is "rotating the key does not fix this". Marking the connection expired would be wrong every time.            |
| AD-5 | The staff lookup's `404` is a successful `{ found: false }`; every other failure stays a failure     | The consumer's gate fails closed and must tell "not staff" from "could not ask".                                                                                                                                                                                 |
| AD-6 | The client-book searches ship as Cadenax serves them                                                 | This server does not narrow what a credential reaches. That an office key reads every office's clients is Cadenax's to decide, and is filed there (R-2).                                                                                                         |
| AD-7 | No write tool and no sync tool in this slice                                                         | Both rest on wire behaviour nobody has observed, and each needs a call that is not this server's (Q-2, Q-3).                                                                                                                                                     |

AD-2 narrows the consumer design's D-2 and is a technical call taken while building; it is reversible (a later schema version can add a multi-office shape) and waits for the CTO's word at review.

## 9. Risks & Open Questions

### Risks

| #   | Risk                                                                                                         | Mitigation                                                                                                                                             |
| :-- | :----------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | The wire differs from the source: a parameter, an envelope, an error body                                    | Nothing is released to `main` before the first observed calls (Q-1). The tools return bodies untouched, so only requests and error mapping can be wrong. |
| R-2 | An office key reads the whole client book over live REST, while Cadenax's feed scopes it by office           | Cadenax's decision: `CofinetCol/cofinet-backend#787` (an office-scoped API key reads the whole client book over live REST).                             |
| R-3 | A filter Cadenax ignores reads as "no results"                                                               | Only parameters its OpenAPI lists are exposed; observed in Q-1.                                                                                         |
| R-4 | No logo                                                                                                      | `logoUrl` is omitted until Cadenax's mark is supplied; a consumer shows its fallback.                                                                   |

### Open Questions

| #   | Question                                                                                                              | Owner         | Status                                                                                             |
| :-- | :-------------------------------------------------------------------------------------------------------------------- | :------------ | :------------------------------------------------------------------------------------------------- |
| Q-1 | First observed calls with a development key: record fixtures, correct the provider, write `api-contract.md`           | Mateo, then a session | `matesjara/xcale-mcp-server#232` (first observed calls with a development key). Mateo mints the key. |
| Q-2 | Do the client-write tools ship? Cadenax's PRD lists "no creating clients from WhatsApp" as anti-scope                 | CPO           | Open, in `matesjara/xcale-mcp-server#233` (Cadenax write tools)                                    |
| Q-3 | How does one office hold an agent connection and a sync connection, when the identity is the office?                  | CTO           | Open, in `matesjara/xcale-mcp-server#234` (the sync cursor tool)                                   |
| Q-4 | Is AD-2 right, or should a multi-office key connect with an explicit office?                                          | CTO           | Open, at this PR's review                                                                          |

## 10. Phasing & Roadmap

| Phase | Scope                                                             | Depends on             |
| :---- | :---------------------------------------------------------------- | :--------------------- |
| 1     | Auth, probe and context discovery, staff lookup, eleven reads     | —                      |
| 1.1   | Observed contract: fixtures, corrections, `api-contract.md`       | A development key (Q-1) |
| 2     | Write tools                                                       | 1.1, Q-2               |
| 3     | Sync pull                                                         | 1.1, Q-3               |

## 11. Agentic Context

- Template providers: `src/providers/toteat/` (probe, context), `src/providers/cloudbeds/` (one tool as probe and discovery), `src/providers/avirato/` (errors, pagination, tests).
- Recipe: the xcale layer's `add-provider` skill; ADR 0009 (canonical provider pattern), 0013 (control plane), 0015 (thin passthrough), 0019 (identity policy).
- Consumer checklist: `matesjara/xcale-backend#3931` (register Cadenax as a credential toolbox).
