# Provider Implementation Playbook (Phase A infra → a new adapter)

> **Purpose.** Turn B3–B5 into a near-mechanical procedure so that, once the API contract exists, the
> implementation is a *translation*, not a series of small decisions. **Provider-agnostic**: this
> describes how to land any provider on the Phase A machinery (reference template: `src/providers/cloudbeds/`).
> Extract to the `add-provider` skill once validated across a second real provider (N=2 discipline).
>
> **Discipline.** Every concrete value comes from `api-contract.md` (which comes only from B1 Observed
> facts). This playbook contains **zero** provider facts — only order, seams, and gates.

## Ordering (mandatory; each step gates the next on green tests)

### B3 — Provider Adapter (mcp-server)

| # | Step | Artifact consumed | Files (mcp-server) | Definition of Done |
|:--|:--|:--|:--|:--|
| 1 | Manifest | Feature Design (metadata) | `providers/{slug}/manifest.ts` | slug/displayName/category/versions set; conformance slug regex passes |
| 2 | Auth descriptor | API contract §auth | `providers/{slug}/auth.ts` | `credential_exchange` descriptor with contract's `tokenEndpoint`/`bodyFields`/`responseFields`/`staticHeaders`/`credentialDelivery`; `.strict()` schema accepts it; conformance JSON round-trip passes |
| 3 | Context | cardinality rule | `providers/{slug}/context.ts` | present only if 1 connection → N scopes (Siigo: absent) |
| 4 | Client | API contract §base URL + resource paths | `providers/{slug}/client.ts` | builds `RequestSpec`s (URL shaping only); calls `ctx.request` (never a token/`requestJson`) |
| 5 | Tools | API contract §endpoints + §pagination + curated set | `providers/{slug}/tools.ts` | each read tool: `defineTool`/`definePaginatedList`; input = uniform `page`/`pageSize` + contract filters; handler returns provider `data` **verbatim** (no mapper/DTO) |
| 6 | Errors | API contract §error model | `providers/{slug}/errors.ts` (if any) | reuse `mapHttpStatusToErrorCode`; only provider-specific `success:false` unwrap lives here |
| 7 | Fixtures + conformance | recorded responses (from B1 captures) | `providers/{slug}/__fixtures__/`, `__tests__/{slug}.test.ts` | `runProviderConformance` + per-tool tests green against fixtures |
| 8 | Register | — | `providers/index.ts` (one line) | provider appears in `/discover`; tsc + all tests green |

### B3 — Provider registration (backend, Rail A)

| # | Step | Files (backend) | Definition of Done |
|:--|:--|:--|:--|
| 9 | Credential provider | `connections/providers/{slug}.ts` + register | `credential_exchange` connect: `validate` mints once (userName+accessKey), stores durable cred **encrypted JSON** in `credentialSecret` **whose object keys equal the descriptor's `bodyFields` LOGICAL names** (the same keys `resolve` reads — see correction), `metadata.authMethod='credential_exchange'`; connect flow green |
| 10 | Deployment config | Doppler | `Partner-Id` value + `CREDENTIAL_RESOLVE_URL` (mcp-server) set per env |

> **Correction 2026-08-12 (drift grill) — step 9 pins a cross-repo JSON-shape contract.** Nothing
> currently pins the shape of `credentialSecret`. `resolve` (`credential-resolve.service.ts:89-96`)
> `JSON.parse`s it and hands the object to `mintCredentialExchange`, which
> (`credential-exchange.ts:62-69`) iterates `descriptor.bodyFields` and reads `credentialValues[LOGICAL]`,
> throwing `missing credential value for field "X"` on any key mismatch. **Contract:** connect MUST
> persist `credentialSecret` as a JSON object whose **keys equal the descriptor's `bodyFields` LOGICAL
> names** — the same keys `resolve` reads; **both** connect and resolve MUST read the **one** backend
> descriptor. Author a **golden/contract test** (B3.3 work — noted, not written here) pinning Siigo's
> `bodyFields` logical keys + `tokenEndpoint` host across `src/providers/siigo/auth.ts` and the backend
> mirror. B1 must record the `bodyFields` LOGICAL key names as **first-class Observed evidence**.
>
> **Correction 2026-08-12 (drift grill) — to-do for B3.3: resolve-time `descriptorFor` is a
> backend-authoritative pinned mirror, not a live fetch.** The resolve path POSTs the **durable** Siigo
> credential to `descriptor.tokenEndpoint`; that descriptor MUST be **pinned in backend code/config** (a
> hand-authored mirror of the mcp-server's published descriptor), **never live-fetched** from the
> discovered catalog (a network-fetched `tokenEndpoint` lets an mcp-server compromise/MITM redirect the
> crown jewel — breaks AD-4 and `soul.md` "no dynamic discovery"). When `descriptorFor` is wired, **rewrite
> the misleading comment** at `xcale-backend/src/modules/connections/internal-routes.ts:50-51` ("wired to
> the discovered catalog in Phase B") to read "backend-authoritative pinned mirror, not live-fetched".

### B4 — Integration (backend reference emission — the A9b deferral)

| # | Step | Files | Definition of Done |
|:--|:--|:--|:--|
| 11 | Catalog reads delivery | `mcp/entities.ts` (`McpAuthDescriptor.credentialDelivery`) | discover populates it |
| 12 | Reference emission | `mcp/mcp-tool-executor.ts` | for `reference` providers: create a reference (store) → send as `token`; else `getAccessToken()` (forwarded, unchanged). Unit test: reference provider emits a reference, forwarded emits the token |
| 13 | One-retry | `mcp/mcp-tool-executor.ts` | on a transport `reference_invalid` signal, regenerate + retry **once**; second failure surfaces |

### B5 — E2E

| # | Step | Definition of Done |
|:--|:--|:--|
| 14 | Full reference path | real tools/call → reference → resolve endpoint → mint → provider → data; captured |
| 15 | Reconnect | revoke the durable cred → `PROVIDER_AUTH_EXPIRED` → reconnect prompt round-trips |
| 16 | Reuse/refresh | second call within TTL reuses cached JWT (no re-mint); near-expiry re-mints |
| 17 | Single-use/TTL | a replayed reference is rejected in prod (negative test) |

## Rollback (per step)

- Everything through B3 step 8 is additive + behind the provider registration line — revert the branch; no data migration.
- B4 emission is behind `credentialDelivery === 'reference'` — forwarded providers are untouched; reverting the executor change restores prior behavior.
- The reference store is ephemeral (TTL) — no cleanup needed on rollback.

## Gate-close criteria

- **Gate B3:** provider in `/discover`; conformance + per-tool tests green; forwarded providers unchanged; tsc/lint/format green both repos.
- **Gate B4:** reference emission unit-tested; forwarded path proven unchanged; catalog carries `credentialDelivery`.
- **Gate B5 (Phase B done):** full reference path e2e green; reconnect/reuse/refresh/single-use validated; docs synced; prod-soak criteria (Feature Design §9) met before the Slice 2 write-path opens.

## The one rule that governs all of the above

Each row's "Artifact consumed" is a **contract reference**, never documentation. If a step needs a
value the contract does not carry, the contract is incomplete — **stop and return to B1/B2**, do not
infer.
