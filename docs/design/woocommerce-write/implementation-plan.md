# WooCommerce Write Tools (Phase 2) — Implementation Plan

> **Slug**: `woocommerce-write` (xcale-mcp-server)
> **Inputs**: [`feature-design.md`](./feature-design.md) · [`api-contract.md`](./api-contract.md)
> **Build**: `/tdd`, slice by slice, W4 first. **Continues on the existing `feat/implementation-woocommerce` branch** (read v1 + write = one branch, one PR — Issue #105).
> **Language**: English (xcale-mcp-server repo rule)
> **Last Updated**: 2026-09-18

## Meta-description

Add WooCommerce **write** capability to the existing read-only provider, following the **Toteat write precedent** (the MCP's first write provider). The change is fully **Provider Self-Contained** — everything lands under `src/providers/woocommerce/`, plus the shared `safe-egress.ts` W4 fix (already this provider's file). No `src/core|protocol|auth` change, no new `ProviderErrorCode`. First we make the transport safe for non-GET (W4 + client `post`/`put`), then four tools: `update_product`, `update_stock` (idempotent PUTs), `create_order` (POST with a reconciliation tag in `meta_data`, no blind retry), and a **control-plane** `reconcile_order` (withdrawn from `tools/list`) for recovery. "Done" = all four tools pass `runProviderConformance` + fixture tests, the manifest re-lists them for consumers, and a **write-S0** confirms real writes (and the OPEN `reconcile_order` query) against the live store.

**Fan-out:** ~6 files, sequential (W4 foundation → client → tools). **Below the subagent threshold → solo build.**

## Target file tree

```
xcale-mcp-server/
├── src/providers/woocommerce/
│   ├── safe-egress.ts                    MODIFIED  (W4: redirect method/body downgrade)
│   ├── client.ts                         MODIFIED  (add post/put)
│   ├── tools.ts                          MODIFIED  (+4 tools + curated write types)
│   ├── manifest.ts                       MODIFIED  (bump schemaVersion + providerVersion)
│   ├── provider.ts                       UNCHANGED (context) — buildWoocommerceTools already wired
│   └── __tests__/
│       ├── safe-egress.test.ts           MODIFIED  (redirect downgrade cases)
│       ├── woocommerce.test.ts           MODIFIED  (write tool tests)
│       └── __fixtures__/                  NEW       (product-update, order-create, order-reconcile)
└── (cross-repo, xcale-backend)           i18n connect note "selling needs a Read/Write key" — NOT this repo
```

## Per-file changes (signatures + intent, no bodies)

### `src/providers/woocommerce/safe-egress.ts` — MODIFIED (W4)
Anchor: the redirect loop in `createSafeFetch` (`hopInit` build + `currentUrl = new URL(location, url)`).

| Symbol | Change | Intent |
|:--|:--|:--|
| the redirect hop loop | MODIFIED | On a 3xx: `303 → GET` and **drop body**; `301/302` with a non-GET method → drop body (convention); `307/308` preserve method+body. Today `hopInit` is re-sent unchanged — this is the W4 the contract marks a prerequisite. The cross-origin credential strip already shipped stays. |

### `src/providers/woocommerce/client.ts` — MODIFIED
Anchor: `client.ts:13-20` (`WoocommerceClient`), `:29-37` (`buildUrl`), `:39-44` (`createWoocommerceClient`).

| Symbol | Signature | Intent | State |
|:--|:--|:--|:--|
| `WoocommerceClient.post` | `post(path, body, request, ctx, params?): Promise<RequestResult>` | New verb; builds `RequestSpec {method:'POST', url, body: JSON.stringify(body), headers:{'content-type':'application/json'}}` (confirm the `headers` field on `RequestSpec`, http-request.ts:23) | NEW |
| `WoocommerceClient.put` | `put(path, body, request, ctx, params?): Promise<RequestResult>` | Same with `method:'PUT'` | NEW |
| `createWoocommerceClient` | (signature unchanged) | Reuses `buildUrl` (credential stays out of the URL — Basic header) | MODIFIED |

### `src/providers/woocommerce/tools.ts` — MODIFIED
Anchor: `tools.ts:10` (`const tool = toolFactory<WoocommerceContext>()`), `:381` (`buildWoocommerceTools`), tool shape `:387-411` (`tool({name,input,handler})` → `client.get(...)`).

| Symbol | Signature / shape | Intent | State |
|:--|:--|:--|:--|
| `updateProductInput` | zod: `{ id, regularPrice?, salePrice?, status? }` `.strict().refine(≥1 mutable)` | Input SSOT; curated fields only; camel→snake to body | NEW |
| `updateStockInput` | zod: `{ id, productId?, stockQuantity?, stockStatus? }` `.strict().refine(≥1)` | `productId` present ⇒ variation route | NEW |
| `createOrderInput` | zod: `{ orderReference, lineItems[], customer?, status }` | reconciliation tag + line_items + customer→billing | NEW |
| `reconcileOrderInput` | zod: `{ orderReference }` | recovery input | NEW |
| curated write result types | `WooOrderCreated`, reuse `WooProduct*` | Fidelity over Unification; curated `data` | NEW |
| `tool({ name: mcp_woocommerce_update_product, input, handler })` | → `client.put('products/{id}', body, ...)` | idempotent | NEW |
| `tool({ name: mcp_woocommerce_update_stock, handler })` | → `client.put('products/{id}' \| 'products/{pid}/variations/{id}', body)` | idempotent; `manage_stock:true` when `stockQuantity` set | NEW |
| `tool({ name: mcp_woocommerce_create_order, handler })` | → `client.post('orders', body incl. meta_data:[{key:'_xcale_order_ref',value:orderReference}])` | Toteat pattern; never a blind retry | NEW |
| `tool({ name: mcp_woocommerce_reconcile_order, controlPlane: true, handler })` | → `client.get('orders', ... recovery query)` → `{found, order?}` | withdrawn from `tools/list`; query OPEN (write-S0) | NEW |
| `buildWoocommerceTools` | (signature unchanged) | Append the 4 tools to the returned array | MODIFIED |

### `src/providers/woocommerce/manifest.ts` — MODIFIED
Anchor: `manifest.ts` (`schemaVersion`, `providerVersion`).

| Symbol | Change | Intent |
|:--|:--|:--|
| `schemaVersion` / `providerVersion` | bump | `tools/list` changes (4 new tools) → the consumer must re-list; `providerVersion` is the adapter semver |

## Vertical slices (ordered; W4 first)

| # | Slice | Type | Writes | Definition of Done |
|:--|:--|:--|:--|:--|
| **S1** | W4 + client `post`/`put` | foundation | `safe-egress.ts`, `client.ts` (+ tests) | Downgrade 303→GET/drop-body, 301/302 drop, 307/308 preserve, with tests; `post`/`put` build the correct `RequestSpec` (JSON content-type). **No write tool before this** |
| **S2** | `update_product` | integration | `tools.ts` (+ fixture + test) | PUT products/{id} with curated fields; idempotent; error mapping reused |
| **S3** | `update_stock` | integration | `tools.ts` (+ fixture + test) | product vs variation routing; `manage_stock:true` on quantity set; idempotent |
| **S4** | `create_order` | integration | `tools.ts` (+ fixture + test) | POST orders with `orderReference` in `meta_data`; curated `data`; no blind retry |
| **S5** | `reconcile_order` (control-plane) | integration | `tools.ts` (+ fixture + test) | `controlPlane:true` (out of `tools/list`, still routable); `{found, order?}`; **recovery query flagged OPEN** until write-S0 |
| **S6** | manifest + conformance | integration | `manifest.ts` (+ test) | schemaVersion/providerVersion bump; `runProviderConformance` green with the 4 tools |
| **S7** | write-S0 (real evidence) | verification | `docs/design/woocommerce-write/write-s0-evidence.md` | a real update + a real create with reconciliation against the live store; **closes the `reconcile_order` query** and confirms the writable fields |

**Delegation:** solo, no subagents (below threshold). S1 is foundation (S2–S5 depend on `client.post/put`). S4→S5 are coupled (reconcile finds what create wrote). S7 needs the LocalWP store up (Live Link with a fresh URL + creds).

## Test strategy & Definition of Done

**Per slice:** `npx tsc --noEmit` clean · `npx vitest run src/providers/woocommerce` green · `npx prettier --check`. Each tool tests success + at least one mapped error (401→AUTH_EXPIRED, 400→INVALID_INPUT) with the existing `fakeFetch` + recorded fixtures pattern in `woocommerce.test.ts`.

**Key cases:**
- W4: 303→GET (drop body), 302 with POST→drop body, 307→preserve; combined with the existing cross-origin strip.
- `update_product`/`update_stock`: idempotence (same call twice = same result); encoded id; variation routing.
- `create_order`: the `meta_data _xcale_order_ref` travels in the body; `orderReference` echoes back in `data`.
- `reconcile_order`: `found:true` returns the order; `found:false` enables a retry; NOT in `listTools()` but present in `routableToolNames()`.

**Phase (global DoD):** `tsc` + full `vitest` suite green · `runProviderConformance` with the 4 tools · **write-S0**: a real `update_*` + a real `create_order` (with its reconcile) against the live store; document the observed recovery query.

**Reviewers (post-build):** `code-reviewer` (security lens on the write paths + W4).

## Cross-repo / follow-ups (not in this plan)
- **xcale-backend i18n**: a connect note that selling needs a **Read/Write** key (lives in the backend, not the MCP).
- **xcale-backend commerce vertical**: integrating `create_order` into the commerce vertical (adapter) — its own grill/plan.

## Closing checklist
- [ ] S1–S7 green with their DoD.
- [ ] Provider Self-Containment: only `src/providers/woocommerce/` + `safe-egress.ts`. Zero core.
- [ ] `reconcile_order` out of `tools/list`, still routable.
- [ ] `runProviderConformance` green with the 4 tools.
- [ ] write-S0 closes the `reconcile_order` query and the writable fields.
- [ ] `code-reviewer` with no open findings.
- [ ] No PR/merge until Sara asks.
