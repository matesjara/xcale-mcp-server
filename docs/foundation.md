# xcale-mcp-server — Foundation Document ("Composio LATAM")

> **Status:** Foundational / pre-implementation. This is the founding pillar for the
> architectural design and development of the system. No runtime code exists yet.
> **Type:** Vision + architecture seed + first functional requirements.
> **Owner:** Juan José (design lead) · in coordination with the xcale team (Mateo, founder).
> **Created:** 2026-06-18
> **Primary source of intent:** `xcale-backend/docs/design/native-toolbox-platform/mcp-plugin-vision.md`
> **Companion design:** `xcale-backend/docs/design/native-toolbox-platform/toolbox-definition-rail-e/feature-design.md` (defines the `MCPToolboxDefinition` stub this project will fulfill).

This document is intentionally exhaustive. It captures **everything known today** about
the new system so that any contributor (human or AI agent) can start designing and building
without re-reading the entire xcale-backend codebase. When in doubt, this file is the
single source of truth for *intent*; the linked xcale-backend docs are the source of truth
for *the consuming side*.

> **Decision layer (read these for the *how* and the *why-this-way*):** this file holds vision
> and principles. The architecture that was chosen, the alternatives weighed, and the trade-offs
> live in **`docs/architecture-review.md`**; the durable decisions live in
> **`docs/adr/`**. When a decision below is marked resolved, follow those links rather than
> expecting the detail here.

---

## Table of contents

1. [The one-paragraph pitch](#1-the-one-paragraph-pitch)
2. [Why this exists (the problem)](#2-why-this-exists-the-problem)
3. [Reference model: how Composio works inside xcale today](#3-reference-model-how-composio-works-inside-xcale-today)
4. [The vision: a "Composio LATAM" that xcale owns](#4-the-vision-a-composio-latam-that-xcale-owns)
5. [Objectives & non-goals](#5-objectives--non-goals)
6. [System architecture](#6-system-architecture)
7. [The MCP protocol boundary (the contract)](#7-the-mcp-protocol-boundary-the-contract)
8. [Authentication & token model (stateless auth)](#8-authentication--token-model-stateless-auth)
9. [Mechanical provider onboarding — the core value](#9-mechanical-provider-onboarding--the-core-value)
10. [How xcale-backend consumes this server](#10-how-xcale-backend-consumes-this-server)
11. [SOLID principles & design patterns applied](#11-solid-principles--design-patterns-applied)
12. [Open design questions (must resolve before/with build)](#12-open-design-questions-must-resolve-beforewith-build)
13. [First functional requirements (FR-1 … FR-n)](#13-first-functional-requirements)
14. [Non-functional requirements](#14-non-functional-requirements)
15. [Roadmap & phasing](#15-roadmap--phasing)
16. [The long-term endgame: xcale-backend as a pure consumer](#16-the-long-term-endgame)
17. [Glossary](#17-glossary)
18. [References](#18-references)

---

## 1. The one-paragraph pitch

xcale builds and maintains its **own MCP server in a separate repository** — effectively a
**"Composio LATAM"** designed and owned by the xcale team. That server centralizes
integrations with the platforms LATAM businesses actually use (appointment systems, regional
payment gateways, local CRMs, accounting platforms), handles their authentication and
connectivity, and exposes their capabilities as **tools** over the **MCP protocol
(JSON-RPC 2.0)**. The xcale backend consumes that server as an **MCP client** — the same way
agents today consume Composio tools, but over a protocol xcale controls and a server xcale
owns. The system is designed so that adding a *new provider* is a **mechanical, repeatable
operation** (write a thin adapter, declare its tools, register it) rather than a bespoke
project each time — exactly the leverage Composio gives the global SaaS world, brought
in-house for LATAM and for any provider Composio will never cover.

---

## 2. Why this exists (the problem)

Two structural problems in xcale today motivate this system.

### 2.1 Composio's catalog is global-SaaS-centric

LATAM is xcale's focus, and Composio's catalog won't prioritize the apps LATAM users actually
need. For many of them there is **no Composio plugin at all** — native integration is the
*only* option (xcale-backend ADR-0004, criterion 5). Composio is external: xcale cannot fix
its bugs, cannot add providers to it, and cannot control its roadmap, auth model, latency, or
cost.

### 2.2 Native integrations are copy-paste, not a platform

Inside xcale-backend, every native integration today is replicated boilerplate. The
"Native Toolbox Platform" initiative (Rails A–E) has spent multiple phases turning that
copy-paste into **proportionate shared rails**:

| Rail | What it standardizes | Status (per xcale-backend roadmap) |
|:--|:--|:--|
| **A** | Connection / OAuth / re-auth lifecycle (encrypted token storage, Mongo OAuth state, refresh, reconnect) | ✅ shipped to prod |
| **B** | `ingestContent` → vector index (Voyage `voyage-3`, 1024-dim) | 🟢 built on branch |
| **C** | Inbound events / webhooks (shared HMAC verifier, native triggers) | 🟢 built on branch |
| **D** | Registration registry (`statusResolver` per integration, no central switch) | 🟢 built on branch |
| **E** | `ToolboxDefinition` discriminated union + `registerAllToolboxes()`; **defines the `source: 'mcp'` stub this project fills** | 🟢 built on branch |

Rail E is the hinge. It already declares a `MCPToolboxDefinition` type with
`source: 'mcp'` and throws `'MCP toolbox runtime not implemented (KD-1): {id}'` for any
MCP-sourced entry. **This project (`xcale-mcp-server`) plus the xcale-backend MCP client
runtime are what turn that throw into a real capability.**

### 2.3 The deeper goal

Even where native integrations are now well-factored, they still live *inside* xcale-backend,
mixing provider plumbing (auth quirks, API clients, error normalization) with xcale's actual
business logic. The long-term goal (see §16) is to **extract all of that provider plumbing
out of xcale-backend** into this MCP server, so the backend becomes a thin consumer focused
only on business rules.

---

## 3. Reference model: how Composio works inside xcale today

Composio is the **reference architecture** for this project. Understanding precisely how it
plugs into xcale tells us what "good" looks like and what the MCP server must replicate (and
improve). Source: `xcale-backend/src/modules/composio/README.md`.

### 3.1 Core mechanism — the Adapter pattern

Composio integrates as a **parallel, additive system** alongside native tools, with **zero**
refactoring of existing code:

- `src/modules/composio/` owns the SDK lifecycle, OAuth flows, and plugin management.
- A **`ComposioToolExecutor`** adapter wraps each Composio tool as an `IToolExecutor` — the
  same interface native tools implement. This is the keystone: polymorphism means the agent's
  `ToolExecutionService` doesn't know or care whether a tool is native or Composio-backed.
- At agent startup, a **`ComposioToolLoader`** dynamically registers the user's connected
  plugins' tools into the shared `ToolRegistry`, alongside native tools.
- Execution routes through the same `ToolExecutionService`; the adapter simply delegates to
  `composio.tools.execute()`.

```
            ToolRegistry.getExecutor(name)
                       │
          ┌────────────┴────────────┐
          │                         │
Native IToolExecutor       ComposioToolExecutor   ◀── adapter wraps an external call
(WordPressCreatePost,      (delegates to
 WebSearch, …)              composio.tools.execute())
```

### 3.2 Key facts to carry forward

| Composio behavior | What the MCP server must replicate / replace |
|:--|:--|
| Tools are **dynamic & user-specific** — different users have different plugins connected | MCP `tools/list` is queried per connected provider; tools materialize into the user's Tool Basket |
| Tool names are **prefixed** (`composio_gmail_send_email`) to avoid collisions | MCP tools get an analogous namespacing (e.g. `mcp_{provider}_{tool}`) |
| `userId` = Composio entity_id (direct mapping, no translation table) | xcale `userId` keys the connection; the MCP server is told *which token*, not *which user* |
| Composio **stores and manages tokens** | **Inverted:** xcale's Rail A stores tokens; the MCP server is **stateless** and receives the decrypted token per call (see §8) |
| Result wrapped into `StandardToolResult` with an optional `ui` component | MCP `tools/call` results are normalized into the same `StandardToolResult` envelope by the client adapter |
| **Curation**: high-tool-count plugins (Shopify 490, Trello 344) ship a curated subset to protect tool-selection accuracy and token budget | The MCP server should expose curation metadata or the client should curate `tools/list` output the same way |

### 3.3 Where Composio falls short for LATAM (the gap this project closes)

- No coverage of LATAM-specific providers (regional CRMs, ePayco/PSE-style gateways, Siigo,
  appointment platforms like Nevatal).
- No control over auth model — Composio holds the tokens; xcale cannot guarantee its
  multi-tenant isolation or re-auth UX.
- External dependency for cost, latency, and roadmap.

**Net:** Composio is the proven *shape* (adapter + dynamic registration + per-user tools).
The MCP server keeps that shape but flips ownership and auth, and standardizes the transport
on the open MCP protocol instead of a vendor SDK.

---

## 4. The vision: a "Composio LATAM" that xcale owns

```
┌──────────────────────────────────┐        ┌──────────────────────────────────────┐
│  xcale-backend  (consumer)        │        │  xcale-mcp-server  (THIS repo)        │
│                                   │        │                                      │
│  MCP Client                       │──────▶│  LATAM + custom integrations          │
│  · tools/list → tool schemas      │        │  · Nevatal, ePayco, Siigo, local CRMs │
│  · tools/call → tool results      │◀──────│  · Auth handled per-provider          │
│                                   │        │  · Connectivity, retry, normalization │
│  Rail A owns token storage        │        │  · Exposes tools via MCP protocol     │
│  · decrypted token forwarded      │──────▶│  · STATELESS — receives token,        │
│    per call as a request header   │        │    uses it, discards it               │
│  · only business logic lives here │        │  · no xcale domain logic lives here   │
└──────────────────────────────────┘        └──────────────────────────────────────┘
                                  MCP protocol (JSON-RPC 2.0)
                                  transport: Streamable HTTP
```

### 4.1 Why a separate repository

- **Independent deployability** — updated, scaled, and deployed without touching xcale-backend.
- **Focused scope** — one job: adapt providers to the MCP protocol. No xcale domain logic
  (no MongoDB tenant model, no agent session state, no business rules) lives here.
- **Protocol boundary is the contract** — `tools/list` and `tools/call` are the only
  interface; the server can evolve internally without breaking the backend client.
- **Reusability** — any MCP-compliant client (not just xcale) could consume the same server.

### 4.2 Composio vs xcale-mcp-server

| | Composio | xcale-mcp-server |
|:--|:--|:--|
| Who builds it | Composio (third party) | xcale team |
| Provider coverage | Global SaaS | LATAM-specific + any custom/uncovered provider |
| Control | External — can't fix bugs or add providers | Full — xcale owns the roadmap |
| Auth model | Composio stores/manages tokens | Rail A stores tokens; xcale forwards decrypted token per call |
| Integration cost | Free for covered apps | xcale builds each integration (mechanically) |
| Protocol | Composio's own SDK/API | **MCP (JSON-RPC 2.0)** — open standard |
| State | Stateful (holds connections) | **Stateless** w.r.t. auth |

---

## 5. Objectives & non-goals

### 5.1 Objectives

1. **Standardize provider→platform communication** the way Composio does: one protocol
   (MCP), one tool schema shape, one result envelope — regardless of the underlying provider.
2. **Make provider onboarding mechanical** — adding a provider is "write a thin adapter +
   declare tools + register", not a bespoke engineering project. Target: a new provider in
   well under a day, by a contributor following a single recipe (§9).
3. **Own LATAM coverage** — integrations Composio will never prioritize, plus any custom
   internal integrations xcale needs.
4. **Keep the server stateless and security-first** — it never stores credentials; it
   receives a decrypted token, uses it, and discards it.
5. **Be a drop-in for the existing agent tool surface** — tools surfaced through MCP must be
   indistinguishable, to the agent, from native or Composio tools (same `IToolExecutor`
   contract, same `StandardToolResult`).
6. **Apply SOLID + industry design patterns** so the codebase scales to dozens of providers
   without becoming a ball of mud (§11).

### 5.2 Non-goals (explicitly out of scope for the server)

- **No xcale business logic.** Pricing, plans, tenant rules, agent orchestration, conversation
  state — none of it lives here. The server adapts providers; the backend decides.
- **No credential storage.** Token lifecycle (storage, refresh, re-auth) stays in Rail A.
- **No multi-tenant data model.** The server is told *which token* to use, not *which tenant*.
- **Not a general MCP marketplace (yet).** v1 targets xcale's own provider needs; broad
  third-party reuse is a possible future, not a v1 requirement. **But** the contract is designed
  **consumer-agnostic from day one** (principle #2 / `docs/adr/0002-consumer-agnostic-contract.md`), so
  reuse stays open at near-zero cost — "not a marketplace yet" is about scope, not about coupling.

---

## 6. System architecture

### 6.1 High-level shape

The server is, at its core, an **MCP server** (JSON-RPC 2.0 over Streamable HTTP) that fronts
a set of **provider adapters**. Each provider adapter is a thin, self-contained module that:

1. **Defines its tools** (`name`, `description`, `inputSchema`, per the MCP spec).
2. **Implements tool execution** — calls the provider API using the forwarded token.
3. **Normalizes errors** into a consistent shape (including a signal for expired tokens →
   so the backend's Rail A can trigger re-auth).

```
xcale-mcp-server/
├── src/
│   ├── server.ts              ← MCP server entrypoint (tools/list + tools/call handlers)
│   ├── protocol/              ← MCP JSON-RPC 2.0 request/response handling, transport
│   ├── auth/
│   │   └── token.ts           ← extract & validate the forwarded token from the request header
│   ├── core/
│   │   ├── provider.ts        ← IProvider / IToolHandler interfaces (the contract every provider implements)
│   │   ├── registry.ts        ← ProviderRegistry — explicit list, no auto-discovery
│   │   └── result.ts          ← normalized tool-result + error shapes (incl. 401/expired signal)
│   └── providers/
│       ├── nevatal/           ← Nevatal API client + tool definitions
│       ├── epayco/            ← ePayco payment gateway
│       ├── siigo/             ← Colombian accounting platform
│       └── {next-provider}/
├── docs/
│   ├── foundation.md          ← THIS document (vision & principles)
│   ├── architecture-review.md ← target architecture & rationale
│   ├── adr/                   ← durable decisions
│   ├── security/              ← security reviews
│   └── onboarding.md          ← how to add a provider
└── .claude/                   ← agent rules, skills, agents, commands for this repo
```

> The `src/` tree above is a **proposed** starting structure, not yet built. It mirrors the
> "thin adapter per provider" shape described in the vision doc and is the seed for the first
> implementation plan.

### 6.2 Request lifecycle (happy path)

```
1. xcale-backend (MCP client) → POST /mcp  { jsonrpc, method: "tools/call",
                                             params: { name, arguments },
                                             header: X-Provider-Token: <decrypted> }
2. protocol/      parses & validates JSON-RPC envelope
3. auth/token.ts  extracts the forwarded token (does NOT persist it)
4. core/registry  resolves the provider + tool handler by tool name
5. provider/{p}   calls the provider API with the token, normalizes the result
6. core/result    wraps success → JSON-RPC result; or maps 401 → "reconnect required" signal
7. response → xcale-backend, which maps it into StandardToolResult for the agent
```

### 6.3 Design tenets (carried from xcale's `soul.md`)

- **Provider Self-Containment (principle #1).** Adding a provider must mean working almost
  exclusively in `src/providers/{slug}/`. The only permitted touch on xcale-backend is *generic
  config* (registering secrets/env vars) or *business policy* — never provider-specific code. If
  supporting a standard provider needs backend logic (a `switch`, an `if`, a per-provider
  `registerOAuthProvider`), the architecture is incomplete and must be refactored (justify any
  exception with an ADR). This is the operational definition of the strategic goal — see
  `docs/architecture-review.md` §0.
- **Consumer-Agnostic Reusability (principle #2).** xcale-backend is the *first* consumer, not the
  reason this server exists. Public contracts carry no consumer-specific concepts (no xcale
  entities, tenant ids, plan/business terms) — only *which token* and *which tool*. A design
  constraint (keeps reuse open at near-zero cost), not a v1 marketplace goal. See
  `docs/adr/0002-consumer-agnostic-contract.md`.
- **Proportionate, no framework magic.** No decorators / reflection / auto-discovery. The
  provider registry is an **explicit list** — missing a provider is one missing line,
  grep-able and auditable. (Mirrors Rail D/E's rejection of auto-discovery.)
- **Prove, don't pre-abstract.** Every abstraction is built against a real provider. The
  first 1–2 providers (likely Nevatal + ePayco) prove the shape before generalizing.
- **Security & correctness first.** Stateless auth, no swallowed errors, explicit
  expired-token signalling.

---

## 7. The MCP protocol boundary (the contract)

The **only** interface between xcale-backend and this server is the MCP protocol. Everything
else is an internal implementation detail of one side or the other.

> **Update:** the contract is now **three pillars** — `server/discover` (capability catalog) was
> added alongside the two methods below. See `docs/adr/0006-three-pillar-mcp-contract-with-discovery.md`
> and `docs/architecture-review.md` §4.1.

### 7.1 The two methods that matter for v1

| MCP method | Direction | Purpose |
|:--|:--|:--|
| `tools/list` | backend → server | Discover the tools a provider exposes (name, description, JSON-Schema input). Materialized into the user's Tool Basket. |
| `tools/call` | backend → server | Execute one tool with arguments + the forwarded token. Returns a normalized result. |

- **Transport:** Streamable HTTP (per the MCP spec) — chosen for simple request/response and
  future streaming results.
- **Envelope:** JSON-RPC 2.0. Standard `result` / `error` objects.
- **Tool schema:** each tool declares `name`, `description`, and `inputSchema` (JSON Schema).
  This maps cleanly to xcale's `ToolDefinition` (the same shape Composio's loader already
  converts from — see §3).

### 7.2 Why the protocol boundary is load-bearing

Because the contract is *only* `tools/list` + `tools/call`, the server can add providers,
refactor adapters, change its internal structure, or even change language/runtime, and the
backend client never changes. This is the same decoupling Composio's SDK gives, but on an
open standard xcale controls.

---

## 8. Authentication & token model (stateless auth)

This is the single most important architectural inversion versus Composio, and the security
backbone of the system.

### 8.1 The model

1. **Rail A (xcale-backend) owns the credential.** When a user connects an MCP-backed
   provider, Rail A runs the OAuth/credential flow and stores the token **encrypted at rest**,
   exactly as for any native provider. The MCP server is *not* involved in storage.
2. **Per-call token forwarding.** When an agent calls a tool, xcale-backend decrypts the Rail A
   token and forwards it to the MCP server **as a request header**, per call.
3. **The server is stateless w.r.t. auth.** It receives the token, uses it to call the
   provider API, and **discards it**. It never persists, caches, or logs the raw token.
4. **Expired-token signalling.** When a provider returns 401/403, the server returns a typed
   "auth failure / reconnect required" result so xcale-backend can call
   `markConnectionAuthFailure()` and surface a reconnect prompt — mirroring Rail A's reactive
   re-auth for native providers.

### 8.2 Two distinct auth hops (do not conflate)

| Hop | Who authenticates to whom | Mechanism (to be decided — §12) |
|:--|:--|:--|
| **A. provider auth** | the forwarded user token → the LATAM provider API | provider's own scheme (OAuth bearer, API key, etc.) — carried in a request header |
| **B. server auth** | xcale-backend → xcale-mcp-server | how the backend proves it's allowed to call the server (shared secret? mTLS? — **open question Q-5**) |

Keeping these two hops separate is essential: hop A is per-user-connection data; hop B is
infrastructure trust between two xcale services.

---

## 9. Mechanical provider onboarding — the core value

The reason this system exists is **leverage**: turning "integrate a provider" from a project
into a procedure. Composio gives the global SaaS world this leverage; we build it for LATAM.

### 9.1 The thin-adapter contract

Every provider implements the same small interface (names illustrative — to be finalized in
the implementation plan):

```typescript
// src/core/provider.ts
export interface IProvider {
  /** stable provider slug, e.g. 'nevatal' — must match the backend's MCPToolboxDefinition.id */
  readonly slug: string;
  /** MCP tool definitions this provider exposes (name, description, inputSchema) */
  listTools(): McpToolDefinition[];
  /** execute one tool by name, using the forwarded token; returns a normalized result */
  callTool(toolName: string, args: Record<string, unknown>, ctx: ProviderCallContext): Promise<NormalizedResult>;
}

export interface ProviderCallContext {
  /** decrypted provider token, forwarded per call from Rail A — never persisted */
  token: string;
  /** optional provider-scoped metadata forwarded by the backend (e.g. accountKey, storeId) */
  metadata?: Record<string, unknown>;
}
```

### 9.2 The onboarding recipe (target: mechanical)

1. **Create** `src/providers/{slug}/` with an API client + tool definitions.
2. **Implement** `IProvider`: declare tools (`listTools`) and their execution (`callTool`).
3. **Normalize** provider errors (map auth failures → the typed reconnect signal).
4. **Register** the provider in the explicit `ProviderRegistry` list (one line).
5. **(Backend side)** add an `MCPToolboxDefinition` entry pointing at this server's
   `mcpServerUrl` and the provider slug; Rail A handles the connection.

This recipe is captured as a repeatable Claude skill at
`.claude/skills/add-provider/SKILL.md` and (optionally) a scaffold command at
`.claude/commands/scaffold-provider.md`.

### 9.3 Constraints that keep it mechanical

- **No domain logic in adapters.** An adapter only translates between MCP and the provider
  API. If you find yourself writing xcale business rules, it belongs in the backend, not here.
- **No shared mutable state between providers.** Each adapter is isolated; one provider's
  failure cannot corrupt another's.
- **Explicit registration.** New providers are added to a flat list, never auto-discovered.

---

## 10. How xcale-backend consumes this server

The consuming side is already half-specified by Rail E. This section anchors what the backend
will do so the server design stays compatible.

### 10.1 The `MCPToolboxDefinition` (already stubbed in Rail E)

```typescript
// xcale-backend: src/modules/toolboxes/entities.ts (Rail E)
export interface MCPToolboxDefinition {
  source: 'mcp';            // stable discriminant
  id: string;               // provider slug — must match IProvider.slug here
  displayName: string;
  description: string;
  icon: string;
  logoUrl?: string;
  category: ToolboxCategory;
  features: string[];
  mcpServerUrl: string;     // points to an xcale-mcp-server endpoint
  connection?: OAuthConnectionConfig | CredentialConnectionConfig; // Rail A handles auth
}
```

Today, `registerAllToolboxes()` throws `'MCP toolbox runtime not implemented (KD-1): {id}'`
for any `source: 'mcp'` entry. Fulfilling this project means the backend gains an **MCP client
runtime** that, for `source: 'mcp'`:

1. Calls `tools/list` on `mcpServerUrl` to discover tools for the connected provider.
2. Dynamically creates proxy `IToolExecutor` classes for each discovered tool (the same
   adapter trick Composio's loader uses).
3. Routes `tools/call` to the server, forwarding the decrypted Rail A token as a header.
4. Maps the result into `StandardToolResult` (and the typed reconnect signal on 401).

> **No breaking change** to `ToolboxDefinition` or any call site — only the MCP branch of
> `registerAllToolboxes()` becomes real. (See Rail E feature design, D-6 and KD-1.)

### 10.2 Division of responsibility

| Concern | Owner |
|:--|:--|
| Token storage / refresh / re-auth | xcale-backend (Rail A) |
| Which tools a user sees (Tool Basket, curation, agent authorization) | xcale-backend |
| Tenant isolation, business rules, agent orchestration | xcale-backend |
| Provider API client, tool execution, error normalization | **xcale-mcp-server** |
| MCP protocol handling | both sides of the boundary |

---

## 11. SOLID principles & design patterns applied

The system is explicitly designed against SOLID and well-known patterns so it scales to many
providers cleanly.

| Principle / Pattern | Where it shows up |
|:--|:--|
| **Single Responsibility** | Each provider adapter does one thing: translate MCP ↔ one provider. Protocol handling, auth extraction, and registry are separate modules. |
| **Open/Closed** | Adding a provider extends the system (new module + one registry line) without modifying protocol, auth, or other providers. |
| **Liskov Substitution** | Every provider implements `IProvider`; the server treats them uniformly. Any provider is substitutable behind the registry. |
| **Interface Segregation** | `IProvider` is intentionally small (`listTools`, `callTool`). No provider is forced to implement capabilities it doesn't have. |
| **Dependency Inversion** | The server core depends on the `IProvider` abstraction, not on concrete provider clients. Providers depend on the core's interfaces, not vice versa. |
| **Adapter** | Each provider wraps a foreign API behind the common `IProvider` contract (mirrors `ComposioToolExecutor`). |
| **Registry** | `ProviderRegistry` — explicit map of `slug → IProvider`. No auto-discovery (matches Rail D/E). |
| **Strategy** | Per-provider error normalization and auth handling are pluggable strategies behind a uniform result shape. |
| **Factory (light)** | Tool handlers are constructed per provider; an optional scaffold generates the skeleton. |
| **Facade** | `server.ts` presents `tools/list` + `tools/call` as a single facade over all providers. |

> **Guardrail (from `soul.md`): every abstraction must earn its place.** These patterns are
> targets, not mandates — introduce each only when a second real provider proves the
> duplication. Three similar lines beat a premature interface.

---

## 12. Open design questions (must resolve before/with build)

> **Status (2026-06-19):** most of these are now **resolved** through the `/grill` session and
> the architecture review. The decisions and their rationale live in
> `docs/architecture-review.md` and `docs/adr/` — not duplicated here. Quick map:
> Q-2/Q-4/Q-5/Q-6 → [stateless-gateway-and-thin-acl] + [additive-contract-versioning];
> Q-1 → [credential-forwarding-and-token-model] (**Accepted, scope-bounded** — security review
> done; ephemeral references mandatory before financial/high-risk providers); Q-7/Q-8 resolved
> (author-time curation; declared per-provider context
> schema). **New questions surfaced and resolved:** Q-9 capability discovery →
> [three-pillar-mcp-contract-with-discovery]; Q-10 auth-knowledge vs custody →
> [provider-knowledge-vs-credential-custody]; Q-11 ephemeral-reference token model → folded into
> the open Q-1 ADR. Q-3 (SSRF allowlist) remains a **backend-side** concern, not this repo's.
> (ADRs linked by slug under `docs/adr/`.)

Original table (carried from the vision doc), kept for traceability:

| # | Question | Notes |
|:--|:--|:--|
| **Q-1** | **Token forwarding header.** Which header carries the decrypted token? How does the server signal a 401 (expired) back so Rail A triggers re-auth? | Lean: a dedicated `X-Provider-Token` header + a typed JSON-RPC error code mapped to "reconnect required". |
| **Q-2** | **Tool schema caching.** Where are `tools/list` results stored (Redis? Mongo? in-memory on the backend)? TTL? What triggers re-fetch (reconnect, version change)? | Likely backend-side cache; the server stays stateless. |
| **Q-3** | **SSRF protection.** `mcpServerUrl` must be validated before the backend makes outbound calls. Allowlist strategy? | Allowlist of known server URLs in backend config. |
| **Q-4** | **Deployment & versioning.** How is the server deployed/versioned? Same DO App Platform? How does `mcpServerUrl` point to the right env (dev/prod)? | Probably a separate DO App Platform service; env-specific URLs. |
| **Q-5** | **Server auth (hop B).** How does xcale-backend authenticate *to* the server? Shared secret? mTLS? | Distinct from provider auth (§8.2). Start with a shared secret; revisit mTLS. |
| **Q-6** | **Stack & language.** TypeScript/Node (to match xcale-backend and reuse the team's expertise) vs. an official MCP SDK in another runtime? | Strong lean: TypeScript + the MCP TypeScript SDK, for consistency (`soul.md`: consistency beats novelty). |
| **Q-7** | **Curation parity.** High-tool-count providers need curation (like Composio's). Does the server expose curation metadata, or does the backend curate `tools/list` output? | Mirror the existing `composio/curation/` approach. |
| **Q-8** | **Multi-account providers.** How is `accountKey` (multiple stores/tenants per user per provider) forwarded and used by an adapter? | Forward via `ProviderCallContext.metadata`, mirroring Rail A's `accountKey`. |

---

## 13. First functional requirements

A first cut, to be refined via `/grill` → `/feature-design`. Numbered for traceability.

### Must have (v1 — prove the boundary end-to-end)

- **FR-1** The server MUST expose an MCP endpoint speaking JSON-RPC 2.0 over Streamable HTTP.
- **FR-2** The server MUST implement `tools/list`, returning the tool definitions
  (`name`, `description`, `inputSchema`) for a requested provider.
- **FR-3** The server MUST implement `tools/call`, executing one tool with arguments and
  returning a normalized result.
- **FR-4** The server MUST accept a forwarded provider token per call via a request header and
  MUST NOT persist, cache, or log the raw token.
- **FR-5** The server MUST map provider auth failures (401/403) to a typed "reconnect
  required" result distinguishable from generic errors.
- **FR-6** The server MUST resolve tools to providers via an **explicit registry** (no
  auto-discovery).
- **FR-7** The server MUST ship **at least one real provider** (candidate: Nevatal or ePayco)
  proving the full `tools/list` + `tools/call` round trip.
- **FR-8** Each provider MUST implement the common `IProvider` contract; adding a provider MUST
  NOT require modifying protocol, auth, or other providers.
- **FR-9** The server MUST authenticate inbound calls from xcale-backend (hop B, §8.2) before
  executing any tool.

### Should have

- **FR-10** The server SHOULD normalize errors into a consistent shape across providers.
- **FR-11** The server SHOULD support multi-account providers via forwarded `accountKey`/metadata.
- **FR-12** The server SHOULD expose health/readiness endpoints for the DO App Platform.
- **FR-13** The onboarding recipe SHOULD be executable as a repeatable skill/scaffold (§9).

### Could have

- **FR-14** The server COULD expose curation metadata for high-tool-count providers.
- **FR-15** The server COULD support streaming tool results over the Streamable HTTP transport.

### Won't have (v1)

- Credential storage, token refresh, tenant model, agent orchestration, business logic.

---

## 14. Non-functional requirements

- **Security:** stateless auth; no token at rest; inbound server-auth (hop B); SSRF allowlist
  on the backend side; no secrets in logs.
- **Correctness:** no swallowed errors; auth failures explicitly surfaced; idempotent where
  the provider allows.
- **Performance:** per-call latency is on the agent's critical path — keep adapter overhead
  minimal; the server is stateless and horizontally scalable.
- **Cost-awareness:** xcale is bootstrapped — avoid always-on workers and unnecessary
  provider calls (carried from `soul.md`).
- **Maintainability:** one provider = one isolated module; explicit registry; SOLID seams.
- **Consistency:** match xcale-backend conventions (TypeScript, kebab-case files, `IPascalCase`
  interfaces) so contributors move between repos without friction.

---

## 15. Roadmap & phasing

| Phase | Goal | Output |
|:--|:--|:--|
| **0 — Foundation** *(this doc)* | Capture context, vision, architecture seed, first FRs | `docs/foundation.md` + `.claude/` scaffolding |
| **1 — Grill & design** | Pressure-test the boundary, resolve Q-1…Q-9, lock the contract | `feature-design.md` + ADRs for the protocol boundary, auth model, stack |
| **2 — Protocol skeleton** | MCP server entrypoint, `tools/list` + `tools/call`, auth, registry — with one stub provider | Running server, no real provider |
| **3 — First real provider** | Nevatal or ePayco end-to-end through the MCP boundary | FR-7 proven + Phase-2 success criteria met (see `architecture-review.md` §10) |
| **4 — Backend MCP client runtime** | Fulfill Rail E KD-1: the `source: 'mcp'` branch in `registerAllToolboxes()` | A real provider usable by an agent end-to-end |
| **5 — Mechanize onboarding** | Harden the recipe + scaffold; add the next 2–3 LATAM providers | Provider count grows cheaply |
| **6 — Migrate natives** | Move existing native providers off xcale-backend onto the MCP server | See §16 |

---

## 16. The long-term endgame

The strategic objective beyond v1: **xcale-backend becomes a pure consumer of services and
owns only business rules.**

Today, native providers (Shopify, GSC, WordPress, Instagram, Nevatal, …) live inside
xcale-backend, mixing provider plumbing with business logic. The endgame is to **migrate that
plumbing into `xcale-mcp-server`**, provider by provider, until:

- xcale-backend holds **no provider API clients, no provider auth quirks, no per-provider
  tool execution** — only Rail A (connection lifecycle), the agent orchestration, tenant
  rules, and business logic.
- Every provider is reachable through the **uniform MCP boundary**, whether it's a LATAM app
  xcale wrote or (eventually) a re-homed former native.
- Adding or changing a provider never touches xcale-backend's business code.

This is a **gradual, prove-as-you-go migration**, not a big bang. Rail E's discriminated
union (`source: 'native' | 'mcp'`) is precisely what lets a provider flip from native to MCP
without breaking the backend — one provider per slice, each independently reviewable and
revertable. The native rails (A–E) are not wasted: Rail A still owns auth even after a
provider moves to MCP; the rest of the plumbing is what migrates out.

---

## 17. Glossary

| Term | Meaning |
|:--|:--|
| **MCP** | Model Context Protocol — open standard (JSON-RPC 2.0) for exposing tools to LLM clients. https://modelcontextprotocol.io |
| **MCP server** | This repo (`xcale-mcp-server`) — exposes provider tools over MCP. |
| **MCP client** | xcale-backend — consumes the server's tools. |
| **Provider / adapter** | A thin module that maps one external API (e.g. Nevatal) to the MCP tool contract. |
| **Tool** | A single callable capability (`name` + `inputSchema`), discoverable via `tools/list`, runnable via `tools/call`. |
| **Tool Basket** | xcale-backend's per-user materialized set of available tools. |
| **Rail A** | xcale-backend's connection/OAuth/re-auth lifecycle. Owns token storage. |
| **Rail E** | xcale-backend's `ToolboxDefinition` + `registerAllToolboxes()`; defines the `MCPToolboxDefinition` stub. |
| **`StandardToolResult`** | xcale-backend's normalized tool-result envelope (`success`, `message`, `data`, optional `ui`). |
| **Stateless auth** | The server holds no credentials; it receives a token per call and discards it. |
| **Hop A / Hop B** | Hop A = user token → provider API; Hop B = xcale-backend → MCP server. |
| **Curation** | Shipping a high-signal subset of a provider's tools to protect agent tool-selection accuracy and token budget. |

---

## 18. References

**Inside xcale-backend (the consuming side — source of truth for the backend):**

- Vision (the seed of this doc): `xcale-backend/docs/design/native-toolbox-platform/mcp-plugin-vision.md`
- Rail E feature design (`MCPToolboxDefinition`, KD-1, the discriminated union): `xcale-backend/docs/design/native-toolbox-platform/toolbox-definition-rail-e/feature-design.md`
- Initiative roadmap (Rails A–E status, Phase 3 MCP row): `xcale-backend/docs/design/native-toolbox-platform/roadmap.md`
- Composio reference architecture: `xcale-backend/src/modules/composio/README.md`
- Composio curation pattern: `xcale-backend/src/modules/composio/curation/README.md`
- Rail A (connection auth the MCP path consumes): `xcale-backend/docs/adr/0005-native-connection-reauth-lifecycle.md`
- Native-vs-Composio sourcing policy: `xcale-backend/docs/adr/0004-native-vs-composio-sourcing-policy.md`
- xcale identity & engineering philosophy: `xcale-backend/.claude/rules/soul.md`

**External:**

- MCP protocol spec: https://modelcontextprotocol.io (JSON-RPC 2.0, Streamable HTTP transport)

---

> **How to use this document:** treat it as the stable *intent* layer. As decisions get made,
> spin them into `feature-design.md` and ADRs under `docs/design/` and `docs/adr/`; update the
> Open Questions table (§12) and the roadmap (§15) here so this file always reflects current
> direction. Keep artifacts in English (xcale convention); discuss in whatever language suits
> the team.
