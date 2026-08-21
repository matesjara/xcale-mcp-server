# ADR 0002: Consumer-agnostic public contract (xcale-backend is a client, not a dependency)

- **Status:** Accepted
- **Date:** 2026-06-19
- **Decision makers:** Juan José (design lead), xcale team
- **Tags:** architecture, contract, integrations, reusability

## Context

The strategic goal is a "Composio LATAM" — a real integration **platform**, not "the MCP server
that xcale-backend happens to call". Early framing (foundation.md, the grill) consistently
described the boundary as "between xcale-backend and this server", which quietly assumes a single,
named consumer. If that assumption leaks into the public contract (xcale entity names, tenant ids,
plan/business concepts, single-caller assumptions), the server becomes coupled to one backend and
can never be reused — undermining the platform goal and making the boundary harder to evolve.

Composio's leverage comes precisely from being consumer-agnostic: its contracts know nothing about
any particular customer's domain. We want the same property, while keeping credential custody on
the consumer side (xcale's Rail A) per `provider-knowledge-vs-credential-custody`.

## Decision

**The public contract is consumer-agnostic. xcale-backend is the first consumer, not a
dependency.** Concretely, the server's public surface (`server/discover`, `tools/list`,
`tools/call`, the `authDescriptor`, the `contextSchema`, the error contract) MUST NOT contain:

- **Consumer-specific concepts** — no xcale entities, tenant/user ids as domain concepts, plan,
  billing, or business terms. The server is told *which token* and *which tool* (+ opaque,
  provider-scoped routing metadata), never *which tenant* or *which plan*.
- **Business logic** — pricing, authorization, orchestration, tenancy live in the consumer.
- **Single-consumer assumptions** — nothing in the design assumes exactly one caller.

This is a **design constraint, not a v1 marketing goal**: v1 still serves only xcale (foundation
§5.2 — not a marketplace yet). Consumer-agnosticism is about *not foreclosing* reuse, not about
actively onboarding third parties now.

## Alternatives Considered

### Alternative A (rejected): xcale-coupled contract
- **Pros:** Slightly more convenient short-term (could pass xcale ids/§concepts straight through).
- **Cons:** Locks the server to one backend; leaks business concepts into integration plumbing;
  makes the boundary brittle and the platform goal unreachable.
- **Why rejected:** contradicts the "Composio LATAM" objective.

### Alternative B (rejected): Full multi-tenant SaaS platform now (third-party onboarding in v1)
- **Pros:** Maximally reusable.
- **Cons:** Massive scope (tenancy, billing, API keys for external consumers) with no second
  consumer to justify it; violates soul.md proportionality.
- **Why rejected:** premature; v1 has one consumer.

### Alternative C (accepted): Consumer-agnostic contract, single consumer in v1
- **Pros:** Keeps the door open to reuse at near-zero cost; forces clean, business-free contracts;
  makes migration of natives and future consumers painless.
- **Cons:** Occasionally forgoes a convenient xcale-specific shortcut in the contract.
- **Why accepted:** the proportionate way to honor the platform goal without over-building.

## Consequences

### Positive
- The server can be consumed by any MCP-compatible client; xcale-backend is replaceable/additive.
- Public contracts stay clean (no business concepts), which also makes them easier to version.

### Negative
- Contributors must resist the temptation to pass consumer-specific data through the contract;
  enforced by review (see the PR checklist) and this ADR.

### Neutral
- "Routing metadata" (`accountKey`, `storeId`) is permitted but must be **opaque and
  provider-scoped**, never consumer-domain identity.

## References
- Architecture review: `docs/architecture-review.md` §0 (principle #2), §5
- Foundation: `docs/foundation.md` §4.1 (reusability), §5.2 (not a marketplace yet)
- Related ADRs: [provider-knowledge-vs-credential-custody](0004-provider-knowledge-vs-credential-custody.md), [three-pillar-mcp-contract-with-discovery](0006-three-pillar-mcp-contract-with-discovery.md)
- External: Composio (consumer-agnostic catalog); MCP spec (open standard, any compatible client)
