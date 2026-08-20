# CONTEXT.md — xcale-mcp-server glossary

The canonical vocabulary for this repo. One term, what it **is**, and `_Avoid_:` for rejected
aliases. No implementation detail, no decisions (those live in `docs/adr/` and feature designs).
Seeded from `docs/foundation.md` §17 and sharpened during the first `/grill` session
(2026-06-18). Skills (`grill`, `feature-design`) read and update this file.

---

**MCP** — Model Context Protocol; open standard (JSON-RPC 2.0) for exposing tools to LLM
clients. https://modelcontextprotocol.io

**MCP server** — this repo (`xcale-mcp-server`); exposes provider tools over MCP.
_Avoid_: "the gateway" as a synonym for the whole system — the gateway is the _shape_, the
server is the artifact.

**MCP client** — xcale-backend; consumes the server's tools. The only consumer in v1.

**Provider / adapter** — a thin module that maps one external API (e.g. Nevatal) to the MCP
tool contract. _Avoid_: "integration" (overloaded — say "provider" for the adapter here,
"connection" for a user's authenticated link in Rail A).

**Tool** — a single callable capability (`name` + `inputSchema`), discoverable via `tools/list`,
runnable via `tools/call`.

**Protocol boundary** — the MCP surface between backend and server, now **three pillars**:
`server/discover` (capability catalog), `tools/list`, `tools/call`. The _only_ interface between
the two systems. _Avoid_: calling it "two methods" (outdated); treating internal module APIs as
"the boundary".

**Thin ACL (anti-corruption layer)** — the design stance resolved in grill: the MCP SDK is
confined to `src/protocol/`, which translates MCP wire types ↔ our own domain types
(`IProvider`, `ToolDefinition`, `ToolResult`). Adapters never import `@modelcontextprotocol/sdk`.
JSON Schema is reused as-is; the transport is **not** abstracted (one protocol only).
_Avoid_: "MCP is the core" (it is a swappable edge); "transport-agnostic core" (rejected as
premature abstraction).

**Plugin core** — the stable inner system (registry + adapters + domain types) that the MCP
"skin" wraps. The phrase "a plugin disguised as MCP" refers to this stance.

**Stateless (two distinct senses — keep separate)** —

1. _stateless auth_: the server holds no credentials; it receives a token per call and
   discards it (never persists, caches, or logs the raw token).
2. _stateless transport_: Streamable HTTP with **no** `Mcp-Session-Id`; each `tools/call` is
   an independent POST. Chosen partly to sidestep MCP's session-elimination breaking change.

**Hop A** — auth from the forwarded user token → the provider API (per-connection data, carried
in `X-Provider-Token`).

**Hop B** — auth from xcale-backend → xcale-mcp-server (infrastructure trust; a shared-secret
`Authorization: Bearer`). _Avoid_: conflating Hop A and Hop B — they are different secrets and
**neither is ever logged**.

**`X-Provider-Token`** — the request header carrying the decrypted, opaque provider credential
for Hop A. The adapter applies it per its provider's scheme; the core never interprets it.

**`X-Provider-Metadata`** — the request header carrying `ProviderCallContext.metadata` on the
wire: an opaque JSON object (plain or base64-encoded), forwarded by the consumer and parsed in
exactly one place (`src/server.ts` → `extractProviderMetadata`). The core never interprets it; the
adapter's `metadataSchema` validates the keys it needs. _Avoid_: putting secrets here (it is not
redacted like the token) or any consumer/tenant identity — it carries provider routing data only
(e.g. `propertyID`).

**`PROVIDER_AUTH_EXPIRED`** — the typed, machine-readable code returned in a `tools/call` result
with `isError: true` (in `structuredContent`) when a provider returns 401/403. The backend maps
this code → Rail A's `markConnectionAuthFailure()` → reconnect prompt. _Avoid_: signalling
expiry as a JSON-RPC protocol error (rejected — it's a tool-execution failure, not protocol).

**`ProviderCallContext.metadata`** — an opaque `Record<string, unknown>` channel for
provider-scoped data an adapter needs beyond the token (e.g. `accountKey`, `storeDomain`). Carried
on the wire via [`X-Provider-Metadata`](#). Each adapter validates the keys it needs with `zod`.
_Avoid_: treating metadata as tenant/user identity — it carries no business meaning to the core.

**Curation (author-time)** — we expose a high-signal tool set by **declaring only the tools that
matter** in each adapter, not by running a runtime curation engine. _Avoid_: "the server curates"
(it doesn't; per-user/token-budget curation stays in the backend's existing `composio/curation`).

**Tool Basket** — xcale-backend's per-user materialized set of available tools (a backend term;
the server has no notion of it).

**Rail A** — xcale-backend's connection/OAuth/re-auth lifecycle. Owns token storage. Still owns
auth even after a provider migrates to MCP.

**Rail E** — xcale-backend's `ToolboxDefinition` + `registerAllToolboxes()`; defines the
`MCPToolboxDefinition` (`source: 'mcp'`) stub this project fulfills.

**`StandardToolResult`** — xcale-backend's normalized tool-result envelope (`success`, `message`,
`data`, optional `ui`). The backend's MCP client maps our `ToolResult` into this; it is **not** a
type in this repo.

**Provider Self-Containment** — architectural principle #1: adding a provider means working
almost exclusively in `src/providers/{slug}/`; the only permitted backend touch is generic config
(secrets/env) or business policy, never provider-specific code. _Avoid_: editing backend logic to
support a standard provider (that is the alarm signal). See `docs/architecture-review.md` §0.

**Capability catalog** — what `server/discover` publishes: per provider, its `slug`, display
metadata, `authDescriptor`, `contextSchema`, `toolCount`, health, and `schemaVersion`. The backend
discovers providers from this instead of hardcoding them. _Avoid_: "the registry" (that is the
server's internal list; the catalog is the published view of it).

**`authDescriptor`** — the **non-secret**, adaptive auth blueprint a provider publishes (api*key →
type + field labels; oauth2 → URLs/scopes/placement). Lets Rail A run auth flows generically.
\_Avoid*: putting secrets (`clientId`/`clientSecret`) in it — those stay in the backend's Doppler;
hand-maintaining `scopes` for an oauth2 provider (it is **derived** — see [`requiredScopes`](#)).

**`additionalAuth` (the CONNECT vs AUTHENTICATE split)** — a provider may publish more than one way
to **connect** (e.g. Cloudbeds: OAuth _or_ a pasted property API key) via `additionalAuth[]`,
surfaced in the catalog as `additionalAuthDescriptors`; but `auth` stays **singular** and is the
**only** input to materialization — every connect method must yield a credential that authenticates
identically (ADR `multiple-connect-methods-per-provider`). _Avoid_: a second materialization path
keyed off `additionalAuth`; treating the array as call-time fallback auth (it is connect-time UX
only, consumed by Rail A's connect flow).

**`requiredScopes`** — the OAuth scopes one tool needs in order to run, declared **on the tool** beside
its `input` schema. Provider knowledge, so it lives in the adapter. It is the **single source** of a
provider's scope surface: the `authDescriptor`'s `scopes` is the **union** of its tools' `requiredScopes`,
never a hand-written list. Adding a tool therefore requests its scope automatically, and a
hand-maintained list cannot drift from the provider's app registration. _Avoid_: a literal `scopes`
array in an oauth2 `authDescriptor`; declaring a scope no tool uses (it would be requested and never
exercised); declaring a scope the provider app is not registered for (it can break the authorize URL
for **every** consumer — guard it with a test asserting the union ⊆ the app's registered set).

**Scope grant (Cloudbeds-shaped, but general)** — what a provider actually authorizes for a connection.
**Requested ⊇ granted.** When a provider's consent is **binary** (the user accepts the whole requested
list or nothing — Cloudbeds), requested **==** granted, so the consumer's stored scope list is a faithful
record despite recording only the request. The residue — capabilities the account's *plan* lacks — is not
knowable ahead of time and surfaces only as a **runtime denial**. _Avoid_: assuming a token response
carries the grant (Cloudbeds' does not — observed); treating the consumer's stored scope list as *proof*
of a grant (it is a copy of the request; it is merely correct under binary consent).

**`ProviderErrorCode`** — the closed, `as const` set of error codes on the `ToolResult` error
variant (`PROVIDER_AUTH_EXPIRED`, `PROVIDER_RATE_LIMITED`, …); evolves additively only. _Avoid_:
free-form error strings.

**Error-ownership boundary (invariant)** — a `ProviderErrorCode` (and any `ToolResult`) is emitted
**iff the failure belongs to the provider domain** — determined by *who owns the cause*, **not** by
the temporal phase nor by whether a valid credential ever materialized. Failures owned by the
**transport / internal protocol** (Hop-B, expired or already-consumed [Ephemeral reference](#),
resolution never reached) are never a `ProviderErrorCode` and produce **no `ToolResult`** at all.
Consequences that pin the boundary: a resolve-time **mint** failure because the durable credential
was revoked/unrefreshable is **provider-owned** → `PROVIDER_AUTH_EXPIRED` (even though no valid JWT
ever existed and no data call ran — "is this connection still usable?" is no); an **expired
reference** is **transport-owned** → one transparent retry, then a transport error. The consumer
never needs to know *where* auth failed. _Avoid_: defining the boundary by "a credential existed" or
"execution began" (a revoked-credential mint failure breaks that framing); `REFERENCE_EXPIRED` /
`REFERENCE_ALREADY_USED` inside `ProviderErrorCode`; a `ToolResult(kind:'error')` for a
transport-owned failure.

**Credential-in-Transit-Only** — the server may process a provider credential in memory for one
invocation, but must never persist it (DBs, queues, persistent caches, logs, metrics, traces,
dumps). The governing invariant of the credential boundary. See
`docs/security/credential-boundary-review.md`.

**`SecretString`** — branded wrapper type for the forwarded credential whose `toJSON`/`toString`/
`inspect` return `"[REDACTED]"`; `.reveal()` is called only at the provider egress, only inside
`src/providers/**`. The mechanical enforcement of Credential-in-Transit-Only.

**Credential delivery strategy** — how a provider's credential reaches the server on a `tools/call`.
Exactly **two** strategies exist: `forwarded` (`X-Provider-Token` carries the usable credential; the
server uses it directly — non-financial providers, e.g. Nevatal, Cloudbeds) and `reference`
(`X-Provider-Token` carries an [Ephemeral reference](#) the server resolves just-in-time via the
[Credential Authority](#) — financial/high-risk providers, e.g. Siigo, ePayco). Declared per provider
in its `authDescriptor` and published in the catalog, so one declaration drives both sides: the
consumer knows *what to send*, the server knows *whether to resolve*. The core has a single
`forwarded`-vs-`reference` branch. _Avoid_: a per-provider strategy (a "siigo strategy"); an
`if slug === 'siigo'` in core/protocol; a third strategy without an ADR.

**Credential Resolution phase** — the server-side pipeline stage between Transport and Provider
Execution that turns inbound credential material into a uniform [`ResolvedCredential`](#),
dispatched by the provider's `credentialDelivery`. Both strategies flow through it via a
`CredentialResolver`: `ForwardedCredentialResolver` (near-identity — wraps the `X-Provider-Token`
value) and `ReferenceCredentialResolver` (Hop-B callback to the [Credential Authority](#), which owns
the mint/reuse/refresh policy). Both yield the **same** resolved-credential shape, after which the
pipeline is byte-for-byte identical — so a delivery strategy is confined to one swappable resolver,
never an `if forwarded/else` in the runtime (dispatch is `resolvers[provider.auth.delivery].resolve()`).
An **earned** Strategy pattern — two real strategies exist today (Cloudbeds/Nevatal `forwarded`, Siigo
`reference`) — not a premature one. **Exactly one resolution per `tools/call`**: one `ResolvedCredential`,
request-scoped, reused across every provider egress in that call — a call never resolves multiple
references. _Avoid_: branching on the delivery strategy inside provider/runtime code; putting mint
policy in the server-side resolver (it belongs to the Credential Authority); resolving more than one
reference per call or distributed resolution inside the runtime; a third resolver without an ADR.

**`ResolvedCredential`** — the uniform runtime representation a `CredentialResolver` returns and that
Provider Execution consumes (via [Authentication Materialization](#)); the convergence point of both
delivery strategies. Its **concrete representation is an implementation detail**: today a `SecretString`
(one secret suffices for bearer/api_key/basic), but the concept is "the material needed to
authenticate", which would generalize to richer material (e.g. `keyId`+`secretKey`+`region`+`algorithm`)
if imperative auth ever lands — a change confined to the resolver + materializer, never the transport.
_Avoid_: coupling the concept to `SecretString` in code the transport or a provider can see; treating a
bare secret as its permanent shape.

**Authentication Materialization** — the core, transport-blind step that consumes an `AuthDescriptor` +
a `ResolvedCredential`, **reveals** the secret, and produces a **fully materialized, plain `HttpRequest`**
(the single `.reveal()` egress point). The HTTP transport that runs the request knows nothing of
`SecretString`, `ResolvedCredential`, or any auth scheme (bearer/api_key/basic/cookie) — it just sends a
built request. This is the swap point for a future imperative (signed-request) auth variant. _Avoid_:
leaving a `SecretString` in the materializer's output (materialization must finish there, not straddle
into transport); the transport knowing any auth scheme; `.reveal()` outside this step.

**Ephemeral reference** — a single-use, high-entropy, short-TTL (≤60s) **opaque nonce** that stands in
for a provider credential on the wire under the `reference` delivery strategy. It resolves to a
**connection**, not a specific token — the Credential Authority decides at resolve time whether to
mint, reuse, or refresh the real credential. Implements the "Alternative B (ephemeral references)" of
[credential-forwarding-and-token-model](docs/adr/credential-forwarding-and-token-model.md) without
full RFC 8693 machinery; the wire contract is the same shape, so the internal mechanism can later
harden to RFC 8693 without a contract change. On resolution failure (TTL expiry / already-consumed),
the consumer retries **exactly once** with a fresh reference — a second failure is systemic, not a TTL
race, and must surface rather than loop. The two delivery strategies **converge** at Provider
Execution: `forwarded` = backend sends credential → server executes; `reference` = backend sends
reference → server resolves → server executes — identical from execution onward, so the strategy
lives at a single pipeline point. _Avoid_: putting the `connectionId` or the real token in the
reference value (must be an unguessable nonce); "single-use" meaning one provider HTTP call rather
than one resolution per `tools/call`; unbounded resolve retries.

**Credential Authority** — Rail A's resolved role in the reference model: the single owner of provider
secrets that also **resolves** ephemeral references to real credentials just-in-time, encapsulating
the mint/reuse/refresh policy behind a `POST /internal/credentials/resolve` endpoint (Hop-B
authenticated). _Avoid_: "the place where tokens are stored" (it is the resolution authority, not a
passive store); moving resolution to a shared cache the server reads (that re-splits custody).

**Execution Engine** — xcale-mcp-server's resolved role: it executes provider calls with a credential
it receives (or resolves) per call and immediately discards; it is never a custodian. The counterpart
of the [Credential Authority](#). _Avoid_: the server reading a credential store directly.

**`credential_exchange` (auth descriptor variant)** — the additive `ProviderAuthDescriptor` variant
for providers that mint a short-lived bearer token from durable credentials via a token endpoint
(Siigo: `POST /auth` with `username`+`access_key` → 24h JWT). Rail A (the Credential Authority) runs
it **generically** from the descriptor. Strictly **declarative**: `tokenEndpoint`, `method`,
`bodyFields` (logical→wire name mapping), `responseFields` (token + expiry keys; OAuth-style
defaults), `staticHeaders` (name + source), `tokenPlacement`. It carries **no behavior** — no hooks,
templates, expressions, signing, or JSON-path. A provider needing *imperative* auth (HMAC/signing)
does NOT extend this variant: it reopens where the mint runs (a declarative descriptor can't express
it and Rail A can't run the server's code) and requires its own variant + an ADR. _Avoid_: growing
this into a config-DSL / interpreter.

**Provider institutional identity (e.g. Siigo `Partner-Id`)** — a **non-secret, constant identifier**
of xcale-as-integrator that a provider requires on every call (Siigo: the integrator app name, 3–100
alphanumerics, e.g. `xcaleContabilidad`). It is *knowledge/config*, not per-user *custody* — leaking
it alone grants no access — so the "custody stays in Rail A" invariant does not apply to it. The
`authDescriptor` declares the header requirement (`name` + `source: deployment`); the **value** is
deployment config wherever a process calls the provider (the server for all data calls; Rail A for the
mint) and is **never** placed in the published catalog (that would inject consumer identity into a
consumer-agnostic contract). _Avoid_: calling it a secret/credential; building machinery to avoid
duplicating a constant; putting its value in the descriptor or catalog.

**Consumer-agnostic** — architectural principle #2: public contracts carry no consumer-specific
concepts (no xcale entities, tenant ids, plan/business terms); the server is told _which token_ and
_which tool_, never _which tenant_. xcale-backend is the **first consumer**, not a dependency.
_Avoid_: "the boundary between xcale-backend and the server" (it is the boundary between the server
and _any_ consumer). See `docs/adr/consumer-agnostic-contract.md`.

**Provider lifecycle** — per-provider evolution metadata in `manifest.ts`/catalog: `providerVersion`
(adapter semver), `apiVersion`, `deprecated`, `sunsetDate`. v1 ships `providerVersion` (+
`schemaVersion`); the rest are **reserved** so a provider can evolve or be retired without breaking
consumers. _Avoid_: conflating it with `schemaVersion` (that versions the contract; this versions
the provider). See `docs/adr/additive-contract-versioning.md`.

**Provider capabilities (reserved)** — optional flags a provider may declare in the catalog
(`streaming`, `longRunning`, `webhooks`, `polling`, `files`, `pagination`, `autoRefresh`); absent =
not supported. Reserved now so the model isn't limited to simple synchronous calls; each is built
only on demonstrated need (_complexity on demand_). See `docs/architecture-review.md` §4.3.

**Complexity on demand** — the rule that no new infrastructure (own DB, queues, scheduler, complex
discovery, distributed plugin runtimes) is added until a demonstrable need exists; introducing any
requires an ADR. Keeps the platform maintainable as providers grow. _Avoid_: building for a "might
need it someday" scenario.

---

### Canonical provider patterns (from the Cloudbeds grill, 2026-06-21 — see `docs/adr/canonical-provider-pattern.md`)

**`defineTool`** — the helper every tool is declared with: `{ name, description, input (zod), handler }`.
The `input` is the **single source of truth** — it validates args AND generates the `tools/list`
JSON Schema. The provider's `callTool` dispatcher validates before calling, so handlers get **typed,
pre-validated** args. _Avoid_: a hand-written `inputSchema`, or `parse()` inside handler business logic.

**Single Source of Truth (tool contract)** — each tool has one canonical schema; all derived forms
(JSON Schema, types, docs) are generated from it. CI-enforced (no literal `inputSchema` in providers).

**`PaginatedResult<T>`** — the uniform list envelope: `{ items, page, pageSize, totalPages?,
totalResults?, hasMore? }`. List tools take `page`/`pageSize` (defaults + max). _Avoid_:
auto-pagination and internal 429 retry loops (return `PROVIDER_RATE_LIMITED`; consumer decides).

**Explicit Context** — when an operation can target multiple logical contexts (property, org,
workspace…), the target is explicit + validated via the provider's own `metadataSchema` (zod),
never inferred. The core knows no field names (no `propertyID` in the framework). Whether a provider
declares a `contextSchema` is determined by the **cardinality of connection → operational scope**,
**not** by the provider: `1 connection → 1 scope` ⇒ no `contextSchema` (the resolved connection fully
determines the scope — e.g. one Siigo credential = one company/NIT); `1 connection → N scopes` ⇒
`contextSchema` required (the token alone can't disambiguate — e.g. Cloudbeds `propertyID`). A user
operating several scopes is modeled as **multiple connections** (Rail A resolves exactly one per call)
unless a single connection genuinely spans many. _Avoid_: "Cloudbeds is the exception"; inferring that
a whole category (e.g. financial providers) does/doesn't use metadata from one provider's cardinality.

**Fidelity over Unification** — `data` preserves the provider's original semantics; only the
envelope is standardized. Curation (documented field projection) yes; cross-provider canonical
entities (`Reservation`, `Guest`) no (would be domain logic). Override only via ADR.

**Share policies, not assumptions** — the core centralizes universal invariants (security, typing,
contracts, `mapHttpStatusToErrorCode`, token-at-egress); provider-specific behavior stays per-provider.
No shared HTTP framework until ≥2 providers prove it (ADR required). _Avoid_: centralizing a guess.

**`createXProvider(deps?)`** — provider factory with the HTTP transport (and future clock/ids/retry/
logger) injectable; default instance registered in `src/providers/index.ts`. Enables deterministic
unit tests against recorded `__fixtures__/` + the mandatory `runProviderConformance` suite.

**Reconciliation reference tag** — a caller-supplied marker (e.g. `xpi-<orderId>`) embedded in a fiscal
document's `observations` so the consumer can recognize *its own* document later. Because the gateway is
at-most-once (no client idempotency key at Siigo), for `create_invoice` this is the **primary recovery
key**, not a secondary audit trail. _Avoid_: treating it as mere audit metadata; content-hash keys.

**Pending reconciliation** — resolving an idempotency-ledger entry stuck in `pending` (external POST
committed but its response was lost) via a *targeted* Siigo read keyed on the reference tag, to learn
whether the fiscal document actually exists before backfilling or retrying. _Avoid_: blind retry (mints a
duplicate DIAN doc) or blind reject (orphans a committed one).

**Confirm signal** — the out-of-band, backend-verified authorization to dispatch an irreversible fiscal
write, bound to a preview id that doubles as the idempotency key; re-presenting it is a no-op returning
the original result. _Avoid_: a model-emitted confirm tool (forgeable by prompt injection); a `dry_run`
flag; treating the preview id as an auth nonce separate from idempotency.

**Fiscal payload validation line** — structural validation (presence, types, id format, and the provider's
documented cardinality/non-negativity minimums like `≥1` line item) is the gateway/adapter's job (zod);
business validation (tax-id existence, total/tax reconciliation, authorization) is the consumer's.
_Avoid_: reading "structural" as presence+type only; trusting Siigo to 400 a malformed-but-typed payload;
tax math or id-existence checks in the gateway.

**Compensation (compensating write)** — a fiscal correction (Siigo credit note / nota crédito) offsetting
a prior fiscal write; gated identically (propose→confirm→idempotency), never agent-autonomous, never a
delete, carrying its own reference tag keyed to the target document. _Avoid_: assuming a human confirm
makes it internally safe (it inherits the same at-most-once retry hazard and needs its own
detect-before-retry check + the target's reconciled DIAN identifier).

**Non-fiscal write** — a provider mutation not reported to a tax authority and correctable in place
without a credit note (e.g. `create_customer`); may still be a prerequisite of a fiscal write. _Avoid_:
equating "non-fiscal" with "safe to ship ungated" — its dedup may depend on a read that must itself soak.
