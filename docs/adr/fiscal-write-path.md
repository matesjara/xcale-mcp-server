# ADR: Fiscal write-path — thin MCP passthrough, consumer-owned safety

- **Status:** Proposed
- **Date:** 2026-08-13
- **Decision makers:** Mateo
- **Tags:** integrations, provider, write-path, siigo, safety

## Context

Siigo (read-only today) is the first provider heading for **write** operations. The demanded ones are
fiscal: `create_invoice` (factura de venta), later credit notes. Two properties make these unlike every
write the platform has shipped:

1. **Irreversible + externally reported.** A sales invoice is transmitted to the DIAN (Colombia's tax
   authority) the moment it is created. It cannot be deleted — the only correction is issuing a
   **compensating** credit note. A duplicate or wrong invoice is a real fiscal/legal problem for the
   tenant, not a UI glitch.
2. **Composed from lookups.** An invoice references a document type, taxes, payment types, an
   account-group-classified product, a seller — the reference-data reads (Phase 1a) exist precisely to
   fill these.

Meanwhile the gateway's architecture is deliberately **stateless and thin**
([stateless-gateway-and-thin-acl](stateless-gateway-and-thin-acl.md),
[canonical-provider-pattern](canonical-provider-pattern.md)): a provider adapter translates one MCP tool
call to one external API call and returns the provider's `data` verbatim. It holds no database, no
per-tenant state, no orchestration. Credentials arrive per-call and are discarded
([credential-delivery-strategies](credential-delivery-strategies.md)); Siigo specifically uses the
`reference` strategy, so the gateway never even holds the durable credential.

The forces collide on one question: **a fiscal write needs idempotency, duplicate detection, a
confirmation gate, and a compensation plan — where do those live?** Putting them in the gateway would
require it to keep state (what was already created, what an "idempotency key" maps to) and to make
business decisions (is this a duplicate? should the agent be allowed to commit?) — both of which the
gateway is defined not to do. We are deciding now because writes are the next slice and the Cloudbeds
booking write-path (E-08) already set the precedent informally; this ADR makes it a durable invariant
before a *fiscal* provider raises the stakes.

## Decision

**MCP write tools are thin passthrough — the gateway implements no write-safety. All of it lives in the
consumer (xcale-backend).**

Concretely:

- **Gateway (xcale-mcp-server):** a Siigo write tool (`mcp_siigo_create_invoice`, `create_customer`, …)
  validates its input shape, POSTs to the Siigo endpoint, and returns Siigo's response verbatim. It does
  **not** deduplicate, does **not** keep an idempotency ledger, does **not** decide whether the caller
  may commit, and does **not** retry a write. One tool call = at most one external mutation.
- **Consumer (xcale-backend) owns four safety responsibilities:**
  1. **Idempotency + duplicate detection.** Before creating a fiscal document, the consumer checks for
     an existing one carrying the caller's own reference marker (the reconciliation handle — e.g. an
     `xpi-`-style tag in the document's `observations`, mirroring the Cloudbeds/Toteat pattern). A
     re-issued create with the same marker returns the existing document instead of a second one.
  2. **Confirmation guardrail (two-phase).** The agent may not create a fiscal invoice in one shot. The
     flow is *propose → explicit user/system confirmation → commit*. An irreversible DIAN document is
     never a side effect of a single model turn.
  3. **Compensating action.** The write path knows that the correction for a wrong sales invoice is a
     **credit note**, never a delete. Compensation is a consumer capability, not a gateway one.
  4. **Sequencing + de-risking.** Writes ship only after Slice-1 (reads) passes its prod-soak gate
     (Siigo feature-design §9). The first write shipped is a **non-fiscal** mutation (`create_customer`)
     to prove the write machinery — input validation, error mapping, the idempotency/confirmation
     wiring — before the irreversible fiscal `create_invoice`.

This is the same red line the gateway already draws for reads (fidelity over unification, no business
logic), extended to writes: **provider knowledge in the gateway, write *safety* in the consumer.**

## Grill resolutions (2026-08-13) — refinements baked into the Decision

An adversarial grill graded all four responsibilities *directionally right but each with a load-bearing
gap*. The core shape is unchanged; these refinements supersede the initial bullets above.

**Cross-cutting theme — the gateway is at-most-once, not exactly-once.** Siigo exposes **no
client-supplied idempotency key**, so every irreversible fiscal write (invoice *and* credit note) is
exposed to the network-retry duplicate hazard. Consequence: the caller's reference marker in
`observations` is **not** a secondary audit trail — it is the **primary recovery key**.

1. **Idempotency — atomic reserve-before-POST + targeted reconciliation.** The consumer's ledger
   (`idempotencyKey → {status, siigoDocId}`) keys on the reconciliation reference tag / order id (**never**
   a content hash). The `pending` entry is *reserved atomically before the external POST* (Mongo
   unique-index conditional upsert, never check-then-create) so two instances can't both mint. A
   `pending` stuck because the POST committed but the response was lost is resolved **only** by a
   *targeted reconciliation read* ("does a doc with my tag exist?"): found → backfill + done; not found →
   safe to retry. **Blind retry** (duplicate DIAN doc) and **blind reject** (orphaned doc) are forbidden.
2. **Confirmation — an out-of-band signal that IS the idempotency key.** The commit authorization must be
   an out-of-band, backend-verified event (human tap / verified UI event) the LLM **cannot** emit — a
   model-menu confirm tool is forgeable by prompt injection (rejected), as is a per-tool `dry_run` flag.
   Flow: *preview (no create) → out-of-band confirm → commit*; the **preview id doubles as the idempotency
   key** (re-confirm/timeout-retry returns the first doc, never a second POST), with a business-key
   (order/sale id) dedup behind it so two conversations confirming one sale can't both mint.
3. **Compensation — gated identically, own recovery key.** A credit note is *itself* a fiscal write:
   same propose→confirm→idempotency path, never agent-autonomous, never a delete. It carries its **own**
   reference (`xpi-cn-<invoiceRef>`), its own detect-before-retry check, and is gated behind having
   **reconciled the target invoice's DIAN identifier** (number/CUFE) — not merely a click. Fixed 2 levels
   (write + its one compensation); a wrong credit note is a support escalation, not a second autonomous one.
4. **Sequencing — gate on the guardrail's read-dependency, not "fiscal vs not".** A write ships once *the
   specific read its dedup depends on* is prod-proven. `create_customer` may precede the full read-suite
   soak, but **only after `tercero`-lookup-by-NIT soaks**, and its dedup must key on the buyer NIT
   **cross-turn** (concurrent turns on one shared connection — one credential = one company, no
   cross-conversation serialization — are the real duplicate vector). The hard soak gate stays on
   `create_invoice`. If `tercero` can't carry the `xpi-` tag, `create_customer` does **not** exercise the
   reconciliation seam, so `create_invoice`'s soak can't lean on it.

**Gateway-side fix (validation line):** the adapter's zod for a fiscal write must encode Siigo's
documented **structural minimums** — `≥1` line item, non-negative amounts/quantities, all required fiscal
fields present — not merely presence + JS types. A typed-but-empty invoice is structurally degenerate and,
once Siigo 200s it, DIAN-irreversible; **do not trust Siigo to 400** a malformed-but-typed payload (this
rail has repeatedly failed to validate the expected — Partner-Id, Cloudbeds `action`). Still **no** tax
math, id-existence, or authorization in the gateway — those stay in the consumer.

## Alternatives Considered

### Alternative A: Gateway implements idempotency + duplicate detection
- **Pros:** one place enforces write-safety for every consumer; a consumer can't forget it.
- **Cons:** requires the gateway to hold state (an idempotency-key → result ledger) and to make a
  business judgment ("is this a duplicate?"). That breaks stateless-gateway-and-thin-acl and
  canonical-provider-pattern outright. It also can't work for the `reference` strategy cleanly — the
  gateway doesn't own the connection or its history; the consumer does.
- **Why rejected:** it moves state and business decisions into the layer explicitly defined to hold
  neither, and duplicates responsibilities the consumer already has (it owns the connection, the
  reconciliation store, and the agent turn).

### Alternative B: Provider-specific write orchestration in the gateway adapter
- **Pros:** the "how to create a Siigo invoice safely" knowledge sits with the Siigo adapter.
- **Cons:** write *safety* is not provider knowledge — it's tenant/business policy (when may an agent
  commit? what counts as a duplicate for THIS tenant? what's the reconciliation handle?). Embedding it
  per-adapter scatters business logic across `src/providers/*` and re-introduces the per-provider
  branching the platform exists to avoid.
- **Why rejected:** conflates provider knowledge (Siigo's endpoint + payload shape — which IS the
  adapter's job) with consumer policy (idempotency, confirmation — which is not).

### Alternative C (accepted): Thin gateway passthrough + consumer-owned safety
- **Pros:** preserves the stateless/thin gateway and the read/write symmetry (fidelity, one call → one
  effect); puts idempotency/dedup/confirmation/compensation where the state and the policy already live
  (the consumer owns the connection, the reconciliation store, and the agent loop); reuses the
  established Cloudbeds/Toteat reconciliation-tag pattern; a second fiscal provider inherits the model
  with zero gateway change.
- **Cons:** every consumer of a write tool must implement the four safety responsibilities — the gateway
  won't catch a consumer that forgets. Mitigated because xcale-backend is the only consumer and the
  responsibilities are concentrated in one write-orchestration seam, guard-tested.
- **Why accepted:** it is the only option that keeps both invariants (stateless gateway, provider-agnostic
  adapters) intact while placing fiscal safety with the layer that has the state and the authority to
  enforce it.

## Consequences

### Positive
- The gateway stays stateless and thin; adding a fiscal provider's write tool is still "one adapter +
  one line", no new gateway machinery.
- Write-safety is centralized in one backend seam (not scattered per-provider), so the confirmation
  guardrail and duplicate policy are auditable in one place.
- Read/write symmetry: a write tool is the same shape as a read tool (passthrough), so the provider
  pattern and its conformance tests extend unchanged.

### Negative
- The safety net is consumer-side only — a future third-party consumer of the gateway that skipped the
  four responsibilities could create duplicate fiscal documents. The gateway offers no backstop by
  design. (Acceptable while xcale-backend is the sole consumer; revisit if a second one appears.)
- More surface in the backend: an idempotency/reconciliation store keyed per connection, a two-phase
  agent flow, and the compensating-action logic — all net-new work in Slice 2.
- Reversing this (moving safety into the gateway) would mean giving the gateway a database and business
  rules — a large migration and a contradiction of two standing ADRs.

### Neutral
- The consumer now owns the reconciliation-handle contract (what marker identifies "the caller's own"
  document). It must be Observed against Siigo's write payload (does `observations` round-trip? is there
  a dedicated external-reference field?) before the write api-contract is frozen.
- The write api-contract (payload shapes, error model) is authored later, from a **sandbox write probe**
  (same Observed discipline as the reads) — this ADR fixes the *architecture*, not the wire.

## References

- Related ADRs: [stateless-gateway-and-thin-acl](stateless-gateway-and-thin-acl.md),
  [canonical-provider-pattern](canonical-provider-pattern.md),
  [credential-delivery-strategies](credential-delivery-strategies.md),
  [typed-tool-result-error-contract](typed-tool-result-error-contract.md)
- Feature design: `docs/design/siigo-read-only-provider/feature-design.md` (§5 Won't-Have — writes are
  Slice 2; §9 prod-soak gate), `docs/design/siigo-read-only-provider/api-contract.md` (read surface),
  `docs/design/siigo-read-only-provider/ship-log.md`
- Precedent: the Cloudbeds booking write-path (E-08) established consumer-owned reconciliation informally;
  this ADR makes it a durable invariant before the first *fiscal* write.
- Sequencing: writes gated behind Slice-1 prod-soak; first write is non-fiscal (`create_customer`).
