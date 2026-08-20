# Siigo Read-Only Provider — Ship Log (Phase B: B2→B5)

> **Purpose.** A PR-ready handoff of everything built for the Siigo integration in this wave. Phase A
> (provider-agnostic credential-delivery machinery) is already in `dev`; this log covers **Phase B**
> (B2 contract → B3 provider+registration → B4 reference emission → B5 e2e).
> **Date:** 2026-08-13. **Status: in-soak.** **Released to prod: 2026-08-20** (release PR #42,
> merged by the release owner; deploy verified — new build live, `GET /health` ok).
> **Prod posture: dormant by scope decision** — `CREDENTIAL_RESOLVE_URL` / `CREDENTIAL_RESOLVE_SECRET`
> / `SIIGO_PARTNER_ID` unset in `prd`, so the reference resolver is not wired and Siigo tool calls
> are not served. Activation is a follow-up gated on the boot-time https validation of
> `CREDENTIAL_RESOLVE_URL` (roadmap). Dev-side: built, tested, **verified end-to-end against the
> live Siigo sandbox** (agent returned real customers in the xcale chat; pre-envelope-fix — re-smoke
> on activation). Shipped via PRs #33 (adapter) + #34 (docs) into `dev`; backend halves shipped in
> `xcale-backend` (its release #546 carries Siigo connect).

## Summary

Onboard Siigo (Colombian accounting / e-invoicing) as the **first `reference`-strategy MCP provider**,
read-only. A 3-agent drift grill (before B1) surfaced 6 plan-vs-code corrections (all applied to docs);
B1 against the live sandbox resolved the pre-B1 flavor ambiguity → **Flavor A (public `api.siigo.com`),
not the alliance flavor**. The durable `username`+`access_key` is exchanged for a 24h JWT, minted
just-in-time by Rail A under the `reference` strategy; the crown-jewel credential never leaves the
backend.

Suggested PR split (dependency order top→bottom; PRs 2→3→4 are the code path). Merging Phase-B docs
first is safe and independent.

---

## PR 1 — `xcale-mcp-server`: Siigo design docs (B1 evidence, B2 contract, drift-grill corrections)

Docs-only.

| File | Change |
|------|--------|
| `docs/design/siigo-read-only-provider/b1-sandbox-evidence.md` | **NEW** — B1 Observed facts (Flavor A, auth body `username`/`access_key`, token `access_token`/`expires_in`=24h, Partner-Id token-vs-data, `page`/`page_size` default 25 min 10, error envelope `{Status,Errors[]}`, 429 rate-limit, company cardinality) |
| `docs/design/siigo-read-only-provider/api-contract.md` | **NEW** — B2 frozen contract, Observed-only |
| `docs/design/siigo-read-only-provider/traceability-matrix.md` | Observed column filled + B2/B3/B4 notes |
| `docs/design/siigo-read-only-provider/feature-design.md` | AD-7 hypothesis→Observed; §6.1 mint-once gate note |
| `docs/design/siigo-read-only-provider/implementation-plan.md` | Drift corrections C1/C2/C4/C6 |
| `docs/design/siigo-read-only-provider/sandbox-verification.md` | Added open question Q-9 (company cardinality) |
| `docs/design/siigo-read-only-provider/implementation-playbook.md` | Step-9 credentialSecret JSON-shape + descriptorFor pins |
| `docs/adr/credential-delivery-strategies.md` | Note: single retry lives at the emitter; resolver throws typed |
| `docs/design/siigo-read-only-provider/ship-log.md` | **NEW** — this file |

---

## PR 2 — `xcale-mcp-server`: Siigo provider adapter (B3.1 / B3.2)

Depends on Phase A (in dev). Self-contained per Provider Self-Containment.

| File | Change |
|------|--------|
| `src/providers/siigo/manifest.ts` | **NEW** — slug/displayName/category; NO `connectionProbe`, NO `contextSchema` (1 credential = 1 company) |
| `src/providers/siigo/auth.ts` | **NEW** — `credential_exchange` descriptor, `credentialDelivery:'reference'`, Observed wire values |
| `src/providers/siigo/client.ts` | **NEW** — GET client; attaches `Partner-Id` (deployment) on every data call (materializer doesn't apply staticHeaders) |
| `src/providers/siigo/errors.ts` | **NEW** — `unwrapSiigo` (honest HTTP status → reuse core `mapHttpStatusToErrorCode`) |
| `src/providers/siigo/tools.ts` | **NEW** — 6 read tools (list/get × customers/invoices/products), passthrough-verbatim, `page`/`pageSize` |
| `src/providers/siigo/provider.ts` | **NEW** — factory + default instance; `partnerId` from `loadConfig().siigoPartnerId` |
| `src/providers/siigo/index.ts` | **NEW** |
| `src/providers/siigo/__fixtures__/*.json` | **NEW** — 6 fixtures (B1 shapes) |
| `src/providers/siigo/__tests__/siigo.test.ts` | **NEW** — 17 tests (catalog surface, request shaping, verbatim reads, error map, credential containment, conformance) |
| `src/providers/index.ts` | Register `siigoProvider` (the one registration line) |
| `src/config.ts` | Add `siigoPartnerId` (`SIIGO_PARTNER_ID`) |
| `.env.example` | Document `SIIGO_PARTNER_ID` |
| `assets/siigo.svg` | **NEW** — logo (original "S" monogram, 35×35 dark-card style; was 404) |
| `src/protocol/__tests__/http.test.ts` | Add `siigoPartnerId:''` to inline `Config` literal |
| `src/protocol/__tests__/mcp.integration.test.ts` | Same |

**Gate:** `tsc` + prettier clean; **full suite green.**

### PR 2 addendum — Phase 1a reference-data reads (2026-08-13)

Same repo/files (extends `src/providers/siigo/tools.ts`, `manifest.ts`, `__tests__/siigo.test.ts`). Adds
**8 reference-data read tools** — `list_taxes`, `list_account_groups`, `list_price_lists`,
`list_cost_centers`, `list_warehouses`, `list_users`, `list_document_types`, `list_payment_types` — so
Siigo now exposes **14 read tools**. These are the lookups the future write path consumes. **Observed
(sandbox, evidence §8):** most return a **flat array** (not the list envelope); `list_users` is the only
paginated one; `list_document_types` requires a `type` filter and `list_payment_types` a `document_type`
filter (Siigo 400s without them). `manifest.schemaVersion` bumped `2026-08-13`→`2026-08-13.1`,
`providerVersion` `0.1.0`→`0.2.0`. **Gate:** `tsc` + prettier clean; **full suite 249/249 green.** Can
ship in PR 2 or as a fast-follow PR 2b.

### PR 2 addendum — Phase 1b additional read resources (2026-08-13)

Same repo/files. Adds **5 read-resource `list_*` tools** — `list_purchases`, `list_credit_notes`,
`list_vouchers`, `list_journals`, `list_quotations` — so Siigo exposes **19 read tools** total. **Observed
(evidence §9):** all 5 return the standard `{ pagination, results, _links }` envelope with full records,
so a paginated `list_*` is the record (no `get_*` companion). `manifest.schemaVersion`
`2026-08-13.1`→`2026-08-13.2`, `providerVersion` `0.2.0`→`0.3.0`. **Gate:** `tsc` + prettier clean; **full
suite 250/250 green.** Ships with PR 2 / PR 2b.

### PR 2 addendum — review fix (2026-08-18): uniform pagination envelope

The PR #33 review found the 9 paginated `list_*` tools returning Siigo's raw
`{ pagination, results, _links }` envelope verbatim — a deviation from ADR
`canonical-provider-pattern` §2 (uniform `PaginatedResult` envelope for every list tool; deviations
require an ADR) that this feature's own traceability matrix had ruled out. Fixed in-branch: the 9
wrap via `definePaginatedList` (each item verbatim; `_links` dropped — paging is
consumer-controlled), the orphaned logo is wired (`logoUrl: '/assets/siigo.svg'`), and
`schemaVersion` `2026-08-13.2`→`2026-08-18`, `providerVersion` `0.3.0`→`0.4.0` for the result-shape
change. `api-contract.md` §C updated to match. Flat-array reference reads stay verbatim (no upstream
pagination to represent). **Gate:** `tsc` + prettier clean; **full suite 250/250 green.**

> **Live-discovery note (dev):** when the mcp-server's tool set changes, the backend must re-discover
> (its `tools-cache` persists) — bump `manifest.schemaVersion` AND restart the mcp-server then the backend
> (in that order) so the new tools flow through. The integration page's ↻ refresh only re-checks the
> connection, not the tool catalog.

---

## PR 3 — `xcale-backend`: Siigo credential_exchange registration + connect (B3.3)

Depends on Phase A (in dev). Net-new wiring — the generic credential rail structurally rejects
`credential_exchange` (reads `fields` not `bodyFields`, one-secret-only, forwards the pasted secret as a
bearer token instead of minting).

| File | Change |
|------|--------|
| `src/modules/connections/credential-exchange-providers.ts` | **NEW** — backend-authoritative **PINNED** Siigo descriptor registry (never live-fetched — the durable credential is POSTed to `tokenEndpoint`, so the endpoint must not be network-sourced); connect fields + `accountKeyField` + `descriptorFor`/`staticHeaderValues` helpers |
| `src/modules/connections/credential-registry.ts` | `ConnectAuthMethod` += `'credential_exchange'` |
| `src/modules/connections/internal-routes.ts` | `createDefaultResolveService` now wires `descriptorFor` + `staticHeaderValues` (Partner-Id); corrected the misleading "live-fetched" comment |
| `src/modules/mcp/mcp-bootstrap.ts` | New `credential_exchange` router branch + `buildCredentialExchangeConfig` (connect form username/access_key, validate by **minting once**, persist durable creds as JSON in `credentialSecret`, cache the JWT, accountKey=username) |
| `src/modules/mcp/toolboxes.ts` | Siigo toolbox entry (category `productivity` — no `accounting` in the Composio-coupled `ToolboxCategory` enum) |
| `src/config/index.ts` | Add `SIIGO_PARTNER_ID` |
| `src/infrastructure/i18n/locales/en.json` + `es.json` | `siigo.error.invalid_credentials` (EN+ES parity) |
| `src/modules/mcp/__tests__/mcp-bootstrap.credential-exchange.test.ts` | **NEW** — 10 tests (golden cross-repo descriptor pin, validate-by-mint, 401→localized reject, blank-field guard, null when unpinned, router routing) |

**Gate:** `tsc` + prettier + eslint clean; **10 new + 226 connections/i18n green.**

---

## PR 4 — `xcale-backend`: reference emission (B4)

Depends on PR 3 (same repo). ⚠️ shares `mcp-bootstrap.ts` with PR 3 — see note below.

| File | Change |
|------|--------|
| `src/modules/mcp/entities.ts` | `McpAuthDescriptor` += `credentialDelivery?` |
| `src/modules/mcp/mcp-bootstrap.ts` | Project `credentialDelivery` onto the discovered `McpProviderRef` |
| `src/modules/mcp/mcp-tool-loader.ts` | `McpProviderRef.credentialDelivery`; loader gains an injectable `EphemeralReferenceStore` (Mongo default); threads both to the executor |
| `src/modules/mcp/mcp-tool-executor.ts` | `resolveWireToken`: for `reference` providers mint a single-use nonce (`referenceStore.create(connId, 60s)`) instead of the token; `forwarded` unchanged; fails loud if a reference provider has no store |
| `src/modules/mcp/__tests__/mcp-tool-executor.reference.test.ts` | **NEW** — 6 tests (nonce not token & resolves to conn, JWT never on wire, fresh nonce/call, reconnect via AUTH_EXPIRED, wiring-bug guard, forwarded unchanged) |

**Gate:** `tsc` + prettier + eslint clean; **full mcp module 87/87 green.**

Reconnect works via the existing path (gateway maps resolve-time 422 → `PROVIDER_AUTH_EXPIRED`, verified
in `mcp-server.ts:69-77`). **No mcp-server change needed for B4.**

> ⚠️ **`mcp-bootstrap.ts` is touched by both PR 3 (router branch + builder) and PR 4 (ref projection).**
> If splitting 3/4, land 3 first; PR 4's diff on that file is only the ~5-line `refs.push({… credentialDelivery})`.
> Alternatively combine 3+4 into one backend PR (they are one coherent Siigo-backend change).

---

## Cross-cutting notes for PR descriptions

**Deploy / config (env — NOT code; set per Doppler config, both `dev` and `prd`):**
- `SIIGO_PARTNER_ID` — required in **both** services (mcp-server applies it on data egress, backend on
  the mint). Sandbox value `EcomerceCG`.
- `CREDENTIAL_RESOLVE_URL` (mcp-server) — must point at the backend resolve endpoint
  `…/internal/credentials/resolve` (scheme must match the backend: **https in any HTTPS environment**);
  empty = reference providers are not served.
- `CREDENTIAL_RESOLVE_SECRET` (both) — currently unset → falls back to `MCP_SERVER_SECRET` (#216 split
  incomplete); set on both to complete the hardening.

**Verified e2e (2026-08-13):** connected Siigo in the UI (`POST /connect-credential` 200) → created a
Siigo test agent with the 6 tools → agent ran `mcp_siigo_list_customers` → **real sandbox customers
returned** (~82,199 total). Backend log confirms
`/internal/credentials/resolve` was hit → full reference path (emit → resolve → mint → Siigo) exercised.

**Deferred (follow-ups, NOT in these PRs):**
- **B4 one-retry-on-`reference_invalid`** — a sub-60s race defense; needs a typed cross-repo
  `reference_invalid` code (today the gateway `throw`s a generic `ReferenceResolutionError`,
  indistinguishable from other transport failures; a blind retry would be wrong).
- **FE (separate `xcale-frontend` repo):** the integration page's tool cards don't refetch after connect
  (show "No disponible" until a manual refresh) — missing `invalidateQueries` on the connect mutation.

**Write frontier (Slice 2 — design started, NOT shipping in these PRs):** the write-path architecture is
recorded in ADR [fiscal-write-path](../../adr/fiscal-write-path.md) (Proposed) — thin MCP passthrough,
consumer-owned idempotency + duplicate detection + two-phase confirmation guardrail + compensating action
(credit note, not delete). Gated behind Slice-1 prod-soak; first write is non-fiscal (`create_customer`)
to de-risk before the fiscal `create_invoice`. The write api-contract (payload shapes) is authored later
from a sandbox **write** probe (same Observed discipline). A write-path grill should pressure-test the ADR
before Slice-2 build.

**Migrations:** none. **Local-dev note:** backend + frontend run HTTPS with self-signed certs, so the
mcp-server's resolve callback needs `CREDENTIAL_RESOLVE_URL` on https and the process to accept the
self-signed cert (`NODE_TLS_REJECT_UNAUTHORIZED=0`, dev-only) — a non-issue in any environment with a
real certificate.

**B5 prod-soak gate criteria** are unchanged from `feature-design.md` §9 (reference resolution works in
prod, reused/expired reference rejected, credential absent from telemetry, `PROVIDER_AUTH_EXPIRED`
round-trips, soak) — to be checked after these PRs land and before opening the Slice-2 write path.
