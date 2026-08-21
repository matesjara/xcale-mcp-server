# Cloudbeds Write-Path (`create_reservation`) — Feature Design

> **Feature**: E-08 — a stateless MCP tool that lets a consumer's agent create a reservation in Cloudbeds (booking-only), plus the lookup capability a consumer needs to reconcile it.
> **Priority**: P1 High
> **Owner**: Mateo (product/risk sign-off) · agent (implementation)
> **Status**: Approved (Mateo, 2026-07-10) — Q-1 & Q-2 resolved; proceeds to `/api-contract-authoring`
> **Target Release**: after the Cloudbeds read-first pilot lands
> **Last Updated**: 2026-07-10

> **Lineage.** This FD consumes a closed Grill (2026-07-10). It does **not** re-decide the Grill's
> outcomes; it records them and designs against them. Constraints it honors (does not re-open):
> `docs/adr/0005-stateless-gateway-and-thin-acl.md`, `docs/adr/0003-credential-forwarding-and-token-model.md`,
> `docs/adr/0004-provider-knowledge-vs-credential-custody.md`, `docs/adr/0009-canonical-provider-pattern.md`,
> `.claude/rules/soul.md` (stateless · business-in-consumer · complexity-on-demand), and the pilot
> `docs/design/cloudbeds-pilot/feature-design.md` (§2 non-goals, §4/R-1, §5.1 — `create_reservation`
> was explicitly out of the read-first pilot).

---
 
## 1. Problem Statement

### What's happening?

Cloudbeds is live as a **read-only** provider (`src/providers/cloudbeds/tools.ts`): an agent can list
reservations, read a reservation/guest, check availability, list room types, get hotel details. It
**cannot create a reservation**. For a Booking vertical, "the agent takes a booking" is the core act —
and today it is impossible through the platform.

### Who's affected?

The **consumer** (`xcale-backend`, the first MCP client) and, transitively, its agents and the property
staff. Any consumer that discovers the Cloudbeds provider gets a read-only surface with a hole where the
one high-value write belongs.

### What's the cost of inaction?

Booking v1 (the first Booking vertical instance in xcale-backend) has no way to complete a reservation
against a real PMS. The end-to-end Booking flow stays a demo, not a product.

---

## 2. Goals & Success Metrics

### North Star

An agent can create a reservation in a connected Cloudbeds property through the MCP — while the MCP server
stays **stateless**, **consumer-agnostic**, and **provider-self-contained**. (How many calls the
reconciliation flow takes is the consumer's concern, not this FD's.)

### Metrics

| Type | Metric | Target | How Measured |
|:--|:--|:--|:--|
| **Leading** | `create_reservation` round-trips against a Cloudbeds sandbox/live property | Green | Behavior test w/ recorded fixtures + one live smoke |
| **Leading** | Files touched to add the write-path | Only `src/providers/cloudbeds/**` | Diff review (Provider Self-Containment §10) |
| **Lagging** | Server state introduced for the write-path | **Zero** | Code review + no new store/cache/worker |
| **Lagging** | The MCP exposes the provider capabilities required for consumer-side reconciliation (lookup by external reference) | Present | Contract + behavior test on the external-reference filter |

---

## 3. Target Users (MCP framing — no end-user UI here)

> This is a stateless MCP provider adapter. Its "users" are the **consumer** and the **agent**, not a
> human at a screen. There is no frontend and no database in this repo.

### The Consumer runtime (`xcale-backend`, Rail E MCP client)

- **Context**: discovers the Cloudbeds provider, forwards the PMS OAuth token + `propertyID` per call.
- **Motivation**: expose `create_reservation` to its Booking agent as any other discovered tool.
- **Pain Today**: no write tool exists; the consumer can read but not book.
- **Expected Benefit**: a booking write, plus the lookup it needs to reconcile a create it is unsure of.

### The Agent (LLM tool-caller, inside the consumer)

- **Context**: mid-conversation, has gathered guest/room/date/rate details.
- **Motivation**: commit the booking.
- **Pain Today**: it can only describe a reservation, never create one.
- **Expected Benefit**: one tool call creates the reservation; the result is a typed `ToolResult`.

---

## 4. User Stories

### Must Have (P0)

- **US-01**: As the consumer's agent, I want to **create a reservation** (guests, room(s), dates, rate,
  notes) so that a booking is committed in the property's PMS.
- **US-02**: As the consumer runtime, I want to **stamp my own reference** (`thirdPartyIdentifier`) on the
  create so that I can later correlate the reservation to my own record.
- **US-03**: As the consumer runtime, I want to **look up reservations by my reference** so that, after a
  timeout/uncertain create, I can reconcile (did it land?) **without the MCP holding any state**.

### Should Have (P1)

- **US-04**: As the consumer's agent, I want **typed, mapped errors** (validation vs auth-expired vs rate
  limited vs unavailable) so that failures surface, never silently.

### Won't Have (this feature)

- Charging, authorizing, or storing payment — see §5.

---

## 5. Feature Scope (MoSCoW)

### ✅ Must Have — booking-only write + reconciliation lookup

- [ ] `mcp_cloudbeds_create_reservation` → Cloudbeds `postReservation` (booking fields only).
- [ ] Pass-through of `thirdPartyIdentifier` (consumer-supplied external reference).
- [ ] **Lookup by external reference**: extend `mcp_cloudbeds_list_reservations` with a filter on the
      provider's external-reference field (a lookup capability consumers use during reconciliation — the
      MCP owns no reconciliation semantic).
- [ ] Cloudbeds error mapping for the write (validation / auth-expired / rate-limited / unavailable).
- [ ] A `post()` method on `CloudbedsClient` (encoding per the provider's requirement — confirmed from
      primary evidence and frozen in the API Contract; token at egress; no caching) — the client is
      GET-only today (`src/providers/cloudbeds/client.ts:20`).

### 🟡 Should Have

- [ ] Modify/cancel reservation (`putReservation` / cancel) — same booking-only risk profile; deferred
      to keep the first write slice minimal, not excluded on principle.

### ⛔ Won't Have — Explicit Out of Scope (and WHY)

- **Charges, authorizations, cards, deposits, Stripe, `paymentMethodId`/payment tokens, any financial
  operation.** *Why:* `postReservation` does not process payment (payment lives in separate endpoints:
  `postCharge`/`postPayment`/`postCreditCard`). Including the optional tokenized-payment passthrough would
  transmit payment references and **re-trigger the credential ADR's risk re-evaluation** (§8 AD-1). This
  boundary keeps E-08 cleanly standard-risk.
- **Any MCP-side deduplication or idempotency store.** *Why:* it would be server state, forbidden by the
  stateless ADR; reconciliation is the consumer's (§8 AD-3).

---

## 6. Tool Contract & Interaction (MCP framing — replaces "UX")

> No UI in this repo. The "interface" is the MCP tool surface the consumer discovers via `tools/list`.

### 6.1 `mcp_cloudbeds_create_reservation`

- **Trigger**: the consumer routes a `tools/call` with `Authorization: Bearer <hopB>` +
  `X-Provider-Token: <Cloudbeds OAuth token>` + metadata `{ propertyID }` (identical envelope to the
  read tools).
- **Input (entity sketch — §7)**: booking fields (guests, room assignment, check-in/out dates, rate) +
  optional `thirdPartyIdentifier` + optional notes. **No payment fields.**
- **Behavior**: adapter shapes a `postReservation` request (encoding per the provider's requirement —
  confirmed from primary evidence, frozen in the API Contract) via `client.post(...)`, token applied at
  egress by the core; returns the
  provider `data` **verbatim** (fidelity over unification) wrapped in a typed `ok(...)`.
- **Success**: `ok(...)` wrapping the provider's success payload **verbatim**; the exact response shape
  (whether it returns the full reservation incl. `reservationID`, or only an id/ack) is frozen in the API
  Contract after primary evidence (preflight P-4).
- **Errors** (mapped, never swallowed): 400 → `PROVIDER_INVALID_INPUT`; 401/403 → `PROVIDER_AUTH_EXPIRED`
  (→ consumer reconnect); 429 → `PROVIDER_RATE_LIMITED`; 5xx/network → `PROVIDER_UNAVAILABLE`; else
  `PROVIDER_ERROR`.

### 6.2 Reservation lookup by external reference

The MCP exposes a **lookup capability**, not a reconciliation semantic: `mcp_cloudbeds_list_reservations`
gains a filter on the provider's external-reference field so a consumer can find a reservation by the
reference it stamped.

- **Consumers use this capability during reconciliation** — e.g. after an uncertain create, to check
  whether the reservation already exists before deciding what to do.
- The MCP only **exposes the filter**; it makes no dedup or create-if-absent decision — that logic lives
  in the consumer (§8 AD-3).

### 6.3 What the MCP explicitly does NOT do

> **The MCP performs no deduplication and no idempotency.** It creates exactly what it is told to,
> exposes the provider's own correlation filter, and returns provider data verbatim. Safety against
> duplicate writes is a consumer responsibility (§8 AD-3, §11).
>
> **Normative principle:** *the MCP may expose provider capabilities that enable consumer-side
> reconciliation, but it never owns the reconciliation decision.*

---

## 7. Data Model Sketch (input entity, not a DTO)

> Entity-sketch only; exact field names/shapes are the API-contract's job and must be confirmed against
> the live `postReservation` schema during that step.

#### `CreateReservationInput` (booking-only)

| Field | Type | Description |
|:--|:--|:--|
| `propertyID` | from `ctx.metadata` | Explicit Context, forwarded by the consumer (not an agent arg). |
| guest(s) | object[] | Guest identity/contact per Cloudbeds `postReservation`. |
| room assignment | object[] | Room type / room, per-room dates. |
| `startDate`/`endDate` | string | Stay dates. |
| rate | string/number | Rate/rate-plan reference (verbatim provider shape). |
| `thirdPartyIdentifier` | string (optional) | **Consumer-supplied external reference** (passthrough). |
| notes | string (optional) | Reservation observations. |
| ~~payment~~ | — | **Excluded** (§5). |

### Relationship

```
Consumer (owns reference + reconciliation)
   │ stamps thirdPartyIdentifier
   ▼
MCP create_reservation ──postReservation──▶ Cloudbeds ──returns──▶ success payload
   ▲                                                                      │
   └── list_reservations (external-ref filter) ◀── reconcile (consumer-driven) ──┘
```

The MCP is a stateless pass-through on both arrows; the correlation lives in Cloudbeds
(`thirdPartyIdentifier`) and the decision logic lives in the consumer.

---

## 8. Architectural Decisions

| # | Decision | Choice | Rationale |
|:--|:--|:--|:--|
| **AD-1** | Risk classification (credential/token model) | **Standard-risk. No new credential ADR.** | `postReservation` does not charge/authorize/capture payment (separate endpoints); booking-only transmits **no** raw payment data; the forwarded credential stays the Cloudbeds **PMS OAuth token**, identical to read. Fits `credential-forwarding-and-token-model` as-is. **Recorded classification:** *"E-08 exposes only reservation (booking) operations. Charge/payment-processing operations are out of scope and retain the deferred classification defined by the credential ADR."* (Approved 2026-07-10 — Q-1.) |
| **AD-2** | Write transport | Add `post(method, request, body)` to `CloudbedsClient` (token at egress; no cache; **encoding per the provider's requirement — a wire fact confirmed from primary evidence and frozen in the API Contract, not decided here**) | Client is GET-only today; write shaping is the adapter's job, self-contained in `client.ts`. Core still materializes auth; client never sees the credential. |
| **AD-3** | Idempotency / dedup ownership | **MCP implements neither. Reconciliation is the consumer's.** | Cloudbeds gives no native idempotency key on `postReservation`; a server-side dedup store would be state, forbidden by `stateless-gateway-and-thin-acl` (no shared mutable state + horizontally scalable). The consumer owns reconciliation. **This FD intentionally does not prescribe the reconciliation algorithm**; it only requires the MCP expose the provider capabilities needed to support it (§6.2). |
| **AD-4** | Lookup capability for reconciliation | Extend `list_reservations` with the provider's external-reference filter | Cloudbeds exposes reservation lookup by an external-reference field; the exact wire parameter is confirmed from primary evidence and frozen in the API Contract (preflight P-2). Additive filter on the existing list tool; no new tool, no state. |
| **AD-5** | Provider self-containment | Only `src/providers/cloudbeds/**` (+ possibly nothing in the registry — provider already registered) | No change to `core`/`protocol`/`auth`, no public-contract change; adding a tool is additive per `additive-contract-versioning`. |
| **AD-6** | Fidelity | Return provider `data` verbatim (`ok(...)`) | Matches `canonical-provider-pattern` (fidelity over unification); the consumer/agent interprets. |

### AD-3 addendum — the "does this need a new ADR?" test (resolved during design, not presupposed)

Mateo's burden-of-proof test: *"Could a competent engineer, reading only the current ADRs, reasonably
conclude that implementing idempotency in the MCP is a valid option?"*

- **The case for NO (fits existing ADRs):** `stateless-gateway-and-thin-acl` locks "no per-connection
  state", "**no shared mutable state**", "horizontally scalable". A *correct* idempotency store must be
  shared and correctness-critical under horizontal scale-out — which that ADR forbids. On careful
  reading, idempotency-in-MCP is already foreclosed → no new ADR; cite stateless + business-in-consumer
  and state the principle explicitly (this FD, §6.3).
- **The crack (why the answer isn't a clean NO):** `credential-forwarding-and-token-model` (Alt. B)
  describes the token-exchange evolution as *"effectively stateless (in-memory ~60s cache)"*. That
  sanctions a **mild ephemeral cache**. A less-careful engineer could anchor there and argue a mild
  idempotency cache is equally acceptable — the distinction (a credential cache-miss re-fetches
  harmlessly; an idempotency cache-miss **duplicates a write**) is real but not spelled out anywhere.

**Resolved (Mateo, 2026-07-10): FD only — no new ADR.** The principle is already derivable from
`stateless-gateway-and-thin-acl` (no shared mutable state + horizontally scalable) + business-in-consumer,
and there is **no evidence yet** of the ambiguity actually recurring — the "mild cache" crack is a
theoretical mis-read, not an observed pattern. Opening an ADR now would document a consequence of existing
decisions, not a new decision between alternatives. It is stated explicitly in this FD (§6.3) instead.
**Trigger to revisit:** if future write-paths (Booking, CRM, ERP) *repeatedly* reopen "should idempotency
live in the MCP?", extract the transversal ADR then — the §6.3 sentence is ready to lift almost verbatim.

---

## 9. Risks & Open Questions

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|:--|:--|:--|:--|:--|
| R-1 | Scope creep into payment (someone adds the optional Stripe/`paymentMethodId` passthrough later) | Med | High | Explicit §5 exclusion + the recorded classification note (AD-1); any payment op re-triggers the credential ADR gate and needs its own sign-off. |
| R-2 | `postReservation` wire schema (fields, encoding, multi-room shape) is unverified until the API Contract; building against an unverified shape could need rework | Med | Med | Deferral gate: the API Contract is authored only after the schema is observed (see `api-contract-preflight.md`); encoding/shaping is encapsulated in `client.ts`, never leaks past the adapter. |
| R-3 | Consumer retries an **uncertain write** without reconciling first → duplicate reservation | Med | Med | The real hazard is result-uncertainty, not the retry itself. Out of this repo's control; the MCP exposes the lookup-by-external-reference capability (AD-4); duplicate-safety is the consumer FD's responsibility (§11). |
| R-4 | Sandbox availability for a live write smoke test | Med | Low | Mock client + fixtures for CI; one live smoke against a Cloudbeds test property if available. |

### Open Questions

| # | Question | Needed By | Owner | Resolution |
|:--|:--|:--|:--|:--|
| Q-1 | Sign off the **standard-risk** classification for booking-only writes (AD-1). | Before impl | **Mateo** | **Resolved (2026-07-10): approved — standard-risk, booking-only.** |
| Q-2 | Does the "MCP never implements idempotency" principle warrant a **small new ADR**, or is the FD statement enough? (AD-3 addendum) | Before impl close | **Mateo** | **Resolved (2026-07-10): FD only — no new ADR.** Revisit only if the same debate recurs across future write-paths. |
| Q-3 | Exact `postReservation` request schema (fields, encoding, multi-room shape). | `/api-contract` | agent | Pending — confirm against primary source (see `api-contract-preflight.md`). |
| Q-4 | Should modify/cancel (P1) ride in the same slice or a follow-up? | Phase 2 | Mateo | Pending. |

---

## 10. Phasing & Roadmap

| Phase | Scope Summary | Key Deliverables | Dependencies | Est. Effort |
|:--|:--|:--|:--|:--|
| **Phase 1** | Booking-only create + reconciliation filter | `client.post`; `create_reservation` tool; external-reference filter on `list_reservations`; error mapping; fixtures + conformance/behavior tests | Read-first pilot landed; Q-1 sign-off | M |
| **Phase 2** | Modify/cancel reservation | `putReservation`/cancel tools (same risk profile) | Phase 1 | S–M |
| **(separate repo)** | Consumer reconciliation | retry→lookup-by-ref→create-if-absent in xcale-backend | Phase 1 tools | its own FD |

---

## 11. Agentic Context

### Consumer responsibilities (NOT built here)

- **Reconciliation / duplicate-safety** lives in `xcale-backend`. The consumer stamps
  `thirdPartyIdentifier`, and on an uncertain create looks up by it (via the AD-4 filter) before deciding
  what to do. **The exact reconciliation algorithm belongs to a separate Feature Design in xcale-backend;
  the MCP only provides the provider capabilities required to support it** (the pass-through + the lookup
  filter).

### Related files (this repo)

| File | Relationship |
|:--|:--|
| `src/providers/cloudbeds/tools.ts` | Read-path tools; `list_reservations` gains the external-reference filter; `create_reservation` added here. |
| `src/providers/cloudbeds/client.ts` | GET-only today; gains `post()`. |
| `src/providers/cloudbeds/provider.ts` / `manifest.ts` | `IProvider` impl / manifest — new tool surfaces via `listTools()`. |
| `src/core/tool.ts` | `toolFactory`/`ok`/`err` used to define the write tool. |

### Constraints to honor (do not re-decide)

- Stateless (no store/cache/worker for the write-path) · consumer-agnostic (no xcale/tenant concepts on
  the wire) · Credential-in-Transit-Only (`SecretString`, `.reveal()` only at egress) · Provider
  Self-Containment · fidelity over unification · additive contract evolution.

### Next Steps After Approval

1. ✅ **Q-1 (risk) and Q-2 (ADR-or-not) resolved by Mateo (2026-07-10):** standard-risk / booking-only,
   and FD-only (no new ADR).
2. **`/api-contract-authoring`** → `docs/design/cloudbeds-write-path/api-contract.md` (exact
   `postReservation` schema + encoding, the `create_reservation` tool I/O, the `list_reservations`
   external-reference filter, error table).
3. Implement Phase 1 under the usual discipline (additive → tests/fixtures → gate → commit).
