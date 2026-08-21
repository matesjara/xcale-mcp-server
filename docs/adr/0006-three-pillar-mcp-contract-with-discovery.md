# ADR 0006: Three-pillar MCP contract with capability discovery

- **Status:** Accepted
- **Date:** 2026-06-19
- **Decision makers:** Juan José (design lead), xcale team
- **Tags:** mcp, contract, integrations, discovery

## Context

The grill design defined the backend↔server contract as exactly two MCP methods: `tools/list`
and `tools/call`. That is sufficient to *execute* tools, but it gives the backend no way to learn
*which providers exist*, *what auth each needs*, or *what call-context each requires* — so that
knowledge ends up duplicated in `xcale-backend` (today: `MCPToolboxDefinition` entries +
Rail A's `registerOAuthProvider(...)`). That duplication is exactly the provider-knowledge leak
this project exists to eliminate, and it breaks the Provider Self-Containment principle (adding a
provider would require editing the backend).

The investigation found that every mature integration platform and MCP gateway (Composio Tool
Router, Kong, Tyk, IBM ContextForge) exposes a **catalog / discovery** surface separate from tool
execution, and that the MCP 2026-07-28 release candidate introduces `server/discover` as a
first-class primitive plus `ttlMs`/`cacheScope` hints on `tools/list`.

## Decision

Adopt a **three-pillar contract**: add **`server/discover`** as the discovery pillar alongside
`tools/list` and `tools/call`. `server/discover` returns the **capability catalog** — for each
registered provider: `slug`, `displayName`, `category`, an adaptive non-secret `authDescriptor`,
the declared `contextSchema`, `toolCount`, `health`, and `schemaVersion`. The backend consumes
this catalog to register and operate providers **generically**, treating the server as a black
box that publishes its capabilities. `server/discover` requires Hop B auth but **never**
`X-Provider-Token`. `tools/list` additionally emits `ttlMs` + `cacheScope` hints (additive).

## Alternatives Considered

### Alternative A (rejected): Keep the two-method contract
- **Pros:** Smallest surface; nothing new to version.
- **Cons:** Provider knowledge stays split across both repos; onboarding requires backend edits;
  silent divergence when a provider is added on one side only.
- **Why rejected:** defeats the strategic goal and the self-containment principle.

### Alternative B (rejected): Expose the catalog via MCP `resources/list`
- **Pros:** Reuses an existing MCP primitive.
- **Cons:** `resources` are client-controlled with inconsistent client support; semantically a
  poor fit for "provider metadata the backend reads programmatically."
- **Why rejected:** wrong primitive; brittle client support.

### Alternative C (accepted): `server/discover` as a dedicated discovery pillar
- **Pros:** Single source of truth for provider knowledge on the server; backend discovers
  dynamically; aligns with the MCP 2026 RC direction; enables `contextSchema`/`authDescriptor`
  validation; keeps execution and discovery cleanly separated.
- **Cons:** Adds a contract surface that must be versioned carefully.
- **Why accepted:** it is the mechanism that makes the backend stop growing per provider.

## Consequences

### Positive
- Adding a provider becomes discoverable with no backend code change (principle #0).
- Eliminates silent server↔backend divergence; the catalog is authoritative.
- Forward-aligned with the MCP 2026-07-28 RC.

### Negative
- A third contract surface to evolve; governed by additive-only versioning + `schemaVersion`
  (see [additive-contract-versioning](0001-additive-contract-versioning.md)).

### Neutral
- The backend gains an MCP-client step that calls `server/discover` (likely at provider
  registration / startup), cached like `tools/list`.

## References
- Architecture review: `docs/architecture-review.md` §4.1
- Foundation: `docs/foundation.md` §7, Q-9
- Related ADRs: [provider-knowledge-vs-credential-custody](0004-provider-knowledge-vs-credential-custody.md), [additive-contract-versioning](0001-additive-contract-versioning.md)
- External: MCP 2026-07-28 release candidate (`server/discover`, `ttlMs`/`cacheScope`); Composio Tool Router
