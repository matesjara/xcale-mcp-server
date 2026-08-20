# Siigo — Provider Traceability Matrix

> **Purpose.** The single view that answers *"is this Observed fact captured in the contract,
> implemented, and tested?"* The API contract is descriptive; the implementation plan is operational;
> **neither answers traceability — this does.** Rows are seeded from official-doc *hypotheses*
> (confidence-tagged); **nothing here is authoritative** until the `Observed?` column is checked in B1.
>
> **Flow:** B1 fills `Observed value` + flips `Observed?` → B2 fills `Contract §` → B3 fills
> `Code` + `Test` → each row reaches ✅ only when implemented **and** tested against the Observed fact.
> A row that stays `Observed? ⬜` **blocks** its downstream cells.
>
> **Confidence legend** (from `sandbox-verification.md`): **O** Observed · **S** SDK-confirmed ·
> **D** Officially documented · **I** Inferred.

## Auth & transport

| Fact needed | Hypothesis (conf.) | Observed value | Observed? | Contract § | Code | Test |
|:--|:--|:--|:--:|:--|:--|:--|
| API flavor / base URL | `services.siigo.com/alliances/api` (S) **vs** `api.siigo.com` (D) — **conflict** | **`https://api.siigo.com`** (Flavor A public — B never exercised) | ✅ **O** | — | `siigo/auth.ts` `client.ts` | conformance |
| Auth endpoint + method | `POST .../siigoapi-users/v1/sign-in` (S) vs `POST /auth` (D) | **`POST /auth`** | ✅ **O** | — | `siigo/auth.ts` | — |
| Auth body field names | `userName`/`accessKey` (S) vs `username`/`access_key` (D) | **`username` / `access_key`** (snake_case) | ✅ **O** | — | `siigo/auth.ts` (`bodyFields`) | — |
| Token response field | `access_token` (D/I) | **`access_token`** | ✅ **O** | — | `siigo/auth.ts` (`responseFields.token`) | — |
| Token expiry field + TTL | `expires_in`? · TTL 24h (D) | **`expires_in` = 86400** (24h); `token_type: "Bearer"`, `scope: "SiigoAPI"` | ✅ **O** | — | `siigo/auth.ts` (`responseFields.expiry`) | — |
| `Partner-Id` value | integrator app name, 3–100 alnum (D); xcale's = **assigned** | **`EcomerceCG`** (sandbox; alt `BivooRetailSuite`). **NOT required on `/auth`; REQUIRED on data** (`400 header_required`) — mint does not validate it | ✅ **O** | — | deployment config + `staticHeaders` | — |
| Token placement | `Authorization: Bearer` (D) | **`Bearer`** (`token_type: "Bearer"`) | ✅ **O** | — | descriptor `tokenPlacement` | materializer test (exists) |
| **`bodyFields` LOGICAL key names** (JSON-shape contract — see note ↓) | logical keys of the `bodyFields` map (I) — **first-class Observed datum, not just the wire values** | wire keys are **`username`/`access_key`**; adopt logical == wire = **`username`, `access_key`** | ✅ **O** | — | `siigo/auth.ts` (`bodyFields`) + backend mirror | golden/contract test (B3.3, noted-not-written) |
| **Company → credential cardinality** (blocks the `contextSchema` decision — AD-7 / sandbox Q-9) | 1 key → 1 company/NIT? (**hypothesis, unverified**) | **no company list in token; no `companyId`/NIT selector on any endpoint → single-company; `contextSchema` NOT needed** (falsifier did not trigger) | ✅ **O** | — | `siigo/context.ts` (absent — falsifier negative) | — |

> **Correction 2026-08-12 (drift grill) — two rows added.** **(1) `bodyFields` LOGICAL key names:** the
> cross-repo credential-JSON shape is currently unpinned. Backend `connect` persists `credentialSecret` as
> a JSON object and `resolve` (`credential-resolve.service.ts:89-96`) does `JSON.parse(...)` and hands the
> object to `mintCredentialExchange`, which (`credential-exchange.ts:62-69`) iterates `descriptor.bodyFields`
> and reads `credentialValues[LOGICAL]`, throwing `missing credential value for field "X"` on any key
> mismatch. **Contract:** `connect` MUST persist `credentialSecret` as a JSON object whose **keys equal the
> descriptor's `bodyFields` LOGICAL names** — the same keys `resolve` reads; **both** `connect` and
> `resolve` MUST read the **one** backend descriptor. B1 must therefore record the `bodyFields` LOGICAL key
> names as **first-class Observed evidence** (not only the wire values). A golden/contract test (B3.3 work,
> noted-not-written) should pin Siigo's `bodyFields` logical keys + `tokenEndpoint` host across
> `src/providers/siigo/auth.ts` and the backend mirror. **(2) Company → credential cardinality:** blocks
> the `contextSchema` decision (Feature Design AD-7, downgraded to hypothesis); stays `Observed? ⬜` until
> sandbox Q-9 resolves it.

## Pagination & errors

| Fact needed | Hypothesis (conf.) | Observed value | Observed? | Contract § | Code | Test |
|:--|:--|:--|:--:|:--|:--|:--|
| Pagination request params | `page`, `page_size` (D/S) | **`page`** (1-based) + **`page_size`** (snake); default **25**, min **10** (below clamps to 10), `50` honored; camelCase `pageSize` ignored → default 25 | ✅ **O** | — | `siigo/tools.ts` (page/pageSize → wire) | pagination test |
| Pagination response shape | `{ pagination: { page, page_size, total_results }, results: [] }` (D/S) | **`{ pagination:{page,page_size,total_results}, results:[], _links:{self,next,previous?} }`** (uniform across customers/invoices/products) | ✅ **O** | — | `siigo/tools.ts` (list unwrap) | list test |
| Error envelope shape | `Manejo de errores` w/ `Detail`; exact shape unknown (I) | **`{ Status:<int>, Errors:[{ Code, Message, Params:[], Detail }] }`** (401 `unauthorized`; 400 `header_required`) | ✅ **O** | — | `siigo/tools.ts`/`errors.ts` | error test |
| Rate limits | unknown (—) | **429 under burst** (~5 rapid calls); no `Retry-After`/`X-RateLimit-*` headers exposed; ~20s cooldown clears it | ✅ **O** | — | — | — |

## Read tools (curated set — locked in B0-internal)

| Tool | Endpoint hypothesis (conf.) | Observed path | Observed? | Contract § | Code | Test |
|:--|:--|:--|:--:|:--|:--|:--|
| `mcp_siigo_list_customers` | `GET /v1/customers` (D/S) | **`GET /v1/customers`** → envelope §3 | ✅ **O** | — | `siigo/tools.ts` | `siigo.test.ts` |
| `mcp_siigo_get_customer` | by-id path (I) | **`GET /v1/customers/{uuid}`** → object directly (no envelope) | ✅ **O** | — | `siigo/tools.ts` | `siigo.test.ts` |
| `mcp_siigo_list_invoices` | `GET /v1/invoices` (D/S) | **`GET /v1/invoices`** → envelope §3 | ✅ **O** | — | `siigo/tools.ts` | `siigo.test.ts` |
| `mcp_siigo_get_invoice` | by-id path (I) | `GET /v1/invoices/{uuid}` — **inferred** by analogy (customers by-id Observed); confirm on B3 touch | ⬜ **I** | — | `siigo/tools.ts` | `siigo.test.ts` |
| `mcp_siigo_list_products` | `GET /v1/products` (D/S) | **`GET /v1/products`** → envelope §3 | ✅ **O** | — | `siigo/tools.ts` | `siigo.test.ts` |
| `mcp_siigo_get_product` | by-id path (I) | `GET /v1/products/{uuid}` — **inferred** by analogy; confirm on B3 touch | ⬜ **I** | — | `siigo/tools.ts` | `siigo.test.ts` |

> **B1 Observed 2026-08-13** — evidence: [`b1-sandbox-evidence.md`](b1-sandbox-evidence.md). Flavor **A**
> (public `api.siigo.com`) resolved the S-vs-D conflict against the SDK hypothesis. Two `get_*` by-id
> paths (invoices, products) stay **Inferred** — only the customers by-id path was exercised; they are the
> only rows not promoted to Observed and are confirmed on first B3 integration touch, not assumed into the
> contract as Observed.

> **B3.1/B3.2 built + tested 2026-08-13 (mcp-server side).** `src/providers/siigo/` implemented
> (`manifest.ts`, `auth.ts` credential_exchange descriptor, `client.ts` — Partner-Id from deployment
> config, `errors.ts`, `tools.ts` 6 passthrough reads, `provider.ts`, `index.ts`) + registered in
> `src/providers/index.ts`; `config.ts` gained `siigoPartnerId`; fixtures + `__tests__/siigo.test.ts`
> (17 tests) + generic conformance all green; full suite 244/244, `tsc` + prettier clean. The `Code`
> columns above are satisfied by these files; `Test` by `siigo.test.ts`. The 2 Inferred `get_*` by-id
> paths (invoices/products) are wired but confirmed against the live sandbox only at B5.

> **B3.3 built + tested 2026-08-13 (xcale-backend side).** Net-new credential_exchange wiring (NOT the
> generic single-secret rail): `connections/credential-exchange-providers.ts` (PINNED backend-authoritative
> Siigo descriptor — the ONE source connect + resolve read; security: never live-fetched);
> `mcp-bootstrap.ts` gained a `credential_exchange` router branch + `buildCredentialExchangeConfig`
> (connect form username/access_key, validate by **minting once**, persist durable creds as JSON in
> `credentialSecret`, cache the JWT, accountKey = username); `internal-routes.ts` `createDefaultResolveService`
> now wires `descriptorFor` + `staticHeaderValues` (Partner-Id) — the Phase-B TODO closed; `credential-registry.ts`
> `ConnectAuthMethod` += `credential_exchange`; `toolboxes.ts` registers Siigo; `config` += `SIIGO_PARTNER_ID`
> (+ `.env.example` both repos); i18n `siigo.error.invalid_credentials` EN+ES. Golden cross-repo pin: the
> backend descriptor test + the mcp `siigo.test.ts` both assert the SAME frozen literals. 10 new tests +
> 226 connections/i18n green, `tsc` + prettier + eslint clean.

> **B4 core built + tested 2026-08-13 (reference emission, xcale-backend).** `credentialDelivery` is
> threaded catalog → `McpProviderRef` → `McpToolExecutorConfig` (`mcp/entities.ts` `McpAuthDescriptor`,
> `mcp-bootstrap.ts` ref projection, `mcp-tool-loader.ts` + a Mongo reference-store default). The emitter
> (`mcp-tool-executor.ts` `resolveWireToken`) now branches: `reference` providers mint a single-use nonce
> (`referenceStore.create(connectionId, 60s)`) and send it as `X-Provider-Token` — the durable credential
> and the minted JWT never leave Rail A; `forwarded` sends the decrypted token unchanged. Reconnect works
> via the EXISTING path (gateway maps the resolve-time 422 → `PROVIDER_AUTH_EXPIRED` ToolResult, verified
> in `mcp-server.ts:69-77` + `reference-resolver.ts`). 6 new tests + full mcp module 87/87 green, `tsc` +
> prettier + eslint clean. **DEFERRED (not built):** the one-retry-on-`reference_invalid` — a sub-60s
> race defense that needs a TYPED `reference_invalid` signal surviving the tools/call envelope (today the
> gateway `throw`s `ReferenceResolutionError` → a generic JSON-RPC error, indistinguishable from other
> transport failures; a blind retry would be wrong per the grill). It is a cross-repo protocol follow-up,
> not required for the happy path. STILL OPEN: **B5** (live e2e in the xcale chat).

> **B2 Contract § mapping 2026-08-13** — every Observed fact above is pinned in
> [`api-contract.md`](api-contract.md): base URL / auth / token → **§A.1–A.2 + §B**; `Partner-Id`
> (token-vs-data + validation boundary) → **§A.2/A.3 + §B notes**; `bodyFields` logical keys + JSON-shape
> contract → **§B**; pagination → **§A.5 + §C.1**; list/error envelopes → **§A.4/A.6 + §D**; rate limits →
> **§A.6 + §D**; company cardinality (no `contextSchema`) → **§C.1**; the 6 read tools → **§C**; fixtures →
> **§F**. B3 fills the `Code` + `Test` columns.

> **Fidelity over Unification:** the `data` each tool returns is Siigo's response **verbatim** — there
> is no per-field mapping to trace (no mapper/DTO). Only the *envelope* (list unwrap + error mapping)
> and the *request* (path, params, filters) are provider-specific and traced above.
