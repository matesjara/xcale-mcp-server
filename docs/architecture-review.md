# xcale-mcp-server — Architecture Review (target architecture & rationale)

> **Status:** Accepted direction (one decision held open — credential forwarding, §7).
> **Date:** 2026-06-19
> **Type:** Durable reference. Captures the *why*: alternatives evaluated, trade-offs, and the
> agreed target architecture. ADRs are derived from this document, not the reverse.
> **Inputs:** `docs/foundation.md` (vision), the `/grill` session (2026-06-18), a
> multi-lens architectural investigation (5 independent research lines, §9), and team review.
> **Decision makers:** Juan José (design lead), in coordination with the xcale team.

This document is the answer to "why is the architecture shaped this way?" — read it before any
ADR. It is the bridge between the vision (`foundation.md`) and the decisions (`docs/adr/`).

---

## 0. Guiding principles

Every decision below serves two north-star principles.

### Principle #1 — Provider Self-Containment

> **Adding a new provider must require working almost exclusively inside
> `xcale-mcp-server/src/providers/{slug}/`.** The only permitted touch on `xcale-backend` is
> *generic configuration* (registering secrets / env vars) or *business policy* — **never
> provider-specific code.** If supporting a standard provider requires editing backend logic,
> the architecture is considered incomplete and must be refactored.

### Verifiable metric (how we know the principle holds)

| | |
|:--|:--|
| ✅ **Goal** | Adding a provider modifies only `xcale-mcp-server/src/providers/{slug}/` plus generic config (e.g. register `clientId`/`clientSecret` in Doppler). |
| 🚨 **Alarm signal** | Needing a `switch`, an `if`, a provider-specific `registerOAuthProvider(...)`, or any conditional logic in `xcale-backend` to support a *standard* provider. This must be justified by an **exceptional ADR** — it is a smell, not a default. |

This principle is the operational definition of the strategic goal: **xcale-backend stops
growing proportionally to the number of providers.** That is the behavior expected of a
"Composio LATAM."

### The provider-onboarding golden rule (PR-reviewable)

The metric above becomes an objective gate reviewers apply to **every provider PR**. For a
**standard provider**, a complete integration touches **only**:

- ✅ `src/providers/{slug}/` — descriptor, API client, tools, validations (zod), error mapping.
- ✅ Tests — unit + a conformance test (`tools/list`/`tools/call` round trip, incl. the
  auth-failure path).
- ✅ Generic config where applicable — secrets / env vars registered (e.g. in Doppler).

It MUST NOT, for a standard provider, touch:

- ❌ shared infrastructure (`src/core/**`, `src/protocol/**`, `src/auth/**`),
- ❌ public contracts (the three pillars, error codes, descriptor/context shapes),
- ❌ any consumer (e.g. xcale-backend) code.

If a PR must touch any of the above to support a *standard* provider, it requires an
**exceptional ADR** justifying why.

### Principle #2 — Consumer-Agnostic Reusability

xcale-backend is the **first** consumer, not the reason this server exists. Public contracts must
be reusable by **any** MCP-compatible backend, agent, or client:

> The server is told *which token* and *which tool* (+ opaque, provider-scoped routing metadata),
> **never** *which tenant*, *which plan*, or any consumer-domain concept. No business logic, no
> single-consumer assumptions, no xcale entities on the wire.

This is a **design constraint, not a v1 marketing goal**: v1 still serves only xcale (§5.2 of the
foundation — not a marketplace yet). It keeps the door to reuse open at near-zero cost and forces
clean, business-free contracts. See [consumer-agnostic-contract](adr/0002-consumer-agnostic-contract.md).

> **Litmus test (apply to every ADR and major review):** *Could a third party use
> xcale-mcp-server without knowing xcale-backend exists?* If "no", undue coupling was introduced —
> fix it or justify it with an ADR. This tests the principle conceptually, not just by class or
> endpoint names.

---

## 1. The problem & the strategic goal

xcale needs its own integration platform — a "Composio LATAM" — because Composio's catalog is
global-SaaS-centric and will never cover the LATAM apps (appointment systems, regional payment
gateways, local CRMs/accounting) xcale's customers use, and because native integrations today
live *inside* `xcale-backend`, mixing provider plumbing with business logic.

**Strategic goal — the durable split:**

- **`xcale-mcp-server` owns provider *knowledge*:** how to authenticate, what tools exist, how
  they're called, what parameters they take, what capabilities they have, how errors map, how to
  talk to the external API.
- **`xcale-backend` owns *consumption* and *custody*:** business logic, agents, authorization,
  domain rules, UX — plus credential custody (Rail A). It asks: "I need a connection with X",
  "I need to run this tool", "I need to reconnect this account." Nothing more.

The defining insight of the whole review: **separate provider *knowledge* (→ server) from
credential *custody* (→ Rail A).** Composio centralizes both, which is its lock-in and its
security liability. We centralize only knowledge — a better fit for our context, not a copy.

---

## 2. Architectures evaluated

Five independent research lines (§9) produced four named alternatives; **A+** is the synthesis.

| | **A — Thin stateless RPC** (initial grill) | **A+ — Stateless Gateway + Catalog** ⭐ | **B — Stateful platform w/ custody** | **C — Protocol-agnostic gateway** | **D — Manifest + codegen platform** |
|:--|:--|:--|:--|:--|:--|
| Contract | `tools/list` + `tools/call` | **+ `server/discover` (catalog)** | + connection-lifecycle API | typed RPC; MCP = one adapter | YAML manifests → generated adapters |
| Provider knowledge | ⚠️ split across repos | ✅ **in the server** | ✅ in server | ✅ in server | ✅ in manifest |
| Token custody | Rail A | **Rail A** | server (DB + refresh) | Rail A | Rail A |
| Onboarding | 2 repos, by hand | **server-driven; backend discovers** | 1 repo | 2 repos | 1 manifest |
| Stateless | ✅ | ✅ (catalog is static) | ❌ DB + workers | ✅ | ✅ |
| v1 cost | minimal | **low (+1 endpoint, +types)** | high | medium | high |
| soul.md fit | ✅ | ✅ | ❌ "no credential storage / no workers" | ⚠️ "don't abstract w/o 2nd case" | ⚠️ "prove with 2 before generalizing" |
| Strategic goal | ⚠️ ~70% | ✅ **~95%** | ✅ 100% | ✅ isolation | ✅ |

**Why A+, and why not the others:** B, C, D are valid *destinations, not starting points.*
- **B** (Composio parity) reaches 100% but requires the server to store & refresh credentials —
  two services holding secrets is *more* risk, not less, and it violates soul.md outright. It is
  the possible 18-month endgame **only if** migrating natives ever demands unified custody.
- **C** (transport-agnostic core) only pays off if MCP breaks badly enough that the adapter layer
  becomes non-trivial *or* a second consumer appears. Neither is true at one consumer — it's the
  premature abstraction the grill already rejected. The *thin ACL* (§4) is the proportionate
  subset of C we keep.
- **D** (codegen) needs ~5 real providers to validate the manifest schema before freezing it;
  freezing on providers #1–2 turns the manifest into a constraint. We adopt its cheap seam
  (manifest-as-documentation) now; codegen is deferred to phase 5.

**A+ achieves ~95% of the strategic goal at the cost of A**, without becoming a heavyweight
stateful platform.

---

## 3. Decision: build A+

A stateless MCP **gateway** (control-plane-lite) that fronts self-contained per-provider
adapters and **publishes a capability catalog** the backend discovers. Four low-cost upgrades
over the initial grill design close the strategic gap:

1. **Third contract pillar — `server/discover`** (catalog: providers + auth descriptor + context
   schema + health + schema version).
2. **Adaptive `authDescriptor`** published by the catalog (non-secret), making Rail A a *generic*
   OAuth executor — no per-provider backend code.
3. **Typed contracts:** discriminated-union tool result + closed error code set; declared,
   discoverable per-provider context schema.
4. **Scale seams reserved (not built):** a `tools/list` filter param for future tool-search; a
   schema-version signal for cache invalidation; per-provider manifest + CI conformance gates.

Everything the grill validated is **kept**: thin ACL, stateless Streamable HTTP, single gateway,
explicit registry, TypeScript + Fastify + MCP SDK + zod + pino + Vitest. (The MCP 2026-07-28
release candidate, which removes protocol sessions, *retroactively validates* the stateless
choice.)

---

## 4. Target architecture

### 4.1 The three contract pillars

| Pillar | Method | Purpose | Auth required |
|:--|:--|:--|:--|
| **Discover** | `server/discover` | Publish the capability catalog: providers, adaptive `authDescriptor`, `contextSchema`, `toolCount`, health, `schemaVersion`. The backend consumes this to register providers generically. | Hop B only (**no** `X-Provider-Token`) |
| **List** | `tools/list` (+ optional `?category=` filter, `ttlMs`/`cacheScope` hints) | Tool schemas for a provider. | Hop B |
| **Call** | `tools/call` | Execute one tool with args + forwarded credential. | Hop B + `X-Provider-Token` |

### 4.2 Module layout

```
xcale-mcp-server/
├── src/
│   ├── protocol/              ◀── ONLY place that imports @modelcontextprotocol/sdk (the thin ACL)
│   │   ├── mcp-handler.ts         tools/list + tools/call  (MCP wire ↔ domain types)
│   │   └── discover-handler.ts    server/discover (catalog)
│   ├── auth/
│   │   ├── hop-b.ts               verifyHopB(): single isolated point (shared secret today)
│   │   └── token.ts               extract X-Provider-Token; never persisted/logged
│   ├── core/
│   │   ├── provider-port.ts       IProvider + ProviderAuthDescriptor + ProviderCallContext
│   │   ├── registry.ts            explicit list; Map<slug> + Map<toolName>
│   │   ├── catalog.ts             Registry → CatalogEntry[] (+ health)
│   │   └── types.ts               ToolResult (discriminated union) · ProviderErrorCode (as const)
│   └── providers/{slug}/          ◀── a provider = one self-contained module (principle #0)
│       ├── manifest.ts            slug, displayName, category, schemaVersion, metadataSchema (zod)
│       ├── auth.ts                ProviderAuthDescriptor (non-secret)
│       ├── provider.ts            implements IProvider
│       ├── client.ts · tools/*.ts · errors.ts
│       └── __fixtures__/ · __tests__/conformance.test.ts
└── docs/{design,adr}/
```

**Boundary rules:** `src/providers/**` never imports the MCP SDK and never imports another
provider. `src/protocol/**` reaches providers only through `IProvider`.

### 4.3 Typed contracts (the shapes that matter)

```typescript
// Adaptive auth descriptor — non-secret, as rich as the auth type requires.
// Secrets (clientId/clientSecret) NEVER appear here; they live in the backend's Doppler.
type ProviderAuthDescriptor =
  | { type: 'api_key' | 'bearer';
      fields: Array<{ key: string; label: string; placement: 'header' | 'query' }> }
  | { type: 'oauth2';
      authorizationUrl: string; tokenUrl: string; scopes: string[];
      tokenPlacement: 'bearer_header' | 'custom_header'; supportsRefresh: boolean };

interface ProviderCallContext {
  readonly token: string;                       // decrypted per call; never persisted/logged
  readonly metadata?: Record<string, unknown>;  // validated by the provider's declared metadataSchema
}

// Discriminated union — compile-time exhaustiveness on both sides of the boundary.
type ToolResult =
  | { kind: 'success'; toolName: string; providerSlug: string; data: unknown; message?: string }
  | { kind: 'error'; code: ProviderErrorCode; toolName: string; providerSlug: string; message: string };

const ProviderErrorCode = {
  AUTH_EXPIRED: 'PROVIDER_AUTH_EXPIRED',        // backend → markConnectionAuthFailure() → reconnect
  RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  INVALID_INPUT: 'PROVIDER_INVALID_INPUT',
  UNKNOWN_TOOL: 'PROVIDER_UNKNOWN_TOOL',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const;                                      // closed set; evolves additively only
```

**Reserved for provider lifecycle (modeled now, not enforced in v1).** Each provider's
`manifest.ts` / `CatalogEntry` reserves space for lifecycle so an integration can evolve without
breaking consumers — populated/enforced only when the first deprecation actually happens:

```typescript
interface ProviderLifecycle {
  providerVersion: string;   // the adapter's own version (semver) — bumped on adapter changes
  apiVersion?: string;       // the upstream provider API version this adapter targets
  deprecated?: boolean;      // true → consumers should migrate; still callable
  sunsetDate?: string;       // ISO date after which the provider/tool may stop working
}
```

These travel in `server/discover` so consumers can surface deprecation/sunset to operators. v1
ships `providerVersion` only (alongside `schemaVersion`); the rest are reserved fields, documented
so the model has room to grow. See [additive-contract-versioning](adr/0001-additive-contract-versioning.md).

**Reserved for optional capabilities (modeled now, not implemented).** v1 providers are simple
synchronous request/response. To keep the model from being *locked* into that shape, a provider may
later **declare** what it supports, so consumers adapt without a contract break:

```typescript
interface ProviderCapabilities {   // all optional; absent = not supported (v1 default)
  streaming?: boolean;       // streamed tool results
  longRunning?: boolean;     // async / long-running operations
  webhooks?: boolean;        // provider push events
  polling?: boolean;         // consumer-driven polling
  files?: boolean;           // file inputs / outputs
  pagination?: boolean;      // paginated list tools
  autoRefresh?: boolean;     // adapter refreshes its own short-lived creds
}
```

Declared via `server/discover`. **Reserved, not built** — implement a capability only when a real
provider needs it (*complexity on demand*).

---

## 5. Responsibility split (backend vs server)

| Responsibility | Owner | Migrating? |
|:--|:--|:--|
| Business rules, agents, authorization, Tool Basket, UX | **backend** | — |
| Credential custody (encrypt-at-rest, refresh, reconnect) | **Rail A (backend)** | — (deliberate security inversion) |
| Provider auth *knowledge* (URLs, scopes, token placement) | **server** (`authDescriptor`, discovered) | ⬅ moves out of backend |
| Provider catalog/metadata (displayName, category, health) | **server** (`server/discover`) | ⬅ moves out of backend |
| Context/metadata schema (accountKey, storeDomain) | **server** (declared per adapter) | ⬅ moves out of backend |
| Provider API client, tool execution, error normalization | **server** | ⬅ natives migrate gradually (§16 foundation) |
| Per-user curation policy / token budget | **backend** | — |
| Tool-search / filter mechanism over the catalog | **server** (seam reserved) | new |
| `tools/list` cache | **backend** (`ttlMs` + `schemaVersion` keyed) | — |

**Resulting rule of thumb:** the backend knows *which credential it custodies* and *how to
consume capabilities*; it never knows *how a provider works technically*. The only irreducible
backend touch per OAuth provider is two secrets in Doppler (generic config, permitted by
principle #0). For an `api_key` provider, even that shrinks to near-nothing.

---

## 6. Industry patterns — adopt / adapt / reject

| Pattern | Source | Verdict |
|:--|:--|:--|
| Control plane = catalog/discovery separate from execution | Composio Tool Router, Kong, Tyk, MCP `server/discover` | ✅ adopt (pillar 3) |
| Auth-config (blueprint) ≠ connected-account (credential) | Composio, Nango, Paragon, Arcade | ✅ adapt (descriptor in server, custody in Rail A) |
| Typed error taxonomy (discriminated union) | RFC 9457, gRPC status subset | ✅ adopt |
| Declared, discoverable context schema | Nango descriptors, Arcade | ✅ adopt |
| Tool search / RAG over catalog | RAG-MCP (arXiv 2505.03275), Composio | 🟡 reserve seam, don't build |
| Codegen from OpenAPI | Nango, Speakeasy, Neon | 🟡 defer; manifest-as-doc now |
| Manifest + CI conformance gates | Nango / Composio monorepo | ✅ adopt (cheap) |
| `server/discover` + `ttlMs`/`cacheScope` | MCP 2026-07-28 RC | ✅ adopt (additive) |
| Gateway federation / multi-cluster / RBAC engine | ContextForge, Kong enterprise | ❌ reject (we author upstreams, don't aggregate) |
| Server-side token custody / connections DB | Composio (Arch B) | ❌ reject v1 (security inversion) |
| Push `notifications/tools/list_changed` | MCP | ❌ reject (incompatible with stateless HTTP) |
| DDD tactical (entities/aggregates) | — | ❌ reject (translation layer, not rich domain) |

---

## 7. Risks & the one open decision

**Scope-bounded decision — credential forwarding (Accepted, with a constraint).** Forwarding the real provider
token as `X-Provider-Token` means the server process *sees* sensitive credentials, and the
"discard immediately" guarantee is not mechanically enforceable. The MCP security guidance flags
token passthrough as an anti-pattern (primarily aimed at identity tokens with wrong audience;
ours is deliberate credential delegation — related but not identical). **This boundary will not
be consolidated without review** — that review is now done (`security/credential-boundary-review.md`)
and found **no architectural blockers**, so the decision is **Accepted**; what is bounded is its
*scope*: **MVP = direct forwarding with mandatory safeguards** (the `SecretString` credential
firewall, enforced pino redaction of `x-provider-token` + `authorization`, no request-body logging,
TLS-only, token never in error messages), plus a **hard constraint** to move to **ephemeral
references / token exchange (RFC 8693)** before the first financial provider (ePayco/Siigo). See
[credential-forwarding-and-token-model](adr/0003-credential-forwarding-and-token-model.md).

**Other tracked risks:** catalog/descriptor adds a contract surface to version carefully
(mitigated by additive-only versioning + `schemaVersion`); author-time curation needs CI
enforcement as the team grows; opaque metadata mitigated by per-provider declared `metadataSchema`.

---

## 8. ADR index (derived from this review)

| ADR (slug) | Status | What it locks |
|:--|:--|:--|
| [credential-forwarding-and-token-model](adr/0003-credential-forwarding-and-token-model.md) | ✅ **Accepted** (scope-bounded) | Token model; constraint: ephemeral refs before financial providers |
| [three-pillar-mcp-contract-with-discovery](adr/0006-three-pillar-mcp-contract-with-discovery.md) | Accepted | `server/discover` as pillar 3 |
| [provider-knowledge-vs-credential-custody](adr/0004-provider-knowledge-vs-credential-custody.md) | Accepted | The split + adaptive `authDescriptor` |
| [stateless-gateway-and-thin-acl](adr/0005-stateless-gateway-and-thin-acl.md) | Accepted | Stateless Streamable HTTP, single gateway, thin ACL |
| [typed-tool-result-error-contract](adr/0007-typed-tool-result-error-contract.md) | Accepted | Discriminated-union result + closed error codes |
| [additive-contract-versioning](adr/0001-additive-contract-versioning.md) | Accepted | Additive evolution + `schemaVersion` + provider lifecycle |
| [consumer-agnostic-contract](adr/0002-consumer-agnostic-contract.md) | Accepted | Public contract reusable beyond xcale (principle #2) |

(ADRs are created unnumbered per house convention; numbers are minted at merge against `dev`.)
Canonical living index + the ADR policy: [`adr/README.md`](adr/README.md).

---

## 9. Research provenance

Five independent research lines informed this review (full reports in the session transcript):

1. **Composio & commercial platforms** (Composio, Nango, Paragon, Pipedream, Arcade, WorkOS) —
   auth-config vs connected-account; dynamic catalogs; onboarding mechanization.
2. **MCP gateways & control planes** (Kong, Tyk, ContextForge, MCP 2026 RC) — control-plane
   responsibilities; `server/discover`; protocol versioning.
3. **Scaling to N providers** (RAG-MCP, MS Research, codegen tooling) — tool-search seam;
   monorepo isolation; fixture-based contract testing; conformance CI gates.
4. **Internal architecture** (hexagonal/ACL, plugin systems, DDD, RFC 9457, gRPC status) —
   thin-ACL depth; typed error/context contracts; additive versioning.
5. **Red-team** — token passthrough challenge; alternative architectures B/C/D; the
   most-likely-to-be-regretted decisions.

**Key external sources:** modelcontextprotocol.io (versioning, 2026-07-28 RC), Composio docs
(connected accounts, tool router, toolkit versioning), Nango (secure agent auth), RAG-MCP
(arXiv 2505.03275), RFC 9457 (problem details), RFC 8693 (token exchange), Solo.io / MCP security
best-practices (token passthrough).

---

## 10. The validation experiment (Phase 2–3 success criteria)

The real exam of this architecture is not more design — it is whether the first two providers pass
through the system without bending it. Phase 2–3 (skeleton + first `api_key` provider + first
`oauth2` provider) is a **deliberate experiment**, considered **successful only if ALL hold**:

1. Each provider is implemented **almost entirely within `src/providers/{slug}/`**.
2. Adding it required **no change to the public protocol or the catalog**.
3. Adding it required **no provider-specific logic in any consumer** (e.g. xcale-backend).
4. **No `switch`, `if`, or per-provider registration** appeared in shared infrastructure
   (`src/core/**`, `src/protocol/**`, `src/auth/**`).
5. Automated tests validate the **descriptor, tools, and contract** with **no manual exceptions**.

**If any criterion fails, do not patch it.** Treat the failure as a signal to **revisit the
architecture before adding more providers** — a bent boundary on provider #2 becomes an
unmaintainable one on provider #20. This is the architecture's true test: it must absorb real
change without losing coherence.
