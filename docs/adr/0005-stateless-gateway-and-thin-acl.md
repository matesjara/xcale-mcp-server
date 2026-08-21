# ADR 0005: Stateless single gateway with a thin anti-corruption layer

- **Status:** Accepted
- **Date:** 2026-06-19
- **Decision makers:** Juan José (design lead), xcale team
- **Tags:** architecture, mcp, transport, deployment

## Context

MCP is a volatile protocol — breaking spec revisions roughly every quarter, and a "silent
breakage" failure mode where a changed schema makes the LLM hallucinate rather than throw. The
server must absorb that volatility without it rippling into every provider adapter. Separately,
the server must decide its transport mode, deployment topology, and how deeply to abstract the
protocol.

Two soul.md principles are in tension: *isolate the volatility* (argues for an anti-corruption
layer) vs *don't pre-abstract* (argues against mirroring MCP types or abstracting transport with
only one protocol in play). The MCP 2026-07-28 release candidate removes protocol sessions
entirely — retroactively validating a stateless choice made earlier in the grill to sidestep
exactly that change.

## Decision

Three locked decisions:

1. **Thin anti-corruption layer.** The MCP SDK is imported **only** in `src/protocol/`, which
   translates MCP wire types ↔ our own domain types (`IProvider`, `ToolResult`, `ProviderCallContext`).
   Provider adapters never import `@modelcontextprotocol/sdk`. JSON Schema is reused as-is. The
   **transport is NOT abstracted** (one protocol, one transport — no `ITransport` until a second
   one is real).
2. **Stateless Streamable HTTP.** No `Mcp-Session-Id`; each `tools/call` is an independent POST.
   The server holds no per-connection state and is horizontally scalable.
3. **Single in-process gateway.** One deployable service fronts all providers via an explicit
   registry, on DO App Platform + Doppler — not a service-per-provider.

## Alternatives Considered

### Transport: stateful sessions vs stateless
- **Stateless (accepted):** matches the stateless-auth design, sidesteps the 2026 RC session
  removal, scales horizontally. **Accepted.**
- **Stateful (rejected):** `Mcp-Session-Id` is being removed by the spec; needs session affinity;
  no benefit here.

### ACL depth: none / thin / thick
- **No ACL (rejected):** adapters return SDK types directly → every MCP break edits all adapters.
- **Thick / transport-agnostic core (rejected):** pluggable transports (MCP/gRPC/REST) abstracted
  now — premature with one protocol and one consumer; the rejected "Architecture C".
- **Thin ACL (accepted):** own domain types, SDK confined to `src/protocol/`, transport not
  abstracted. Isolates volatility without pre-abstraction.

### Topology: single gateway vs service-per-provider
- **Single gateway (accepted):** simplest, cheapest, the shape Composio converged to; in-process
  isolation (no shared mutable state) is enough for 1–30 providers.
- **Service-per-provider (rejected):** N deploys/URLs/configs — premature operational overhead for
  a bootstrapped team.

## Consequences

### Positive
- MCP breaking changes are contained to one folder; provider code is insulated.
- Stateless + single gateway = trivial horizontal scaling, low cost, aligned with the 2026 RC.

### Negative
- The `src/protocol/` ACL is a real translation layer to maintain and test (mapping must be
  covered explicitly, since TypeScript can't prove the SDK's `Record<string,unknown>` matches our
  union on the wire).
- Single gateway means one provider's runaway resource use can affect peers; mitigated by the
  "no shared mutable state, one adapter's failure must not corrupt another" rule.

### Neutral
- `MCP_PROTOCOL_VERSION` is pinned as a constant; protocol upgrades are deliberate, coordinated
  changes (see [additive-contract-versioning](0001-additive-contract-versioning.md)).

## References
- Architecture review: `docs/architecture-review.md` §3, §4.2
- Foundation: `docs/foundation.md` §6, Q-4
- Related ADRs: [three-pillar-mcp-contract-with-discovery](0006-three-pillar-mcp-contract-with-discovery.md), [additive-contract-versioning](0001-additive-contract-versioning.md)
- External: MCP 2026-07-28 release candidate (session removal); MCP versioning spec
