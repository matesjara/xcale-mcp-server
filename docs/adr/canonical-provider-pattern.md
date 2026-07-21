# ADR: Canonical provider implementation pattern

- **Status:** Accepted
- **Date:** 2026-06-21
- **Decision makers:** Juan José (design lead), xcale team
- **Tags:** integrations, architecture, contract, testing, mcp

## Context

Cloudbeds is the first real provider **and** the reference adapter every future provider will
copy. A `/grill` session (2026-06-21) pressure-tested not just Cloudbeds but the *shape of the
canonical adapter* — so the patterns below are platform-wide, not Cloudbeds-specific. They extend,
and are governed by, the existing ADRs (provider-knowledge-vs-credential-custody, typed-tool-result-error-contract,
additive-contract-versioning, consumer-agnostic-contract, credential-forwarding-and-token-model).

The driving constraint: the platform must stay **scalable and maintainable** from 1 to dozens of
providers, with adding a provider remaining mechanical (Provider Self-Containment, §0 of the
architecture review). That requires the cross-cutting *policies* to be centralized and enforced,
while provider-*specific* behavior stays isolated.

## Decision

Adopt the following patterns as the canonical provider implementation, enforced by the
`add-provider` template, code review (PR template), and CI.

### 1. Single Source of Truth for tool contracts (typed handlers)

Each tool has **one** schema (zod). Every derived representation (the `tools/list` JSON Schema,
published types, docs) is **generated** from it (`zod-to-json-schema` today; the principle outlives
the library). A `defineTool({ name, description, input, handler })` helper makes this the path of
least resistance: the provider's `callTool` becomes a generic dispatcher that validates `args`
against `input` **before** calling the handler, so handlers receive **already-validated, typed**
arguments. **Forbidden:** duplicated schemas or a hand-written `inputSchema` when it can be derived
(the `echo` stub's dual-schema shape must not be repeated). Enforced by a **CI guard**.

### 2. Explicit, consumer-controlled pagination

All list tools share a uniform contract: `page`/`pageSize` args (sane defaults, capped max) and a
uniform `PaginatedResult<T>` envelope (`items`, `page`, `pageSize`, `totalPages?`, `totalResults?`,
`hasMore?`; fields absent upstream are documented, never inferred). **No auto-pagination** and **no
internal 429 retry loop** in v1 — the adapter returns `RATE_LIMITED` and the consumer decides
retries. "The adapter never hides the cost of traversing large data." Deviations require an ADR.

### 3. Explicit Context (per-provider `metadataSchema`)

When an operation can target multiple logical contexts (property, org, workspace, region…), the
target must be **explicit and validated, never silently inferred**. Each provider declares its own
`metadataSchema` (zod); the dispatcher validates `ctx.metadata` and passes it **typed** to handlers.
The core never assumes a field name (no `propertyID` in the framework). Missing/invalid → typed
`INVALID_INPUT`; no implicit defaults.

### 4. Fidelity over Unification

The server is an integration platform, not a domain-unification layer. Success `data` carries the
**provider's data with its original semantics**; the core standardizes only the *envelope*
(`ToolResult`, `PaginatedResult`, error codes, metadata). Curation (documented field projection for
clarity/token-budget) is allowed; **transformation, renaming, or cross-provider canonical models
(`Reservation`, `Guest`, …) are not.** Preserve information; when in doubt keep the original field.
A canonical entity may only be introduced via a dedicated ADR with strong justification.

### 5. Share policies, not assumptions

The core centralizes **universal invariants** (security, typing, contracts, error mapping):
`mapHttpStatusToErrorCode` (the typed-error contract) and safe token application at egress
(`SecretString.reveal()` only there, never logged) live in a **minimal** core helper. Everything
provider-specific (base URL, encoding, params, parsing) stays in `src/providers/{slug}/client.ts`.
**Red line:** that helper must not grow into a generic HTTP framework (interceptors/retries/builders)
— that requires an ADR and a *second* real provider. General rule: extract shared behavior only
when ≥2 independent implementations prove it; the sole exception is security/contract invariants
that must be identical ecosystem-wide.

### 6. Testable by construction (DI factory + fixtures + conformance)

Each provider is exposed via `createXProvider(deps?)` with the HTTP transport injected (default =
real); the registry holds the default instance. Unit tests inject a fake transport returning
**anonymized recorded fixtures** (`__fixtures__/`) — deterministic, no network — covering success,
pagination limits, and every error path (`AUTH_EXPIRED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`,
`INVALID_INPUT`, unexpected provider errors, invalid/missing metadata, empty responses). The
reusable `runProviderConformance` suite (platform invariants) is mandatory. Sandbox/live tests are
**opt-in, env-gated, outside CI**. The factory is designed to also accept future deps (clock, id
generator, retry policy, safe logger) without adding complexity now. **Quality rule:** if a refactor
breaks conformance or requires changing fixtures without a provider-contract change, assume a
regression until proven otherwise.

## Consequences

### Positive
- Every provider exposes a uniform, typed, fidelity-preserving contract; onboarding stays mechanical.
- Security/error invariants are centralized and enforced (consistent across all providers).
- Tests are deterministic and CI-stable; conformance prevents drift.

### Negative
- Two new minimal core helpers (`defineTool`, the http/error helper) + `PaginatedResult` are
  abstractions introduced at provider #1 — justified because they encode *invariants/policies*, not
  speculative similarity. The red line (no HTTP framework) guards against over-reach.

### Neutral
- The `add-provider` template and PR template now encode these as the default path; CI enforces the
  schema single-source rule.

## References
- Grill session 2026-06-21 (this ADR consolidates its outcomes).
- Architecture review: `docs/architecture-review.md` §0, §4.3.
- Related ADRs: [typed-tool-result-error-contract](typed-tool-result-error-contract.md),
  [provider-knowledge-vs-credential-custody](provider-knowledge-vs-credential-custody.md),
  [additive-contract-versioning](additive-contract-versioning.md),
  [consumer-agnostic-contract](consumer-agnostic-contract.md),
  [credential-forwarding-and-token-model](credential-forwarding-and-token-model.md)
- Pilot applying it: `docs/design/cloudbeds-pilot/feature-design.md`.
