# WooCommerce Read-Only Provider (v1) — Implementation Plan

> **Companion of**: [feature-design.md](feature-design.md), [api-contract.md](api-contract.md), ADR [0018-basic-http-auth-scheme](../../adr/0018-basic-http-auth-scheme.md)
> **Scope**: v1 (Fase 1) — 9 read-only tools. Fases 2–3 out of scope.
> **Last Updated**: 2026-09-14

---

## Meta-description

This plan adds a `woocommerce` provider to the MCP and a Rail A connect path in the backend, both read-only. The shape of the change is **one additive core touch + one self-contained provider module + one backend credential registration**:

1. **MCP core (foundation, one touch):** add a `basic` variant to `ProviderAuthDescriptor` and a `case 'basic'` branch to the materializer that emits `Authorization: Basic base64(secret)` over the single composed `ck:cs` secret (ADR 0018).
2. **MCP provider (`src/providers/woocommerce/`):** a thin adapter mirroring `src/providers/toteat/` — a per-store `storeUrl` as call context (like Toteat's `xir/xil/xiu`), an HTTP client that builds `${storeUrl}/wp-json/wc/v3/...`, and the 9 curated read tools. One line in `src/providers/index.ts`.
3. **Backend Rail A:** register `woocommerce` as an `api_key` credential provider (mirror `src/modules/connections/providers/shopify.ts`), validate the `storeUrl` (anti-SSRF), compose `ck:cs` as the forwarded secret, and key the connection on `accountKey = normalized storeUrl`.

**Done for the phase** = `discover` lists `woocommerce` with a `basic` authDescriptor; `tools/list` returns 9 tools; a `tools/call` runs end-to-end against a test store; a forced 401 returns `PROVIDER_AUTH_EXPIRED`; the backend connect flow stores keys + validated URL and forwards `ck:cs`; `tsc`/`lint`/tests green in both repos. Concrete WooCommerce field/route values are confirmed against a test store first (api-contract §8), removing the `⏳`.

> **MCP first, backend second** — the backend discovers the provider + its authDescriptor from the MCP catalog, so the MCP must publish it first.

---

## Target File Tree

### Repo: `xcale-mcp-server` (first)

```
src/
  core/
    provider-port.ts                       MODIFIED  (+ 'basic' variant in ProviderAuthDescriptor)
    auth/authentication-materializer.ts    MODIFIED  (+ case 'basic')
    auth/__tests__/…                        MODIFIED  (basic materialization test)
  providers/
    index.ts                               MODIFIED  (+1 line: woocommerceProvider)
    woocommerce/                           NEW
      manifest.ts                          NEW  (slug, category, accountContextKeys)
      auth.ts                              NEW  (basic + forwarded)
      context.ts                           NEW  (storeUrl call-context schema)
      client.ts                            NEW  (thin HTTP client over wc/v3)
      tools.ts                             NEW  (9 read tools)
      errors.ts                            NEW  (WooCommerce error shaping)
      provider.ts                          NEW  (createWoocommerceProvider factory)
      index.ts                             NEW  (re-export)
      __tests__/woocommerce.test.ts        NEW  (conformance + behavior + forced 401)
      __fixtures__/*.json                  NEW  (anonymized recorded responses)
```

### Repo: `xcale-backend` (second)

```
src/modules/connections/
  providers/woocommerce.ts                 NEW  (registerCredentialProvider, api_key)
  store-url-guard.ts                       NEW  (anti-SSRF validation + normalization)
  index.ts                                 MODIFIED  (register woocommerce at startup)
  providers/__tests__/woocommerce.test.ts  NEW  (validate + URL guard tests)
```

> **Detail note:** the MCP phase is fully specified below (its code is being written now). The backend phase's file-level detail is grounded in the real `credential-registry.ts`/`connect-descriptor.ts` seams that exist today; it reuses them without new infra.

---

## Per-File Change Table (executive level — signatures + intent, no bodies)

### MCP core (foundation)

| File | Symbol | Signature | Intent | Seam | Kind |
|:--|:--|:--|:--|:--|:--|
| `src/core/provider-port.ts:16` | `ProviderAuthDescriptor` | `| { type: 'basic'; credentialDelivery?: CredentialDelivery }` | New union member; no `fields` (Basic always targets the `Authorization` header) | The published auth-descriptor contract | MODIFIED |
| `src/core/auth/authentication-materializer.ts:31` | `materialize` (switch) | `case 'basic': headers.authorization = 'Basic ' + base64(secret)` | Encode the single composed `ck:cs` secret; stays single-secret; existing branches untouched; `assertNever` still guards | `materialize(auth, resolved, spec)` | MODIFIED |

### MCP provider `src/providers/woocommerce/` (mirror `src/providers/toteat/`)

| File | Symbol | Signature | Intent | Kind |
|:--|:--|:--|:--|:--|
| `manifest.ts` | `woocommerceManifest` | `ProviderManifest` (`slug:'woocommerce'`, `category:'ecommerce'`, `accountContextKeys:['storeUrl']`, `connectionProbe:{ tool:'mcp_woocommerce_list_categories' }`) | Identity + cheap probe for connect verification | NEW |
| `auth.ts` | `woocommerceAuth` | `ProviderAuthDescriptor` = `{ type:'basic', credentialDelivery:'forwarded' }` | Declares HTTP Basic, forwarded delivery | NEW |
| `context.ts` | `woocommerceContext` | `z.object({ storeUrl: z.string().url() }).strict()` | Per-store base URL as call context (published as `contextSchema`) | NEW |
| `client.ts` | `createWoocommerceClient(deps)` | `(deps:{ }) => WoocommerceClient` with `get(path, request, ctx, params?)` | Builds `${ctx.storeUrl}/wp-json/wc/v3/${path}`; applies forwarded cred at egress; reads `X-WP-TotalPages`; never interpolates URL into errors | NEW |
| `tools.ts` | `buildWoocommerceTools(client)` | `(client) => ToolDefinition<any, WoocommerceContext>[]` | The 9 tools via `toolFactory<WoocommerceContext>()`; list tools via `definePaginatedList` | NEW |
| `errors.ts` | `unwrapWoocommerce(res, verb)` | `(RequestResult, string) => ToolOutcome` | 401/403 → `PROVIDER_AUTH_EXPIRED`; others via `mapHttpStatusToErrorCode`; never leak `res.body` | NEW |
| `provider.ts` | `createWoocommerceProvider(deps?)` / `woocommerceProvider` | `(deps?) => IProvider` calling `createProvider({ manifest, auth, metadataSchema: woocommerceContext, tools })` | Assembles the provider (pattern of `toteat/provider.ts:22-34`) | NEW |
| `index.ts` | re-exports | — | Barrel | NEW |
| `src/providers/index.ts:` `PROVIDERS` | array entry | `woocommerceProvider,` | The one registration line (Provider Self-Containment) | MODIFIED |

**The 9 tools (`tools.ts`)** — each `mcp_woocommerce_{verb}`, zod input from api-contract §1.3, curated result from §1.4:

| Tool | Endpoint | Notes |
|:--|:--|:--|
| `list_products` | `GET products` | `definePaginatedList`; `search`/`category`/`stockStatus` filters |
| `get_product` | `GET products/{id}` | returns variation ids |
| `get_product_variations` | `GET products/{id}/variations` | `definePaginatedList`; per-variation price/stock |
| `list_categories` | `GET products/categories` | `definePaginatedList` |
| `list_shipping_zones` | `GET shipping/zones` | no args |
| `get_shipping_zone_locations` | `GET shipping/zones/{id}/locations` | coverage |
| `get_shipping_zone_methods` | `GET shipping/zones/{id}/methods` | base rates only (R-6) |
| `list_orders` | `GET orders` | `definePaginatedList`; `status`/`after`/`before` |
| `get_order` | `GET orders/{id}` | detail |

### Backend Rail A

| File | Symbol | Signature | Intent | Seam | Kind |
|:--|:--|:--|:--|:--|:--|
| `store-url-guard.ts` | `assertPublicHttpsUrl(raw): string` | `(string) => string` (normalized) or throws | Require `https`; reject `localhost`/private/link-local IPs/non-public hosts; normalize (strip trailing slash) | Called from `validate` | NEW |
| `providers/woocommerce.ts` | `woocommerceCredentialProvider` (registration) | `registerCredentialProvider({ slug:'woocommerce', authMethod:'api_key', connectFields, validate })` | `validate(raw)` → `assertPublicHttpsUrl(raw.storeUrl)` + one probe call, returns `MappedCredential` `{ secret: \`${ck}:${cs}\`, accountKey: normalizedUrl, metadata:{ storeUrl, authMethod:'api_key' } }` | `registerCredentialProvider` (`credential-registry.ts:121`); `MappedCredential` (`:41`) | NEW |
| `connections/index.ts` | startup registration | import side-effect / `registerWoocommerce()` | Register before the rail serves connects (mirror shopify wiring) | module init | MODIFIED |

> **Reuse, no new seam:** `MappedCredential.secret` is the forwarded value; `metadata.storeUrl` is projected to the MCP as provider call-context by the existing MCP context-projection (`src/modules/mcp/context-projection.ts`). No changes to the executor, the forwarded resolver, or the generic connect/reconnect endpoints. (The api-contract's `toResolvedCredential` sketch maps to the real `validate → MappedCredential` seam.)

---

## Vertical Slices (ordered)

| # | Slice | Repo | Owns (writes) | Depends on | DoD |
|:--|:--|:--|:--|:--|:--|
| **S0** | Sandbox + evidence: stand up a test store, run the 9 endpoints, fill `sandbox-evidence.md`, remove `⏳` in the contract | — | `docs/design/.../sandbox-evidence.md`, `api-contract.md` | none | Real field/route values recorded |
| **S1** | Core `basic` scheme (foundation) | mcp | `provider-port.ts`, `authentication-materializer.ts` + test | S0 (confirms Basic works) | `tsc`/lint green; materializer test asserts `Authorization: Basic …` |
| **S2** | Provider scaffold + 1 tool end-to-end (`list_products`) | mcp | all of `src/providers/woocommerce/*`, `providers/index.ts` | S1 | Round trip: `discover` + `tools/list` + `tools/call list_products` against the test store |
| **S3** | Remaining catalog tools (`get_product`, `get_product_variations`, `list_categories`) | mcp | `woocommerce/tools.ts`, fixtures | S2 | tools return curated shapes; tests green |
| **S4** | Shipping tools (`list_shipping_zones`, `get_shipping_zone_locations`, `get_shipping_zone_methods`) | mcp | `woocommerce/tools.ts`, fixtures | S2 | coverage/methods answerable; base-rate framing (R-6) |
| **S5** | Order tools + forced-401 path (`list_orders`, `get_order`) | mcp | `woocommerce/tools.ts`, fixtures, `errors.ts`, tests | S2 | forced 401 → `PROVIDER_AUTH_EXPIRED` |
| **S6** | Backend connect (Rail A) | backend | `store-url-guard.ts`, `providers/woocommerce.ts`, `connections/index.ts` + tests | S1–S5 published in MCP catalog | connect stores keys + validated URL; forwards `ck:cs`; `accountKey`=URL; guard rejects `http`/private IPs |

> **S3/S4/S5 share `tools.ts`** — they are sequential (same writable file), not parallel.

---

## Subagent Delegation Map

- **Foundation (orchestrator):** S1 (core `basic`) — shared seam, built once first.
- **Provider (one worker, sequential):** S2→S5 all write `src/providers/woocommerce/tools.ts` → **one agent**, not fanned out.
- **Backend (independent, other repo):** S6 — can proceed once the MCP catalog publishes the provider.

**Recommendation: build solo (no fan-out).** The plan touches ~12 files but has only **~3 independent seams** (core, provider, backend) and the provider slices share one file — **below** the >4-independent-slices / >12-files threshold. Fanning out would fight over `tools.ts`. Sub-issue decomposition (Step 6b) is **skipped**: 1:1:1, one branch, one PR per repo.

---

## Test Strategy & Definition of Done

**Per slice:** `/tdd` red-green-refactor; unit tests over recorded `__fixtures__` (MCP) / mocked probe (backend). No live calls in CI.

**Phase DoD (real commands):**
- MCP: `npm run typecheck` clean · `npm test` green (incl. conformance + forced-401 + `basic` materialization) · `npm run format:check` clean.
- Backend: `npx tsc --noEmit` clean · `npm run lint` clean · connect/validate tests green.
- Behavior (manual, against the test store): `discover` shows `woocommerce`+`basic`; `tools/list` = 9; one real `tools/call` per tool; a revoked key → `PROVIDER_AUTH_EXPIRED`; the backend connect flow stores a connection and a subsequent tool-call succeeds through Rail A.

**Ships as:** two PRs to `dev` (one per repo), MCP merged first. ADR 0018 rides the MCP PR.
