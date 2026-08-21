# ADR 0008: TypeScript strictness configuration (full strict minus exactOptionalPropertyTypes)

- **Status:** Accepted
- **Date:** 2026-06-19
- **Decision makers:** Juan José (design lead), xcale team
- **Tags:** tooling, typescript, mcp, technical-debt

## Context

We want the codebase maximally type-safe. The natural choice is full `strict` plus the extra
strictness flags (`noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
and `exactOptionalPropertyTypes`).

`exactOptionalPropertyTypes` turned out to be **incompatible with the published types of
`@modelcontextprotocol/sdk`** (our pinned protocol dependency, ADR: stateless-gateway-and-thin-acl).
Concretely, the SDK's transport classes expose:

```ts
get sessionId(): string | undefined
get onclose(): (() => void) | undefined
```

while its `Transport` interface declares those members as *optional* (`sessionId?: string`,
`onclose?: () => void`). Under `exactOptionalPropertyTypes`, an optional `?: T` member may be
absent but, if present, must be exactly `T` (never `undefined`). The SDK's own classes therefore
fail to satisfy its own `Transport` interface, so `server.connect(transport)` and
`client.connect(transport)` do not type-check — in **our** code, with no way to fix the upstream
declarations.

This is an upstream incompatibility, not a defect in our code.

## Decision

Enable **full `strict` and all extra strictness flags EXCEPT `exactOptionalPropertyTypes`**, which
is **off** until the MCP SDK ships exactOptional-compatible types. The decision is recorded here
(not left as a stray relaxed flag) and the `tsconfig.json` comment points to this ADR.

**Revisit trigger:** when `@modelcontextprotocol/sdk` types satisfy their own `Transport`
interface under `exactOptionalPropertyTypes` (or we replace the SDK), re-enable the flag and
delete this exception.

## Alternatives Considered

### Alternative A (rejected): Force the flag on + cast at every SDK boundary
- **Pros:** The flag stays on.
- **Cons:** Requires `as unknown as Transport` casts at each `connect()` and on transport options —
  scattered, unsafe casts that bypass type checking entirely at exactly the integration seams
  where bugs hurt most. That is *more* hidden debt than disabling one niche flag.
- **Why rejected:** trades one tracked, well-understood gap for several silent type holes.

### Alternative B (rejected): Drop strictness broadly to avoid the friction
- **Pros:** No friction.
- **Cons:** Loses real safety across the whole codebase for one incompatible flag.
- **Why rejected:** disproportionate.

### Alternative C (accepted): Full strict minus exactOptionalPropertyTypes, tracked by ADR
- **Pros:** Maximal safety everywhere our code controls; the single gap is explicit, justified,
  and has a revisit trigger; zero unsafe casts.
- **Cons:** Optional-property assignment (`{ x: undefined }` vs absent) is not distinguished by the
  compiler.
- **Why accepted:** the proportionate, honest resolution — governance over hidden casts.

## Consequences

### Positive
- No `as unknown as` casts at the SDK boundary; the protocol ACL stays clean.
- The relaxation is a tracked decision, not a loose end.

### Negative
- One strictness check is unavailable repo-wide. Mitigation: prefer omitting optional properties
  over passing `undefined` (the codebase already uses conditional spreads, e.g. `buildCatalog`).

### Neutral
- Active flags: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`.

## References
- `tsconfig.json` (the comment references this ADR)
- Related ADRs: [stateless-gateway-and-thin-acl](0005-stateless-gateway-and-thin-acl.md)
- Upstream: `@modelcontextprotocol/sdk` transport types (`shared/transport.d.ts`,
  `server/streamableHttp.d.ts`)
