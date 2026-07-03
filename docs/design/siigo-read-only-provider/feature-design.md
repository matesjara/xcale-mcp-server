# Siigo Read-Only Provider (Reference-Model Slice 1) — Feature Design

> **Feature**: Onboard Siigo (Colombian accounting / electronic invoicing) as the first `reference`-strategy provider on xcale-mcp-server, read-only, to validate the credential-delivery architecture end-to-end.
> **Priority**: P1 High
> **Owner**: Juan José (design lead)
> **Status**: Draft
> **Target Release**: Slice 1 — Infrastructure Validation
> **Last Updated**: 2026-07-02

---

> **Architectural guardrail (binding).** This design introduces **no new architectural concept** — it
> only *instantiates* decisions already fixed in
> [credential-delivery-strategies](../../adr/credential-delivery-strategies.md) and its sibling ADRs.
> If implementation surfaces a need for a third delivery strategy, another resolver, a Siigo-specific
> exception in the core, or an expansion of `credential_exchange`, **stop and reopen the ADR** — do not
> absorb architecture into this feature.
>
> **Method principle behind read-first.** *The first slice of a new architectural capability minimizes
> the irreversibility of the domain that consumes it.* We validate the credential-delivery machinery on
> non-destructive reads before letting it touch irreversible fiscal operations. (Candidate for
> `.claude/rules/soul.md`.)

---

## 1. Problem Statement

### What's happening?

xcale can onboard LATAM providers as MCP tools cheaply *when they are standard-risk* (Nevatal, Cloudbeds
use the `forwarded` strategy). But **financial providers cannot be onboarded the same way**: the
[credential-forwarding-and-token-model](../../adr/credential-forwarding-and-token-model.md) ADR set a
**hard gate** — ephemeral references / just-in-time resolution must exist before the first financial
provider (ePayco, Siigo). Siigo is the first financial provider in demand, so onboarding it is blocked
until the `reference` delivery model exists on both sides of the boundary.

Siigo also has a credential shape neither the `forwarded` model nor the existing
`api_key|bearer|oauth2` descriptor covers: a durable `userName`+`accessKey` that mints a **24h JWT** via
a token endpoint, plus a `Partner-Id` header on every call.

### Who's affected?

- **xcale SMB customers** in Colombia who keep their books in Siigo and want the agent to answer
  accounting questions (a customer's invoices, a product's price, an account balance).
- **The AI agent**, which today has no accounting capability for these tenants.
- **xcale engineers**, who must cross the highest-risk boundary in the platform (a real financial
  credential) safely.

### What's the cost of inaction?

No accounting capability for Colombian tenants (a core LATAM segment), and — worse — pressure to ship
Siigo on the `forwarded` model, which would put a reusable financial credential in the Execution
Engine's memory/logs and silently erode the gate the architecture committed to.

---

## 2. Goals & Success Metrics

### North Star

The `reference` credential-delivery model is proven in production on a real financial provider — the
Execution Engine never holds a reusable credential — and the agent can read Siigo data for a connected
tenant.

### Metrics

| Type | Metric | Target | How Measured |
|:--|:--|:--|:--|
| **Leading** | Reference resolution success rate (resolve callback) | ≥ 99% (excl. genuine auth failures) | Rail A resolve-endpoint metrics |
| **Leading** | Read tools functional end-to-end (`tools/call` → Siigo → data) | 100% of shipped tools | Conformance + prod smoke |
| **Leading** | Credential present in telemetry (logs/traces/errors) | **0 occurrences** | Grep a known token value across prod sinks → 0 hits |
| **Lagging** | Gate criteria (§9) all green | All pass | Gate checklist in prod after soak |
| **Lagging** | Added resolution latency per `tools/call` (p95) | ≤ 150 ms | Compare `reference` vs `forwarded` call timing |

---

## 3. Target Users

### AI Agent (tool consumer)

- **Context**: A conversation where a Colombian tenant asks about their accounting data.
- **Motivation**: Answer with real Siigo data via a `tools/call`.
- **Pain Today**: No Siigo tools exist.
- **Expected Benefit**: A curated set of read tools it can call like any other provider — the `reference` machinery is invisible to it.

### xcale SMB customer (connection owner)

- **Context**: Connecting their Siigo account in xcale once, then asking the agent questions.
- **Motivation**: "What did customer X buy? What's my invoice #123?" without opening Siigo.
- **Pain Today**: Manual lookups in Siigo Nube.
- **Expected Benefit**: Conversational read access to their books; a clear reconnect prompt if their key is revoked.

### xcale engineer (boundary operator)

- **Context**: Building/operating the credential boundary across both repos.
- **Motivation**: Prove the reference model is safe before fiscal writes.
- **Pain Today**: The gate blocks financial providers; no reference plumbing exists.
- **Expected Benefit**: A validated, reusable model for every future financial provider (ePayco next).

---

## 4. User Stories

### Must Have (P0)

- **US-01**: As an SMB customer, I want to connect my Siigo account (paste `userName` + `accessKey`) so the agent can read my accounting data.
- **US-02**: As the agent, I want to list/get Siigo customers, invoices, and products so I can answer accounting questions.
- **US-03**: As an engineer, I want the Execution Engine to resolve a short-lived reference (never receive the durable credential) so a compromised server has no reusable secret.
- **US-04**: As an SMB customer, when my `accessKey` is revoked, I want a clear "reconnect Siigo" prompt instead of an opaque error.
- **US-05**: As an engineer, I want a single-use, TTL'd reference so a captured `tools/call` is useless within ≤60s.

### Should Have (P1)

- **US-06**: As the agent, I want to read Siigo reference data (account groups, taxes, document types) so future flows have the lookups they need.

### Could Have (P2)

- **US-07**: As an engineer, I want the resolution latency surfaced as a metric so I can watch the added round trip.

---

## 5. Feature Scope (MoSCoW)

### ✅ Must Have — Slice 1

- [ ] **`reference` strategy plumbing (server):** `credentialDelivery` on the auth descriptor; `CredentialResolver` seam with `ForwardedCredentialResolver` (near-identity, existing behavior) + `ReferenceCredentialResolver`; dispatch `resolvers[provider.auth.delivery].resolve()` → uniform `ResolvedCredential`.
- [ ] **`reference` plumbing (Rail A / xcale-backend):** `POST /internal/credentials/resolve` (Hop-B auth); generic `credential_exchange` mint executor (mint/reuse/refresh the 24h JWT, cached); ephemeral-reference store (Mongo TTL index, single-use); send a reference (not the token) in `X-Provider-Token` for `reference` providers.
- [ ] **`credential_exchange` descriptor variant** (additive, strictly declarative).
- [ ] **Siigo adapter** `src/providers/siigo/` (manifest, auth, client, tools, errors, `__fixtures__/`, conformance) + one line in `src/providers/index.ts`.
- [ ] **Read tools:** `list_customers`/`get_customer`, `list_invoices`/`get_invoice`, `list_products`/`get_product`.
- [ ] **Error mapping** reusing `mapHttpStatusToErrorCode`, honoring the error-ownership boundary (resolve-time mint failure → `PROVIDER_AUTH_EXPIRED`; reference/transport failure → transport layer, one retry, no `ToolResult`).
- [ ] **Connect flow** in Rail A: `userName` + `accessKey` capture; validate by minting once.
- [ ] **Gate criteria (§9) instrumented and passing** in prod.

### 🟡 Should Have — High Value

- [ ] Reference-data read tools: `list_account_groups`, `list_taxes`, `list_document_types` (curated; useful for the Slice 2 write path).
- [ ] Resolution-latency metric on the resolve callback.

### 🔵 Could Have

- [ ] `list_cost_centers`, `list_price_lists`, `list_payment_types` reference reads.

### ⛔ Won't Have — Explicit Out of Scope

- **Write / fiscal operations** (`create_invoice`, credit notes) — irreversible, DIAN-reported; **own ADR + Slice 2**. Bundling it would confuse "did the credential model fail or the fiscal logic?".
- **Full RFC 8693 token exchange** — the wire shape is already reference-based; hardening the internal mechanism is deferred (ADR alternative E).
- **`contextSchema` / multi-company per connection** — one Siigo credential = one company (NIT); multiple companies = multiple connections (Rail A), not per-call metadata.
- **Universalizing `reference`** to `forwarded` providers (Nevatal/Cloudbeds stay `forwarded`) — opt-in per provider until the balance shifts.
- **A read-only Siigo credential scope** — Siigo access keys are not scope-limited; the blast radius is bounded by the reference model, not by tool selection (see R-3).

---

## 6. UX & Interaction Design

> Mostly a backend/boundary feature. The user-facing surface is the Rail A connect form; the agent
> surface is the tool contract; the operator surface is telemetry. Described narratively below.

### 6.1 Connect flow (Rail A)

The user opens the Siigo connection in xcale and sees a credential form (the Connect Descriptor,
driven by the published `authDescriptor`): two fields, **API Username** (`userName`) and **Access
Key** (`accessKey`), with a link to "Siigo Nube → Partnerships → My API Credential". `Partner-Id` is
**not** shown — it is xcale's institutional identity, injected from deployment config, not the user's.

On submit, Rail A validates by **minting once** against Siigo's token endpoint. Success → the
connection is stored (durable credential encrypted at rest, `authMethod: credential_exchange`,
`credentialDelivery: reference`) and the UI shows "Connected". Failure (bad key, Siigo down) → an
inline error; nothing is stored.

**Empty/disconnected state**: a "Connect Siigo" card. **Loading**: the submit button shows a spinner
during the validation mint. **Error**: the mint's failure reason (invalid credentials vs provider
unavailable), localized.

### 6.2 Agent tool-call flow (the reference model, made concrete)

The agent calls e.g. `mcp_siigo_list_invoices`. Rail A prepares the `tools/call`: it generates a
**single-use ephemeral reference** (opaque nonce, ≤60s TTL, mapped to this connection) and sends it in
`X-Provider-Token` (Hop-B `Authorization` for the server itself). The Execution Engine's
`ReferenceCredentialResolver` calls back `POST /internal/credentials/resolve`; Rail A validates the
reference (single-use, unexpired), mints or reuses the 24h JWT, returns it; the server wraps it as a
`ResolvedCredential` (`SecretString`), attaches `Authorization: Bearer <jwt>` + `Partner-Id`, calls
Siigo, maps the result, and discards the credential. From `ResolvedCredential` onward the pipeline is
identical to a `forwarded` provider — the agent sees only the tool result.

### 6.3 Reconnect (auth failure)

If the durable credential was revoked, the mint fails **at resolve time**. The server returns
`PROVIDER_AUTH_EXPIRED` (provider-owned failure), the backend maps it to
`markConnectionAuthFailure()`, and the agent surfaces a "reconnect Siigo" prompt — identical to a
`forwarded` provider's 401, even though no Siigo data call ever ran.

### 6.4 Reference/transport failure (invisible)

If a reference expires or was already consumed, the backend retries **once** with a fresh reference,
transparently; the agent never sees it. A second failure surfaces as a transport/protocol error — never
a `ProviderErrorCode`, no `ToolResult`.

### 6.5 Key Interactions

| Interaction | Trigger | Behavior |
|:--|:--|:--|
| Connect Siigo | Submit `userName`+`accessKey` | Rail A mints once to validate; store on success, inline error on failure |
| Reference resolution | Any Siigo `tools/call` | Server callback → Rail A validates + mints/reuses → returns JWT → single-use reference consumed |
| Reconnect prompt | Resolve-time mint fails (revoked key) | `PROVIDER_AUTH_EXPIRED` → `markConnectionAuthFailure()` → agent reconnect prompt |
| Silent retry | Expired/consumed reference | Backend regenerates reference, retries once; agent unaware |

---

## 7. Data Model Sketch

### Entities

#### Siigo Connection (Rail A / xcale-backend)

| Field | Type | Description |
|:--|:--|:--|
| durable credential | encrypted (`userName`+`accessKey`) | The crown jewel — never leaves Rail A |
| authMethod | `credential_exchange` | Mirrors the descriptor variant |
| credentialDelivery | `reference` | Drives strategy dispatch on both sides |
| cachedToken | encrypted (JWT) + expiresAt | The 24h JWT, reused until near expiry |
| accountKey | string (NIT / company) | Distinguishes multiple Siigo companies as separate connections |

#### Ephemeral Reference (Rail A / Mongo, TTL)

| Field | Type | Description |
|:--|:--|:--|
| reference | opaque high-entropy nonce | The value on the wire (`X-Provider-Token`) |
| connectionId | ref → Siigo Connection | Resolution target (not a token) |
| expiresAt | Date (TTL index, ≤60s) | Auto-expiry |
| consumedAt | Date? | Single-use marker |

#### ResolvedCredential (server, transient — never persisted)

| Field | Type | Description |
|:--|:--|:--|
| secret | `SecretString` | The usable credential (JWT); `.reveal()` only at Siigo egress |
| (request-scoped) | — | One per `tools/call`, reused across egresses, discarded at end |

#### `credential_exchange` authDescriptor (server, published in catalog — non-secret)

| Field | Type | Description |
|:--|:--|:--|
| type | `credential_exchange` | Variant discriminator (fixed) |
| tokenEndpoint | string | The mint endpoint — **TBD, verified in the API contract (Q-2)** |
| method | `POST` | HTTP method for the mint (fixed) |
| bodyFields | map (logical→wire) | Credential field mapping — **TBD, verified against the official Siigo sandbox before publication (Q-1)** |
| responseFields | map | Token + expiry keys — **TBD, verified in the API contract (Q-1)** |
| staticHeaders | array `{name, source}` | `{ name: "Partner-Id", source: "deployment" }` (header name fixed; value is deployment config) |
| tokenPlacement | `bearer_header` | Minted JWT applied as `Authorization: Bearer` (fixed) |

### Relationships

```
Siigo Connection ──has many──▶ Ephemeral Reference (single-use, TTL)
Ephemeral Reference ──resolves to──▶ Siigo Connection ──mints/reuses──▶ JWT
JWT ──wrapped as──▶ ResolvedCredential ──used by──▶ Provider Runtime (server)
```

---

## 8. Architectural Decisions

> All rows **instantiate** [credential-delivery-strategies](../../adr/credential-delivery-strategies.md)
> — none is a new architectural decision (per the guardrail).

| # | Decision | Choice | Rationale |
|:--|:--|:--|:--|
| AD-1 | Delivery strategy | `reference` (opt-in, Siigo only) | Financial provider; server must not hold a reusable credential (ADR) |
| AD-2 | Resolution transport | Hop-B callback `POST /internal/credentials/resolve` | First-consumer implementation of `CredentialResolver → Credential Authority`; replaceable later (ADR) |
| AD-3 | Reference store | Rail A Mongo TTL index, single-use | No new infra (*complexity on demand*); custody stays in Rail A |
| AD-4 | Mint ownership | Rail A (Credential Authority) mints/reuses/refreshes, caches 24h JWT | Durable credential never leaves Rail A |
| AD-5 | Auth descriptor | `credential_exchange`, strictly declarative | Knowledge in server, additive contract; no DSL (ADR) |
| AD-6 | `Partner-Id` | Non-secret institutional identity, `source: deployment`, out of catalog | Not custody; consumer-agnostic contract |
| AD-7 | Context | No `contextSchema` (1 connection → 1 company) | Cardinality rule; multi-company = multiple connections |
| AD-8 | Tool scope | Read-only, curated | First-slice minimizes domain irreversibility |
| AD-9 | Error model | Error-ownership boundary; reuse `mapHttpStatusToErrorCode` | No change to `ProviderErrorCode` set |

---

## 9. Risks & Open Questions

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|:--|:--|:--|:--|:--|
| R-1 | Added round-trip latency on every Siigo `tools/call` | Med | Med | Same-region resolve; measure p95 (§2); reuse cached JWT (no mint per call) |
| R-2 | Siigo `/auth` rate limits hit if we mint too often | Med | Med | Rail A caches the 24h JWT and re-mints near expiry only; back off on 429 |
| R-3 | Siigo access keys are not read-only — a resolved JWT can write | High | Med | Bounded by the reference model (single-use, ≤60s, request-scope); read-only *tools* limit the agent, not the credential — accepted for Slice 1, documented |
| R-4 | Credential leakage via telemetry | Low | High | `SecretString` firewall + pino redaction + no `tools/call` body logging; **gate-verified by grep** (§ below) |
| R-5 | Cross-repo drift (server strategy vs backend dispatch) | Med | Med | `credentialDelivery` published in catalog → single declaration drives both sides |

### Code-audit findings (confirmed; resolve in implementation)

Two latent gaps found while auditing the current runtime. Neither is a new architectural decision —
both are instantiation-level and are resolved in the Implementation Plan.

| # | Finding | Resolution (Implementation Plan) |
|:--|:--|:--|
| F-1 | `requestJson` hardcodes `Authorization: Bearer` ([`core/http.ts`](../../../src/core/http.ts)); the descriptor already models `placement`, but only Bearer is applied. Siigo (Bearer JWT) hides it; the next non-Bearer provider breaks silently. | Remove the hardcode; honor the descriptor's declared `placement`. |
| F-2 | `SecretString.reveal()` runs inside the generic HTTP helper (`core/http.ts`), contradicting the security review's "reveal at a single dedicated point" control. | Consolidate `.reveal()` into a single dedicated auth-application point during authentication materialization (seam defined in the Implementation Plan); `requestJson` loses its `token` param and `.reveal()`. Update the CI-grep allowlist in `credential-boundary-review.md`. |

### Open Questions

| # | Question | Needed By | Owner | Resolution |
|:--|:--|:--|:--|:--|
| Q-1 | Exact `/auth` wire field names — `userName`/`accessKey` (SDK) vs `username`/`access_key` (raw API docs)? | API contract | Eng | **Pending** — verify against Siigo sandbox; feeds `bodyFields` |
| Q-2 | Base URL — `https://api.siigo.com/v1` vs `https://services.siigo.com/alliances/api/v1`? | API contract | Eng | **Pending** — verify against sandbox |
| Q-3 | Exact `Partner-Id` value/registration for xcale (3–100 alphanumerics, camelCase) | Connect flow | Eng/Founder | **Pending** — register with Siigo |
| Q-4 | Siigo pagination param names + published rate limits | API contract | Eng | **Pending** — confirm from docs/sandbox |
| Q-5 | Which reference-data reads are actually needed by Slice 2's write path? | Slice 2 | Eng | Defer — informs Should-have curation |

### Verification acceptance criteria (Q-1–Q-4 — evidence, not documentation)

Q-1..Q-4 are **fact-discovery, not engineering decisions**. The API contract must *reflect what the
sandbox returned*, never *choose* between documented alternatives (the two Siigo "flavors" are exactly
why doc-only is insufficient). A question is not "resolved" until the evidence below exists:

| Q | Required evidence |
|:--|:--|
| Q-1 | A successful auth capture showing the **exact accepted body** (`userName` vs `username`, `accessKey` vs `access_key`) and the exact token/expiry response keys. |
| Q-2 | The base URL of a **successful live call**, not documentation. |
| Q-3 | Administrative confirmation of xcale's assigned `Partner-Id`, verified working on **both** `/auth` **and** a data endpoint. |
| Q-4 | Real paginated calls (>1 page where possible), observing the actual pagination params and relevant headers/codes (incl. rate-limit signals). |

> **Contract discipline (guardrail for the downstream API contract).** The API contract is
> **descriptive, not speculative.** Every concrete value — URL, field names, headers, response shapes,
> provider-specific error codes — must come from a sandbox verification or unambiguous official
> evidence. This is the contract-level twin of the architectural guardrail at the top of this doc: the
> Feature Design introduces no architecture; the API contract introduces no assumptions.

### Gate criteria (open Slice 2 only when all green, after prod soak)

- [ ] Reference resolution works end-to-end in prod (a real Siigo `tools/call` returns data).
- [ ] A reused / expired reference is **rejected** (negative test in prod, not just unit).
- [ ] Credential **absent from real telemetry**: grep a known token value across prod logs/traces/errors → **0 hits**.
- [ ] `PROVIDER_AUTH_EXPIRED` → reconnect round-trips with Rail A.
- [ ] Soak with real traffic (aligns with the `/git-workflow` prod-soak before archival).

---

## 10. Phasing & Roadmap

| Phase | Scope Summary | Key Deliverables | Dependencies | Est. Effort |
|:--|:--|:--|:--|:--|
| **Slice 1 (this doc)** | Reference model + Siigo read-only | Reference plumbing (both repos), `credential_exchange`, Siigo adapter + read tools, connect flow, gate criteria | ADR `credential-delivery-strategies` | L |
| **Gate** | Prove `reference` in prod | All §9 gate criteria green after soak | Slice 1 shipped | — |
| **Slice 2 (future, own ADR)** | Siigo fiscal writes | `create_invoice` + confirmation, idempotency, duplicate detection, partial-success, compensability | Gate passed | XL |

---

## 11. Agentic Context

### Related Modules

| Module | Relationship | Key Files |
|:--|:--|:--|
| MCP server core | Adds `CredentialResolver` seam + strategy dispatch | `src/core/`, `src/providers/index.ts` |
| Reference provider | Pattern to copy | `src/providers/cloudbeds/` |
| Rail A (xcale-backend) | Credential Authority: resolve endpoint, mint executor, reference store | `xcale-backend/src/modules/connections/` |
| Error contract | Honored unchanged | `src/core/errors.ts`, `src/protocol/result-mapping.ts` |

### Codebase Entry Points

- **New provider**: `src/providers/siigo/` — manifest, auth (`credential_exchange`), client, tools, errors, `__fixtures__/`, conformance test.
- **Core seam**: the `CredentialResolver` dispatch (server) — instantiates the ADR; no per-provider branching.
- **Backend**: `xcale-backend/src/modules/connections/` — resolve endpoint, generic `credential_exchange` executor, reference store, strategy-aware `X-Provider-Token` emission.

### Conventions to Follow

- **Provider pattern**: `canonical-provider-pattern` ADR — single-source zod schemas, typed handlers, explicit pagination, fidelity-over-unification, DI + fixtures + conformance.
- **Security**: `docs/security/credential-boundary-review.md` — `SecretString`, `.reveal()` only in `src/providers/**`, pino redaction, no `tools/call` body logging.
- **Curation**: author-time — declare only the read tools that matter.
- **Naming**: tools `mcp_siigo_{verb}`; kebab-case files; `IPascalCase` interfaces.

### Next Steps After Approval

1. **Resolve Q-1/Q-2/Q-3/Q-4** against a Siigo sandbox (blocks the API contract).
2. **`/api-contract-authoring`** → `docs/design/siigo-read-only-provider/api-contract.md` — the wire surface for the resolve endpoint, the `credential_exchange` descriptor, and the Siigo tool schemas.
3. **`/implementation-plan`** → the cross-repo file tree + ordered slices.
4. **Implement** → server adapter + core seam, then Rail A plumbing; conformance + prod gate.

### Referenced Docs

- ADRs: [credential-delivery-strategies](../../adr/credential-delivery-strategies.md), [credential-forwarding-and-token-model](../../adr/credential-forwarding-and-token-model.md), [provider-knowledge-vs-credential-custody](../../adr/provider-knowledge-vs-credential-custody.md), [canonical-provider-pattern](../../adr/canonical-provider-pattern.md), [typed-tool-result-error-contract](../../adr/typed-tool-result-error-contract.md)
- Security: `docs/security/credential-boundary-review.md`
- Glossary: `CONTEXT.md`
- Provider docs: Siigo API — https://developers.siigo.com/
