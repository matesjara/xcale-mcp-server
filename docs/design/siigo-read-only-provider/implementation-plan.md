# Implementation Plan — Siigo Read-Only Provider & the `reference` Credential Model

> **Scope**: cross-repo (xcale-mcp-server + xcale-backend). **Upstream**:
> [feature-design.md](feature-design.md) · [sandbox-verification.md](sandbox-verification.md) ·
> ADR [credential-delivery-strategies](../../adr/credential-delivery-strategies.md).
> **Status**: **Phase A COMPLETE & committed** (both repos green — mcp-server 70 tests, backend 155
> connections tests). **Phase B is evidence-gated and currently BLOCKED at B0** (external: a Siigo test
> account's `userName`+`accessKey` and the assigned `Partner-Id`). No provider code or API contract is
> written until B1 produces Observed facts.

## Meta-description

This build lands the **provider-agnostic credential-delivery machinery** defined by the ADR, then
onboards Siigo as its first `reference` consumer. The change introduces **three separated
responsibilities** in the mcp-server core — `Credential Resolution → Authentication Materialization →
HTTP Transport` — and the backend counterpart (the **Credential Authority**: a resolve endpoint,
a generic `credential_exchange` mint executor, and an ephemeral-reference store). It also closes two
code-audit findings: the hardcoded `Authorization: Bearer` and `.reveal()` living in the generic HTTP
helper. "Done" for Phase A = both repos green, the two seams operational, and **Cloudbeds/Nevatal
`forwarded` behavior byte-for-byte unchanged**.

## Phase division & rolling-wave (read first)

- **Phase A — shared infrastructure (provider-agnostic).** Fully specified below. Contains **zero**
  Siigo facts. Deliverable: the machinery ready to accept any declarative provider.
- **Gate A→B** — objective exit criteria; Phase B cannot start until all are green.
- **Phase B — Siigo.** Two sub-phases: **B1 Discovery & Contract** (runs the sandbox checklist → freezes
  Q-1..Q-4 → authors `api-contract.md`), **Gate B1→B2**, **B2 Siigo implementation** (all provider
  concretes). **Per-file detail for B2 is intentionally absent** — it is **BLOCKED BY API CONTRACT**;
  authoring it now would inject unverified provider facts (violates the feature-design guardrail). B2 is
  specified at **slice level** only; its per-file detail is authored at Gate B1→B2 against the frozen
  contract. This taper is deliberate, not a gap.

---

# PHASE A — Shared credential-delivery infrastructure

## A.0 Target file tree — xcale-mcp-server

```
src/
├── core/
│   ├── provider-port.ts          MODIFIED  + credentialDelivery on descriptor; + credential_exchange variant; closed enums
│   ├── types.ts                  MODIFIED  ProviderCallContext unchanged on wire; add ResolvedCredential type
│   ├── tool.ts                   MODIFIED  ToolHandlerContext: expose authed request executor, not raw token
│   ├── http.ts                   MODIFIED  requestJson loses `token`/Bearer (F-1, F-2); becomes auth-blind transport
│   ├── errors.ts                 UNCHANGED (context) assertNever already exists (used by materializer switch)
│   ├── secret-string.ts          UNCHANGED (context)
│   ├── provider-factory.ts       MODIFIED  inject authed-request executor into handler ctx (bound to auth + resolved cred)
│   ├── credential/               NEW dir
│   │   ├── resolved-credential.ts    NEW  ResolvedCredential (concept; today wraps SecretString)
│   │   ├── credential-resolver.ts    NEW  CredentialResolver interface + forwarded/reference impls + dispatch
│   │   └── reference-resolver.ts     NEW  ReferenceCredentialResolver: Hop-B callback to the Credential Authority
│   └── auth/                      NEW dir
│       ├── http-request.ts           NEW  RequestSpec (provider-built) + HttpRequest (materialized, plain)
│       └── authentication-materializer.ts  NEW  materialize(authDescriptor, resolved, spec) → HttpRequest (single reveal)
├── protocol/
│   └── mcp-server.ts             MODIFIED  run resolver before provider.callTool (single dispatch point)
├── providers/
│   ├── cloudbeds/client.ts       MODIFIED  build a RequestSpec + call ctx.request(); no token/requestJson
│   └── echo/*                    MODIFIED  auth_check reads resolved credential presence via ctx, not raw token
├── config.ts                     MODIFIED  + resolve-endpoint base URL + Hop-B outbound secret (reference resolver deps)
└── core/testing/
    └── provider-conformance.ts   MODIFIED  + descriptor JSON round-trip assertion (enforcement #5)
```

## A.1 Per-file changes — xcale-mcp-server (signatures + intent, not bodies)

### `src/core/provider-port.ts` — MODIFIED (anchor: descriptor union, `provider-port.ts:8-24`)
| Symbol | Signature / shape | Intent | Seam | Kind |
|:--|:--|:--|:--|:--|
| `CredentialDelivery` | `type = 'forwarded' \| 'reference'` | Closed union; the strategy discriminator | published in catalog | NEW |
| `ProviderAuthDescriptor` | add `readonly credentialDelivery?: CredentialDelivery` (default `'forwarded'` at read) | Opt-in per provider; drives resolver + backend emission | catalog + resolver dispatch | MODIFIED |
| `ProviderAuthDescriptor` | add variant `{ type: 'credential_exchange'; tokenEndpoint; method: 'POST'; bodyFields: Record<string,string>; responseFields: { token: string; expiry?: string }; staticHeaders?: ReadonlyArray<{name: string; source: 'deployment'}>; tokenPlacement: 'bearer_header' }` | Strictly declarative mint blueprint (Rail A executes it) | catalog + backend executor | NEW |
| `TokenPlacement` | `type = 'bearer_header' \| 'api_key_header' \| 'api_key_query' \| 'basic_header'` | Closed placement vocabulary for the materializer's exhaustive switch (enforcement #4) | materializer | NEW |

> **Enforcement note**: the descriptor is validated by a `.strict()` zod schema at registration
> (enforcement #1). The TS types above are the closed vocabulary; the materializer switch over
> `TokenPlacement` uses `assertNever` (`errors.ts:18`) so a new placement is a compile error (#4).

### `src/core/credential/resolved-credential.ts` — NEW
| Symbol | Signature | Intent |
|:--|:--|:--|
| `ResolvedCredential` | `interface { readonly secret: SecretString }` (concept; concrete shape is impl detail) | The uniform convergence output of resolution; consumed only by the materializer. Not `= SecretString` so transport/providers never couple to it. |

### `src/core/credential/credential-resolver.ts` — NEW
| Symbol | Signature | Intent |
|:--|:--|:--|
| `CredentialResolver` | `interface { resolve(inbound: SecretString, deps): Promise<ResolvedCredential> }` | The strategy seam |
| `ForwardedCredentialResolver` | `const … : CredentialResolver` (near-identity: `{ secret: inbound }`) | Preserves today's behavior for Cloudbeds/Nevatal/echo |
| `resolveCredential` | `(delivery: CredentialDelivery, inbound: SecretString, deps): Promise<ResolvedCredential>` | Dispatch: `{ forwarded, reference }[delivery]`; no `if` in the runtime |

### `src/core/credential/reference-resolver.ts` — NEW
| Symbol | Signature | Intent |
|:--|:--|:--|
| `ReferenceCredentialResolver` | `(deps: { resolveUrl; hopBSecret; fetchImpl? }): CredentialResolver` | Hop-B `POST {resolveUrl}` with the reference (from `inbound`) → returns `{ secret: SecretString(jwt) }`; **one transparent retry** on reference-expired; maps a durable-credential failure to a resolve error the dispatcher turns into `PROVIDER_AUTH_EXPIRED` (error-ownership boundary) |

### `src/core/auth/http-request.ts` — NEW
| Symbol | Signature | Intent |
|:--|:--|:--|
| `RequestSpec` | `interface { method: 'GET'\|'POST'; url: string; headers?: Record<string,string>; body?: string \| URLSearchParams }` | What a **provider client builds** — no auth, no secret |
| `HttpRequest` | `interface { method; url; headers: Record<string,string>; body? }` | **Materialized, plain** — what the transport sends; no `SecretString` |

### `src/core/auth/authentication-materializer.ts` — NEW (the F-1/F-2 fix locus)
| Symbol | Signature | Intent |
|:--|:--|:--|
| `materialize` | `(auth: ProviderAuthDescriptor, resolved: ResolvedCredential, spec: RequestSpec): HttpRequest` | Reveal once (`resolved.secret.reveal()`), apply the declared `tokenPlacement` via an **exhaustive switch** (`assertNever` default), return a plain `HttpRequest`. **The single `.reveal()` site.** Transport-blind. |

### `src/core/http.ts` — MODIFIED (anchors: `http.ts:22-27` RequestOptions, `http.ts:52-53` Bearer reveal)
| Symbol | Change | Intent |
|:--|:--|:--|
| `RequestOptions.token` | **REMOVED** | F-2: the transport no longer receives a credential |
| `requestJson` (`http.ts:46`) | drop the `if (opts.token) headers.authorization = Bearer …` block (`52-53`) | F-1 + F-2: transport is now auth-blind; accepts pre-built headers only |
| `sendRequest` | `(req: HttpRequest, opts?: { timeoutMs?; fetchImpl? }): Promise<RequestResult>` NEW (or `requestJson(req.url, { method, headers, body })`) | Pure transport over a materialized request |
| `mapHttpStatusToErrorCode` (`http.ts:8`) | UNCHANGED | Reused by adapters |

### `src/core/tool.ts` — MODIFIED (anchor: `ToolHandlerContext`, `tool.ts:23-26`)
| Symbol | Change | Intent |
|:--|:--|:--|
| `ToolHandlerContext<M>` | replace `token: SecretString` with `request(spec: RequestSpec): Promise<RequestResult>` (+ keep `metadata`) | The handler builds a `RequestSpec` and calls `ctx.request(...)`; it never touches the secret or reveal. `request` closes over the provider's `auth` + the resolved credential + the materializer + transport. |

### `src/core/provider-factory.ts` — MODIFIED (anchor: handler ctx build, `provider-factory.ts:81`)
| Symbol | Change | Intent |
|:--|:--|:--|
| `createProvider.callTool` | build `ToolHandlerContext.request` = `(spec) => sendRequest(materialize(spec.auth, ctx.resolvedCredential, spec))` closing over `spec.auth` | Wires the materialize→transport pipeline **inside core**, so the plain request never passes through provider-client code (plaintext stays in the core span) |
| `ProviderSpec` | unchanged (already carries `auth`) | — |

### `src/protocol/mcp-server.ts` — MODIFIED (anchor: `mcp-server.ts:49` `provider.callTool`)
| Symbol | Change | Intent |
|:--|:--|:--|
| `CallToolRequestSchema` handler | before `provider.callTool`, `const resolved = await resolveCredential(provider.auth.credentialDelivery ?? 'forwarded', ctx.token, resolverDeps)`; pass `resolved` into the call context | Single per-`tools/call` resolution point (one resolution per call — invariant); dispatch by the provider's declared delivery |
| `createMcpServer` | thread `resolverDeps` (from config) | DI for the reference resolver's Hop-B callback |

### `src/core/types.ts` — MODIFIED (anchor: `types.ts:16-21`)
| Symbol | Change | Intent |
|:--|:--|:--|
| `ProviderCallContext` | keep `{ token, metadata }` (wire-facing, unchanged); internal call context after resolution carries `resolvedCredential` | Wire contract untouched; resolution is an internal transform |

### `src/providers/cloudbeds/client.ts` — MODIFIED (anchor: `client.ts:23-31`)
| Symbol | Change | Intent |
|:--|:--|:--|
| `CloudbedsClient.get` | build a `RequestSpec` (url+query) and call `ctx.request(spec)` instead of `requestJson(url, { token })` | Provider stops touching the token; behavior identical (bearer_header) |

### `src/providers/echo/*` — MODIFIED
| Symbol | Change | Intent |
|:--|:--|:--|
| `auth_check` handler (`tools.ts:21-26`) | derive "credential present" from the resolved-credential path exposed via ctx, not `ctx.token.isEmpty()` | Keep the Hop-A wiring probe working under the new seam |

### `src/core/testing/provider-conformance.ts` — MODIFIED (enforcement #5)
| Symbol | Change | Intent |
|:--|:--|:--|
| `runProviderConformance` | add: assert `JSON.parse(JSON.stringify(provider.auth))` deep-equals `provider.auth` | Descriptor carries only serializable data (catches functions) |

### `src/config.ts` — MODIFIED
| Symbol | Change | Intent |
|:--|:--|:--|
| `Config` / `loadConfig` | add `credentialResolveUrl` (backend resolve endpoint) + `hopBOutboundSecret` (server→backend) | Deps for `ReferenceCredentialResolver` |

## A.2 Target file tree — xcale-backend (Rail A / Credential Authority)

```
src/modules/connections/
├── entities.ts                 UNCHANGED (context) ConnectionEntity: credentialSecret, getCredentialSecret(), expiresAt, isExpired()
├── credential-registry.ts      MODIFIED  + authMethod 'credential_exchange'; generic mint executor hook
├── credential-exchange.ts      NEW  generic declarative mint (build body from bodyFields, POST, extract token) — the executor
├── reference-store.ts          NEW  ephemeral reference: create(single-use, TTL≤60s) + consume(); Mongo TTL collection
├── reference-store.mongo.ts    NEW  Mongo impl (TTL index)
├── credential-resolve.service.ts NEW  resolve(reference) → connection → mint/reuse/refresh JWT → return usable token
├── internal-routes.ts          NEW  POST /internal/credentials/resolve (Hop-B auth, NOT verifyToken)
├── hop-b.ts                    NEW  constant-time Hop-B verify (inbound от server) — mirrors mcp-server auth/hop-b
├── connection.service.ts       MODIFIED  (read at build time) reuse mint/reuse/refresh for cached 24h JWT
└── routes.ts                   MODIFIED  mount internal-routes (separate auth chain)
src/modules/mcp/                (MCP client — reference emission)
└── mcp-tool-executor.ts        MODIFIED  (read at build time) for `reference` providers, send a reference in X-Provider-Token, not the token
```

> **Backend rolling-wave note**: `credential-exchange.ts`, `reference-store*`, `credential-resolve.service.ts`,
> `internal-routes.ts` are grounded in the **read** `entities.ts` (encryption + `credentialSecret` +
> `expiresAt`) and `credential-registry.ts` / `routes.ts`. The two `(read at build time)` files
> (`connection.service.ts`, `mcp-tool-executor.ts`) get a focused Reality Check at the start of the
> backend slice — their exact method seams are finalized against the file, not invented here.

## A.3 Vertical slices (ordered; foundation first)

| # | Slice | Repo | Band | Depends on | Deliverable |
|:--|:--|:--|:--|:--|:--|
| A1 | Descriptor vocabulary: `CredentialDelivery`, `TokenPlacement`, `credential_exchange` variant + `.strict()` zod schema | mcp | foundation | — | closed types + registration validation |
| A2 | `ResolvedCredential` + `RequestSpec`/`HttpRequest` types | mcp | foundation | A1 | the seam types |
| A3 | `AuthenticationMaterializer.materialize` (exhaustive placement switch, single reveal) + unit tests | mcp | foundation | A2 | materializer + tests |
| A4 | `CredentialResolver` (forwarded) + **context split** (raw `{token}` → resolved `{credential}`) + `provider-factory` builds `ctx.request` (materialize + **additive** `sendRequest`). OLD transport (`requestJson` w/ `token`) kept as compat; nothing migrated yet | mcp | integration | A3 | new pipeline exists end-to-end |
| A5 | Migrate Cloudbeds + echo clients to consume `ctx.request` (build `RequestSpec`; drop `ctx.token`/`requestJson`) | mcp | integration | A4 | **all providers on the new pipeline; Cloudbeds behavior identical** |
| A6 | **Delete the old path (single point):** remove `token`/Bearer from `http.ts` (F-1, F-2), remove `token` from `ToolHandlerContext`, drop unused `requestJson`; `.reveal()` now only in the materializer | mcp | integration | A5 | `http.ts` auth-agnostic; old path gone |
| **Gate A-Core** | resolver integrated · materializer used by ALL providers · `http.ts` auth-agnostic · zero `.reveal()` outside the materializer · Cloudbeds+echo tests green · `tsc`/`lint`/tests green | mcp | **gate** | A6 | **MCP runtime stable before backend** |
| A7 | Backend: `reference-store` (Mongo TTL, single-use) + `credential-exchange` executor | be | foundation | Gate A-Core | Credential Authority storage + mint |
| A8 | Backend: `credential-resolve.service` + `POST /internal/credentials/resolve` (Hop-B) | be | integration | A7 | resolve endpoint |
| A9 | mcp: `ReferenceCredentialResolver` (Hop-B callback, one retry) + config; backend MCP client emits a reference for `reference` providers | both | integration | A8 | reference path end-to-end (behind echo) |

> **Ordering rationale (refactor discipline):** build the new pipeline whole (A4) → migrate every
> consumer onto it (A5) → **then** delete the old path in one identifiable commit (A6). Transport-first
> would force temporary compatibility in the wrong place; this way the last change is a clean deletion.
> **Gate A-Core** stabilizes the MCP runtime before Rail A returns real references.
| A10 | Phase A gate: `tsc` + `lint` + tests green both repos; Cloudbeds/Nevatal behavior unchanged | both | verify | all | green gate |

## A.4 Delegation map

- **Foundation (orchestrator, sequential):** A1, A2, A3, A4, A7 — shared types + the two core seams + backend storage. Built once.
- **Independent slices (fan-out candidates):** A6 (mcp provider migration) and A7/A8 (backend) touch disjoint files and can parallelize after foundation.
- **Integration (orchestrator):** A5, A9, A10 — dispatch wiring, cross-repo reference path, gate.
- **Recommendation**: ~14 files, cross-repo → **fan-out warranted**. Suggested: one subagent for the backend Credential Authority (A7+A8), one for the mcp provider migration (A6), orchestrator holds A1–A5, A9, A10. Each subagent gets this plan + the ADR + `credential-boundary-review.md` + read-freedom; disjoint file ownership (mcp core vs backend module) guarantees no write conflict.

## A.5 Test strategy & Definition of Done (Phase A)

- **Materializer** (A3): unit tests per placement (`bearer_header` today; `api_key_header/query`, `basic_header` covered by the switch) — asserts correct header/query, and that `JSON.stringify(materialize output)` never contains the known secret only after reveal at egress; a serialization test proves `SecretString`/`ResolvedCredential` never leak.
- **Resolver** (A5, A9): forwarded = identity; reference = returns the mocked JWT; reference-expired → one retry then transport error (no `ToolResult`); durable-credential failure → `PROVIDER_AUTH_EXPIRED`.
- **Regression** (A6): existing `cloudbeds.test.ts` + `provider-conformance` pass unchanged — Cloudbeds output identical.
- **Backend** (A7/A8): reference single-use + TTL expiry (negative tests); resolve returns a usable JWT; Hop-B rejects a bad secret; `X-Provider-Token` rejected on non-resolve internal routes.
- **DoD (real commands):** mcp `npx tsc --noEmit` + `npm test` green; backend `npx tsc --noEmit` + `npm run lint` + module tests green.

---

# GATE A → B (objective; all must be green)

- [ ] Both seams operational: `CredentialResolver` dispatch + `AuthenticationMaterializer` in the pipeline.
- [ ] F-1 closed: no `Authorization: Bearer` hardcode; placement honored (grep `Bearer ` in `core/http.ts` → 0).
- [ ] F-2 closed: `.reveal()` only in `authentication-materializer.ts` (CI-grep allowlist updated in `credential-boundary-review.md`; grep `.reveal()` outside that file → 0 in core/transport).
- [ ] `forwarded` unchanged: Cloudbeds/Nevatal observable behavior identical; existing tests green.
- [ ] `reference` path proven end-to-end against a **test/echo provider** (no Siigo).
- [ ] Backend resolve endpoint live (Hop-B), reference store single-use + TTL enforced (tests).
- [ ] `tsc` + `lint` + tests green in **both** repos.
- [ ] Descriptor enforcements in place: `.strict()`, exhaustive placement switch (`assertNever`), conformance JSON round-trip.
- [ ] No ADR modified; no Siigo-specific code present.

---

# PHASE B — Siigo (evidence-driven; gates are mandatory, not recommendations)

> **Operating rule for this phase.** Work strictly by the roadmap below. Do not advance provider
> implementation or author the API contract before its gate is green. Treat every gate as mandatory.
> If a gate is blocked by **missing external evidence**, STOP at that gate and state exactly what
> evidence is missing. **Never** substitute Observed evidence with documentation, SDKs, or inference.

> **Phase B splits two kinds of work.** *Discovery* (B0–B2) **produces** provider knowledge;
> *Implementation* (B3–B5) **consumes** it. Same separation as ADR → Feature Design → Sandbox
> Verification → API Contract, replicated at execution level.

### — DISCOVERY —

## B0 — Internal Readiness + External Prerequisites
**Objective:** lock everything that does NOT depend on Observed facts, so B1 is pure execution and B3
is pure translation. **Two parts:**

**B0-internal (fact-free — do now):** *knowledge, not stub code.*
- **Curated read-tool set (locked, product decision from the Feature Design):**
  `mcp_siigo_list_customers` / `mcp_siigo_get_customer`, `mcp_siigo_list_invoices` /
  `mcp_siigo_get_invoice`, `mcp_siigo_list_products` / `mcp_siigo_get_product`. (`get_*` existence is
  confirmed in B1, checklist step 5.)
- **No `contextSchema`** — one Siigo credential = one company/NIT (cardinality rule).
- **Architecture boundary (binding):** thin passthrough adapter — tools return the provider's `data`
  **verbatim** (Fidelity over Unification, `canonical-provider-pattern`). **No** `mapper.ts`, **no**
  internal canonical DTOs (`CustomerSummary`…), **no** hand-written output schemas. Uniform input is
  `page`/`pageSize` only; provider-specific filters are added in B3 from the contract.
- **Per-tool B1 evidence map:** each tool's B3 body needs exactly — the base URL + resource path
  (Q-2), pagination param names (Q-4), and (for `get_*`) the by-id path shape. Nothing else.

> **Deliberately NOT in B0:** stub code files (`auth.ts`/`client.ts`/`provider.ts`) — they cannot
> compile without B1 facts (the `credential_exchange` descriptor needs `tokenEndpoint`/`bodyFields`),
> and pre-scaffolding them is the pre-abstraction `soul.md` cautions against. B3 scaffolds + fills in
> one pass (`add-provider`).

**B0-external (the blocker — owned by Siigo/xcale, not this repo):**
- A working Siigo **test account** with `userName` + `accessKey`.
- The **`Partner-Id`** Siigo assigned to xcale.
- Ability to execute real calls and capture request/response evidence.

**GATE B0 → B1**
- [ ] B0-internal locked (above). External: credentials + `Partner-Id` available, real calls runnable.

## B1 — Sandbox Verification  *(turns hypotheses into Observed facts)*
**Objective:** execute the full [`sandbox-verification.md`](sandbox-verification.md) checklist and record
evidence. Covers: auth (body field names), token (fields + TTL), base URL, endpoint/flavor, `Partner-Id`,
pagination params, error shapes, rate limits.
**Output:** every Q-1..Q-4 datum in state **Observed**, each citing its evidence (request/response capture).

**GATE B1 → B2**
- [ ] Zero remaining hypotheses: every Q-1..Q-4 datum is **Observed** (not documented/inferred) with cited evidence.

## B2 — API Contract  *(BLOCKED BY B1 — documents, does not discover)*
**Objective:** author `docs/design/siigo-read-only-provider/api-contract.md` using **only** B1's evidence:
endpoints, request/response, auth, pagination, error model, headers, schemas. Nothing is discovered here.

**GATE B2 → B3**
- [ ] `api-contract.md` exists and contains **zero** unverified values (every concrete value traces to B1 evidence).

### — IMPLEMENTATION (consumes B2; pure translation, no discovery) —

## B3 — Provider Adapter  *(BLOCKED BY B2 — a translation of the contract)*
Slice-level (per-file detail authored at Gate B2→B3 against the frozen contract):
| Slice | Repo | Deliverable (all derived from the contract) |
|:--|:--|:--|
| B3.1 | mcp | `src/providers/siigo/` (manifest, `credential_exchange` auth, client, read tools, errors, `__fixtures__/`, conformance) + one line in `providers/index.ts` |
| B3.2 | mcp | Read tools: customers/invoices/products (list+get) — input filters + passthrough `data` from the contract (NO mapper/DTO — Fidelity over Unification) |
| B3.3 | be | Register Siigo `credential_exchange` provider; connect flow (`userName`+`accessKey`, validate by minting once); `Partner-Id` from deployment config; catalog `credentialDelivery: reference` |

## B4 — Integration  *(BLOCKED BY B3)*
The A9b deferral lands here: `mcp-tool-executor` **reference emission** — for `reference` providers,
send a single-use reference (via the reference store) instead of the token, + one transparent retry on
`reference_invalid`; backend catalog reads `credentialDelivery`.

## B5 — E2E  *(BLOCKED BY B4)*
Validate the full reference path end-to-end with the first real reference provider: resolve endpoint ↔
reference flow ↔ `credential_exchange` mint ↔ tool execution ↔ error mapping ↔ token expiry/refresh ↔
revocation (reconnect). First time the reference path is proven e2e (impossible before a real reference
provider existed).

## FINAL GATE (Phase B done)
- [ ] Tests + e2e green in both repos.
- [ ] Siigo provider operational (read-first); reference path validated e2e.
- [ ] Docs synchronized (contract, CONTEXT.md, security review).
- [ ] Prod-soak criteria (see Feature Design §9 gate) met before opening the Slice 2 write-path.

---

## Risks & rollback

| # | Risk | Mitigation / Rollback |
|:--|:--|:--|
| RP-1 | The `ctx.request` seam change touches every provider client | Foundation-first; migrate Cloudbeds+echo in one slice (A6) with regression tests; `forwarded` default keeps behavior |
| RP-2 | Transport refactor breaks an in-flight provider | `forwarded` resolver = identity + `bearer_header` materialization reproduces today's exact request; `cloudbeds.test.ts` is the guard |
| RP-3 | Reference path adds a cross-repo hop | Proven against echo first (A9), Siigo later; one retry bounded |
| RP-4 | Backend resolve endpoint is a new unauth-sensitive surface | Hop-B constant-time; `X-Provider-Token` rejected there; reference single-use + TTL |
| Rollback | Phase A is additive + behind `credentialDelivery` default `forwarded` | Revert the branch; no data migration incurred (reference store is ephemeral) |

## Execution rule (from the phase instruction)

1. Build **all of Phase A** now; stop at **Gate A**. 2. Wait only on the sandbox for **B1**. 3. Author
the contract. 4. Build **B2**. No cross-phase mixing; no partial Siigo before the contract. If
implementation surfaces a contradiction with an ADR → **halt that branch only**, state the evidence,
name the minimal artifact to reopen; never restart the architecture.
