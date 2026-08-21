# Siigo write-path — grill prep (for tomorrow)

> **STATUS: grill DONE 2026-08-13.** All 5 forks resolved (needs-change; core ADR shape held). Refinements
> baked into `../../adr/0015-fiscal-write-path.md` (§ Grill resolutions) + 6 new CONTEXT.md terms. Next step is
> the **sandbox write probe** below, then the write api-contract → feature-design → build (post Slice-1 soak).

## Write-probe checklist (definitive, from the grill — Observe before the write api-contract)

1. Does `create_invoice` `observations` **round-trip verbatim** (store + return the `xpi-` tag)? If not, the whole reconciliation-tag recovery strategy collapses.
2. Is Siigo **cheaply filterable by our marker** — a date/customer-scoped invoice query surfacing the `observations` tag WITHOUT paging ~110k docs? Gates whether stuck-pending auto-recovery is viable vs a hard block.
3. Confirm `create_invoice` exposes **no client-supplied idempotency key** (Flavor A — memory says none) — the whole detect-after-the-fact model depends on this.
4. `create_invoice` payload shape: exact required fiscal fields, line-item structure, and whether Siigo **200s a zero-line/degenerate typed invoice** (do NOT assume it 400s) — sets the structural zod minimums.
5. Credit-note payload: does it require the original invoice's **DIAN id (number/CUFE)**, and can it carry its own `xpi-cn-` tag? Confirms the read-dependency + separate-tag design.
6. `create_customer` (tercero) **reversibility**: editable/deactivatable in place (non-fiscal)?
7. Does the tercero object carry an `observations`/reference field for the `xpi-` tag? If not, `create_customer` does NOT exercise the reconciliation seam and can't de-risk `create_invoice`.
8. `tercero`-lookup-by-NIT: cheap "does a tercero with this NIT exist?" query — required for cross-turn `create_customer` dedup + its own soak gate.
9. Observe **429 on write bursts** to size retry/backoff and confirm the timeout-then-lost-response failure shape driving idempotency + compensation.

> ⚠️ Probing `create_invoice`/credit-note in the sandbox creates **real DIAN documents** — probe `create_customer` freely; be deliberate about invoice/credit-note creates.

---

## (historical) Original grill prep — subject & claims

# Siigo write-path — grill prep (for tomorrow)

> Everything a fresh session needs to open the write-path grill without re-deriving today's work.
> **How to start:** run `/grill` (xcale-mcp-server) with the ADR below as the subject; it interviews one
> question at a time and updates `CONTEXT.md` as terms resolve. The grill runs *before* the write
> feature-design / api-contract, to pressure-test the architecture while it's cheap to change.

## Subject to grill

ADR **[`fiscal-write-path.md`](../../adr/0015-fiscal-write-path.md)** (Proposed) — "Fiscal write-path: thin MCP
passthrough, consumer-owned safety." Read it first; the grill stress-tests its decision and the four
consumer responsibilities.

## Load-bearing claims to attack (where the grill should push hardest)

1. **"The gateway implements no write-safety."** Is a *thin passthrough write* truly safe, or does even
   the gateway need a minimal guard (e.g. rejecting a malformed fiscal payload before it hits DIAN)?
   Where exactly is the line between "input-shape validation" (adapter's job) and "business validation"
   (consumer's job)?
2. **"Consumer owns idempotency + duplicate detection."** What is the reconciliation handle for a Siigo
   document? Candidate: a marker in `observations` (Cloudbeds/Toteat `xpi-` pattern). **Unverified — needs
   a sandbox write probe:** does `observations` round-trip on read? Is there a dedicated external-reference
   field on invoices/customers? Without a durable, queryable handle, "duplicate detection" has nothing to
   key on.
3. **"Two-phase confirmation guardrail."** Who confirms — the end user, or a system policy? How does a
   propose→confirm flow survive across agent turns without the model re-deciding? Is "confirmation" a new
   tool, a conversation state, or a control-plane gate?
4. **"Compensation = credit note, not delete."** Does creating a credit note fully reverse a wrong invoice
   for DIAN purposes, or only partially? Does the agent get to issue compensation autonomously, or is that
   also gated? Is a credit note itself a fiscal (irreversible) write — i.e. does compensation need the same
   guardrails, risking infinite regress?
5. **"De-risk with `create_customer` first."** Is a customer create actually non-fiscal / reversible? Can a
   customer be updated/deactivated if wrong, or does it also stick? Confirm it's genuinely lower-blast-radius.
6. **Sequencing.** The ADR gates writes behind Slice-1 prod-soak. Is that the right gate, or should the
   non-fiscal `create_customer` ship earlier (it doesn't carry fiscal risk)?

## Open questions the grill can't settle alone (carry to a sandbox write probe, post-grill)

- Exact write payload shapes: `POST /v1/customers`, `POST /v1/invoices` — required fields, how taxes /
  document-type / payment-type / seller are referenced, and the success/error response shapes.
- Whether `observations` (or another field) is a viable, round-tripping reconciliation handle.
- ⚠️ Probing `create_invoice` in the sandbox creates a **real sandbox DIAN document** — probe
  `create_customer` freely; be deliberate about invoice creates (they count, even in sandbox).

## Downstream flow after the grill (unchanged from the plan)

grill → `/feature-design` (write slice) → `/api-contract-authoring` (from the sandbox write probe,
Observed-only) → `/implementation-plan` → build (TDD). **Build ships only after Slice-1 (the 19 reads)
passes its prod-soak gate** (feature-design §9).

## State carried in

- Read integration DONE + verified e2e (19 tools); see `ship-log.md`.
- Idempotency-in-the-consumer is the established pattern ([`credential-delivery-strategies`](../../adr/0010-credential-delivery-strategies.md)
  and the Cloudbeds E-08 booking write-path precedent).
- Sandbox creds: user-held (`sandbox@siigoapi.com` + access key); Partner-Id `EcomerceCG`. The env-from-file
  probe pattern (creds never in chat) is in `ship-log.md` / today's session.
