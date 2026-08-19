# Siigo — ready-to-paste PR bodies

> Four PR descriptions, ready for the PR agent. Base branch `dev` (repos currently on
> `integration/all-20260812`, uncommitted). File lists are exact per `git status`. Land order:
> 1 → 2 (mcp-server) and 3 → 4 (backend); PR 4 shares `mcp-bootstrap.ts` with PR 3 (land 3 first, or
> combine 3+4). No migrations. Full state + rationale: `ship-log.md` (same folder).

---

## PR 1 · docs: Siigo design, B1 evidence, API contract & write-path ADR

**Repo:** xcale-mcp-server · **Type:** docs-only

Phase-B design artifacts for the Siigo read-only provider (first `reference`-strategy provider). Records
the sandbox-Observed facts, the frozen read contract, the drift-grill corrections, and the write-path
architecture decision. No code.

**Files**
- `docs/design/siigo-read-only-provider/b1-sandbox-evidence.md` (new) — Observed facts: auth/token/Partner-Id/pagination/errors (§0-7), reference-data endpoints (§8), extra read resources (§9)
- `docs/design/siigo-read-only-provider/api-contract.md` (new) — frozen read contract; §A-D + §C.3 reference-data + §C.4 resources
- `docs/design/siigo-read-only-provider/ship-log.md` (new) — PR handoff + build log
- `docs/design/siigo-read-only-provider/pr-bodies.md`, `write-path-grill-prep.md` (new) — staging artifacts
- `docs/adr/fiscal-write-path.md` (new) — ADR (Proposed): thin MCP passthrough, consumer-owned write safety
- `traceability-matrix.md`, `feature-design.md`, `implementation-plan.md`, `sandbox-verification.md`, `implementation-playbook.md`, `docs/adr/credential-delivery-strategies.md` (modified) — drift-grill corrections

**Notes:** unnumbered ADR (`fiscal-write-path.md`) — run `npm run adr:number -- --apply` before opening to `dev`. Ship-log & bodies are staging notes; safe to keep in the folder or drop.

---

## PR 2 · feat(siigo): read-only provider — 19 tools

**Repo:** xcale-mcp-server · **Depends on:** Phase A (in `dev`)

Onboards Siigo as a read-only MCP provider. Self-contained per Provider Self-Containment (one module +
one registry line). All wire values are Observed against the live sandbox (Flavor A, `api.siigo.com`);
every tool is passthrough-verbatim (Fidelity over Unification). 19 read tools: 6 resource list/get
(customers, invoices, products) + 8 reference-data + 5 additional resources.

**Files**
- `src/providers/siigo/` (new) — `manifest.ts`, `auth.ts` (`credential_exchange` descriptor, `credentialDelivery: reference`), `client.ts` (Partner-Id on data egress), `errors.ts`, `tools.ts` (19 tools), `provider.ts`, `index.ts`, `__fixtures__/`, `__tests__/siigo.test.ts` (23 tests)
- `src/providers/index.ts` (modified) — register `siigoProvider`
- `src/config.ts` (modified) — `siigoPartnerId`
- `.env.example` (modified) — `SIIGO_PARTNER_ID`
- `assets/siigo.svg` (new) — provider logo
- `src/protocol/__tests__/http.test.ts`, `mcp.integration.test.ts` (modified) — add `siigoPartnerId: ''` to inline `Config` literal

**Gate:** `tsc --noEmit` + prettier clean; full suite **250/250 green**. `manifest.schemaVersion 2026-08-13.2`, `providerVersion 0.3.0`.

**Config (Doppler, not code):** set `SIIGO_PARTNER_ID` (sandbox `EcomerceCG`). Verified end-to-end live: the agent ran `mcp_siigo_list_customers` and returned real sandbox data.

---

## PR 3 · feat(connections): Siigo credential_exchange registration & connect

**Repo:** xcale-backend · **Depends on:** Phase A (in `dev`)

Net-new Rail A wiring for the `credential_exchange` strategy (durable credential → minted short-lived
JWT). Distinct from the forwarded single-secret rail, which structurally rejects it (reads `fields` not
`bodyFields`, one-secret-only, forwards the pasted secret as a bearer token instead of minting). Connect
validates by **minting once**; the durable `username`+`access_key` is stored as JSON in `credentialSecret`
(encrypted); the mint descriptor is **pinned backend-authoritative** (never network-sourced — the durable
credential is POSTed to `tokenEndpoint`, so the endpoint must not be redirectable).

**Files**
- `src/modules/connections/credential-exchange-providers.ts` (new) — pinned Siigo descriptor registry + connect fields + `descriptorFor`/`staticHeaderValues` helpers
- `src/modules/connections/credential-registry.ts` (modified) — `ConnectAuthMethod` += `credential_exchange`
- `src/modules/connections/internal-routes.ts` (modified) — wire `descriptorFor` + `staticHeaderValues` (Partner-Id) into `createDefaultResolveService`; fix misleading comment
- `src/modules/mcp/mcp-bootstrap.ts` (modified) — `credential_exchange` router branch + `buildCredentialExchangeConfig`
- `src/modules/mcp/toolboxes.ts` (modified) — Siigo toolbox entry (category `productivity`)
- `src/config/index.ts` (modified) — `SIIGO_PARTNER_ID`
- `src/infrastructure/i18n/locales/en.json`, `es.json` (modified) — `siigo.error.invalid_credentials`
- `src/modules/mcp/__tests__/mcp-bootstrap.credential-exchange.test.ts` (new) — 10 tests (golden cross-repo descriptor pin, validate-by-mint, localized rejection, fail-closed)

**Gate:** `tsc` + prettier + eslint clean; **10 new + 226 connections/i18n green**.

**Config (Doppler):** `SIIGO_PARTNER_ID`; `CREDENTIAL_RESOLVE_URL` on the gateway → this backend's `/internal/credentials/resolve` (scheme must match the backend — https in HTTPS envs); optionally `CREDENTIAL_RESOLVE_SECRET` on both to complete the #216 split.

---

## PR 4 · feat(mcp): reference emission for reference-delivery providers

**Repo:** xcale-backend · **Depends on:** PR 3 (⚠️ shares `mcp-bootstrap.ts` — land PR 3 first, or combine 3+4)

Threads `credentialDelivery` from the discovered catalog through to the tool executor; for `reference`
providers the executor emits a single-use, short-TTL nonce instead of the token — the durable credential
and the minted JWT never leave the backend; the gateway resolves the nonce just-in-time. `forwarded`
providers are unchanged. Reconnect works via the existing path (gateway maps the resolve-time 422 →
`PROVIDER_AUTH_EXPIRED`).

**Files**
- `src/modules/mcp/entities.ts` (modified) — `McpAuthDescriptor` += `credentialDelivery?`
- `src/modules/mcp/mcp-bootstrap.ts` (modified) — project `credentialDelivery` onto `McpProviderRef`
- `src/modules/mcp/mcp-tool-loader.ts` (modified) — thread `credentialDelivery` + injectable `EphemeralReferenceStore` (Mongo default) to the executor
- `src/modules/mcp/mcp-tool-executor.ts` (modified) — `resolveWireToken`: mint a nonce for `reference`, decrypt+send the token for `forwarded`; fail loud if a reference provider has no store
- `src/modules/mcp/__tests__/mcp-tool-executor.reference.test.ts` (new) — 6 tests

**Gate:** `tsc` + prettier + eslint clean; **full mcp module 87/87 green**.

**Deferred follow-up (not in this PR):** one-retry-on-`reference_invalid` — needs a typed cross-repo `reference_invalid` code (the gateway currently throws a generic `ReferenceResolutionError`); a blind retry would be wrong.
