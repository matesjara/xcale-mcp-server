# ADR 0007: Typed tool-result and closed error-code contract

- **Status:** Accepted
- **Date:** 2026-06-19
- **Decision makers:** Juan José (design lead), xcale team
- **Tags:** mcp, contract, errors, correctness

## Context

`tools/call` results — successes and failures — cross the backend↔server boundary and drive
backend behavior. The most important case: a provider 401/403 must trigger Rail A's
`markConnectionAuthFailure()` → reconnect prompt. The grill chose to signal this as an MCP
`isError: true` result carrying `structuredContent.code = "PROVIDER_AUTH_EXPIRED"`.

A free-form string code is fragile: it is not exhaustively checkable, invites typos and drift
between repos, and is exactly the kind of contract that breaks silently (the LLM/consumer
mis-handles it without an error). The team explicitly questioned relying on ad-hoc strings. The
investigation pointed to discriminated unions (TypeScript), RFC 9457 problem-details (the
`type`-as-discriminator pattern), and a small useful subset of gRPC status codes.

## Decision

Model tool results as a **TypeScript discriminated union** with a **closed `as const` set of
error codes**, mapped to MCP's `isError`/`structuredContent` only inside the `src/protocol/` ACL:

```typescript
type ToolResult =
  | { kind: 'success'; toolName: string; providerSlug: string; data: unknown; message?: string }
  | { kind: 'error'; code: ProviderErrorCode; toolName: string; providerSlug: string; message: string };

const ProviderErrorCode = {
  AUTH_EXPIRED: 'PROVIDER_AUTH_EXPIRED',
  RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  INVALID_INPUT: 'PROVIDER_INVALID_INPUT',
  UNKNOWN_TOOL: 'PROVIDER_UNKNOWN_TOOL',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const;
type ProviderErrorCode = typeof ProviderErrorCode[keyof typeof ProviderErrorCode];
```

The code set is **closed and evolves additively only** (see
[additive-contract-versioning](0001-additive-contract-versioning.md)). Both repos `switch` on `code`
with an exhaustiveness guard; the backend treats unknown future codes as a generic error. A
provider auth failure is a **tool-execution** result (`isError: true`), never a JSON-RPC
protocol error.

## Alternatives Considered

### Alternative A (rejected): Free-form string `code`
- **Pros:** Zero ceremony.
- **Cons:** No exhaustiveness; drift/typos; silent mishandling.
- **Why rejected:** the failure mode the team flagged.

### Alternative B (rejected): JSON-RPC protocol error for auth expiry
- **Pros:** "Clean" as an error.
- **Cons:** Semantically wrong (it's a tool failure, not protocol); the agent gets no usable
  result; mixes layers.
- **Why rejected:** wrong layer.

### Alternative C (rejected): Full gRPC status model / RFC 9457 `application/problem+json`
- **Pros:** Mature, standardized.
- **Cons:** gRPC's 17 codes + proto serialization is overkill; RFC 9457 is an HTTP-body idiom,
  not JSON-RPC `structuredContent`.
- **Why rejected:** over-engineered; wrong idiom. We borrow the *pattern* (discriminator +
  type-specific fields), not the format.

### Alternative D (accepted): Discriminated union + closed `as const` codes
- **Pros:** Compile-time exhaustiveness on both sides; no runtime enum artifact; additive-safe;
  machine-readable; right idiom for JSON-RPC.
- **Cons:** The wire mapping (domain union → MCP `structuredContent`) must be tested explicitly.
- **Why accepted:** robust and proportionate.

## Consequences

### Positive
- The backend branches on a typed, exhaustive enum, not parsed strings; `AUTH_EXPIRED` reliably
  drives reconnect.
- New error conditions are additive and backward-compatible.

### Negative
- The domain-union → MCP-`structuredContent` mapping in `src/protocol/` needs explicit tests
  (TypeScript can't prove the SDK's `Record<string,unknown>` matches the union on the wire).
- The code set is a shared contract; the canonical list lives in `CONTEXT.md` and `core/types.ts`.

### Neutral
- `PROVIDER_AUTH_EXPIRED` is now a first-class, documented contract term consumed by Rail A.

## References
- Architecture review: `docs/architecture-review.md` §4.3
- Foundation: `docs/foundation.md` Q-1, FR-5
- Glossary: `CONTEXT.md` (`PROVIDER_AUTH_EXPIRED`)
- Related ADRs: [additive-contract-versioning](0001-additive-contract-versioning.md), [stateless-gateway-and-thin-acl](0005-stateless-gateway-and-thin-acl.md)
- External: RFC 9457 (problem details pattern); gRPC status codes (subset); TS "prefer unions over enums"
