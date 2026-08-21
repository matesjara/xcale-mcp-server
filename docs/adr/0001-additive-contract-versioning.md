# ADR 0001: Additive-only contract evolution with a per-provider schema version

- **Status:** Accepted
- **Date:** 2026-06-19
- **Decision makers:** Juan José (design lead), xcale team
- **Tags:** mcp, contract, versioning, integrations

## Context

The backend↔server boundary now spans three pillars (`server/discover`, `tools/list`,
`tools/call`), the `authDescriptor`, the `contextSchema`, and the typed error contract. As the
server evolves (new providers, changed tool schemas, new error codes) it must **not break the
backend client**, which is deployed and on the agent's critical path. MCP itself provides no
client↔server version-awareness between tool schema changes, and its silent-breakage mode means a
changed schema can degrade the agent without throwing. The team flagged that the discovery/
descriptor contracts must be "versioned carefully."

## Decision

Adopt **additive-only evolution** as the default, with two explicit version signals:

1. **`MCP_PROTOCOL_VERSION`** — a pinned constant in both repos. Bumping it is a deliberate,
   coordinated, same-release change. Never send `LATEST`.
2. **`schemaVersion`** — a per-provider string, published in `server/discover` and returned with
   `tools/list`. The backend keys its `tools/list` cache on `(slug, schemaVersion)`, so a server
   redeploy that changes a provider's schema invalidates the cache deterministically.

**Evolution rules:**

| Change | Action |
|:--|:--|
| New provider; new tool; new **optional** field on input/result; new error code | **Additive — no coordination.** Backend ignores unknown fields; unknown error codes fall through to generic handling. |
| Rename/remove a **required** field; rename a tool; change a tool's semantics | **Breaking.** Bump the provider's `schemaVersion`; keep the old name/field as an alias for one release cycle; coordinate the backend release. |
| `IProvider` / internal types | Internal only — invisible to the backend, no coordination. |
| MCP protocol version | Bump `MCP_PROTOCOL_VERSION` in both repos in the same PR batch. |

## Provider lifecycle (reserved, modeled now)

Beyond *contract* versioning, each **provider** has its own lifecycle — modeled now, enforced when
first needed. The `manifest.ts` / catalog entry reserves:

- `providerVersion` — the adapter's own semver (bumped on adapter changes).
- `apiVersion?` — the upstream provider API version this adapter targets.
- `deprecated?` — migrate signal; still callable.
- `sunsetDate?` — ISO date after which the provider/tool may stop working.

These surface via `server/discover` so consumers can warn operators about deprecation/sunset. **v1
ships `providerVersion` + `schemaVersion` only**; `apiVersion`/`deprecated`/`sunsetDate` are
reserved fields so a provider can evolve or be retired without breaking consumers — no need to
implement the lifecycle machinery before the first real deprecation.

The same reservation applies to **optional provider capabilities** (`streaming`, `longRunning`,
`webhooks`, `polling`, `files`, `pagination`, `autoRefresh`) — modeled in the catalog now, absent =
not supported, implemented only on demonstrated need (see `docs/architecture-review.md` §4.3).

## Catalog stability policy

`server/discover` is a critical, widely-consumed surface. Its evolution obeys four explicit rules,
so the ecosystem can grow without breaking consumers:

1. **Additive changes** (new providers, new *optional* fields, new tools, new error codes) —
   allowed, no coordination.
2. **Removal or incompatible change** — requires **prior deprecation** (`deprecated` + a
   `sunsetDate`), never an abrupt break.
3. **Unknown fields** — consumers MUST **ignore** fields they don't understand (forward
   compatibility).
4. **Existing fields** — never change meaning without a version bump (`schemaVersion` /
   `MCP_PROTOCOL_VERSION`).

These rules also govern the lifecycle and capability fields above.

## Alternatives Considered

### Alternative A (rejected): No versioning ("the contract never changes")
- **Pros:** Nothing to build.
- **Cons:** False — the §16 endgame (migrating natives) guarantees the contract grows. Silent
  drift would break the backend.
- **Why rejected:** unrealistic.

### Alternative B (rejected): Full semver + URL versioning (`/v2/mcp`)
- **Pros:** Familiar; explicit major breaks.
- **Cons:** Heavy for two first-party repos with one consumer; MCP's own model is date-based, not
  semver.
- **Why rejected:** over-engineered for the current topology.

### Alternative C (accepted): Additive-only + pinned protocol version + per-provider schemaVersion
- **Pros:** Cheap; matches MCP's additive philosophy; deterministic cache invalidation; breaking
  changes are explicit and coordinated.
- **Cons:** Requires discipline (a CI check can assert the protocol-version pin matches the header).
- **Why accepted:** proportionate and robust for two coordinated repos.

## Consequences

### Positive
- New providers and tools ship without touching or breaking the backend client.
- Cache staleness after a schema change is solved deterministically via `schemaVersion`.

### Negative
- Breaking changes still require a coordinated two-repo release (acceptable: same org, same team).
- A discipline contract: contributors must know "additive = free, breaking = bump + coordinate."

### Neutral
- `schemaVersion` becomes part of every provider's `manifest.ts`; the conformance CI gate can
  assert it is present.

## References
- Architecture review: `docs/architecture-review.md` §4.3, §7
- Foundation: `docs/foundation.md` Q-2
- Related ADRs: [three-pillar-mcp-contract-with-discovery](0006-three-pillar-mcp-contract-with-discovery.md), [typed-tool-result-error-contract](0007-typed-tool-result-error-contract.md), [stateless-gateway-and-thin-acl](0005-stateless-gateway-and-thin-acl.md)
- External: MCP versioning spec (date-based, additive); MCP TypeScript SDK issue #2108 (protocol-version pinning)
