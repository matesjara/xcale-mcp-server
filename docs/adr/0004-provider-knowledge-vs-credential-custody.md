# ADR 0004: Provider knowledge in the server, credential custody in Rail A (adaptive authDescriptor)

- **Status:** Accepted
- **Date:** 2026-06-19
- **Decision makers:** Juan José (design lead), xcale team
- **Tags:** integrations, auth, architecture, mcp

## Context

The strategic goal is for `xcale-mcp-server` to be the source of truth for integrations and for
`xcale-backend` to stay focused on business logic and consume capabilities generically. The
sharpest conclusion of the architecture review is that this requires separating two things that
Composio (and our current native integrations) conflate:

- **Provider *knowledge*** — how to authenticate, what tools exist, parameters, capabilities,
  error mapping, how to talk to the API.
- **Credential *custody*** — storing the encrypted token, refreshing it, driving reconnect.

Today, provider auth knowledge lives in the backend: Rail A's `registerOAuthProvider({ authBaseUrl,
tokenUrl, scopes, mapToken, ... })` is per-provider code in `xcale-backend`. That means adding a
provider edits the backend — violating the Provider Self-Containment principle. But moving
*custody* to the server (Composio parity) would mean a second service storing secrets, which is
more risk and violates soul.md.

The resolution must move *knowledge* without moving *custody*. The mechanism is an **adaptive,
non-secret `authDescriptor`** published by the server's catalog (`server/discover`), which Rail A
consumes to run auth flows **generically**.

## Decision

**Knowledge → server. Custody → Rail A.** Each provider declares a non-secret
`ProviderAuthDescriptor` in `src/providers/{slug}/auth.ts`, published via `server/discover`. The
descriptor is **adaptive — as rich as the auth type requires, never more**:

- `api_key` / `bearer`: `type` + field descriptors (`key`, `label`, `placement`).
- `oauth2`: `type`, `authorizationUrl`, `tokenUrl`, `scopes`, `tokenPlacement`, `supportsRefresh`.

**Secrets (`clientId`, `clientSecret`) are never part of the descriptor or the catalog** — they
stay in the backend's Doppler. Rail A becomes a *generic* OAuth/credential executor driven by the
descriptor; it keeps owning token storage, refresh, and reconnect (custody). The only per-provider
touch the backend retains is registering those secrets (generic config), which the
self-containment principle explicitly permits.

## Alternatives Considered

### Alternative A (rejected): Minimal descriptor (slug + schemaVersion only)
- **Pros:** Smallest contract surface to version.
- **Cons:** OAuth params (URLs/scopes) must then live in the backend per provider → backend grows
  per provider → violates Provider Self-Containment. The user's own reservation that "maybe slug
  + version suffices" contradicts the self-containment principle for any OAuth provider.
- **Why rejected:** it forecloses the strategic goal for OAuth providers.

### Alternative B (rejected): Always-full fixed descriptor
- **Pros:** Uniform shape across providers.
- **Cons:** Carries empty/irrelevant OAuth fields for `api_key` providers; more surface to
  version than necessary.
- **Why rejected:** rigidity without benefit; violates "minimal contract."

### Alternative C (rejected): Move token custody to the server (Composio parity)
- **Pros:** Fully self-contained provider including credentials.
- **Cons:** Two services storing secrets; DB + refresh workers; violates soul.md and the
  stateless inversion.
- **Why rejected:** more security/operational risk; out of scope for v1 (possible far-future
  endgame only).

### Alternative D (accepted): Adaptive non-secret descriptor + Rail A generic executor
- **Pros:** Moves knowledge to the server; backend stops growing per provider; custody stays in
  the hardened Rail A; minimal contract per auth type; secrets never leave Doppler.
- **Cons:** The descriptor is a contract to version (additive-only mitigates this).
- **Why accepted:** the only option that satisfies both the strategic goal and soul.md.

## Consequences

### Positive
- Adding an OAuth provider = adapter module in the server + two secrets in backend Doppler; no
  backend code. The self-containment metric holds.
- Migrating a native to MCP later moves its auth knowledge with it (the descriptor), not stranded
  in Rail A.

### Negative
- `authDescriptor` is part of the catalog contract and must evolve additively.
- Rail A must be refactored from per-provider config to a generic descriptor-driven executor (a
  backend change, done once — not per provider).

### Neutral
- The boundary is now explicit: backend knows *which credential it custodies* + *how to consume*;
  never *how a provider works technically*.

## References
- Architecture review: `docs/architecture-review.md` §0, §4.3, §5
- Foundation: `docs/foundation.md` §8, Q-10
- Related ADRs: [three-pillar-mcp-contract-with-discovery](0006-three-pillar-mcp-contract-with-discovery.md), [credential-forwarding-and-token-model](0003-credential-forwarding-and-token-model.md)
- Backend anchor (the per-provider config this replaces): Rail A `registerOAuthProvider(...)` in `xcale-backend` (`docs/architecture-guide.md`, "Native Connection Rail")
- External: Composio auth-config vs connected-account model
