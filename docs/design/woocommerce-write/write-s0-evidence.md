# WooCommerce Write Tools — write-S0 Evidence

> **Date**: 2026-09-18 · **Store**: `woo-sandbox-01` (LocalWP), exposed via Live Link `encouraging-zone.localsite.io`
> **Method**: direct WooCommerce REST calls (real store). The Live Link enforces its own HTTP Basic gate (`mountain:various`), which collides with WooCommerce's Basic auth — so these run as **direct curls** (tunnel Basic + query-string `consumer_key`/`consumer_secret`), verifying WooCommerce's real behavior. The provider code path is exercised by fixtures + unit tests; write-S0's job is to confirm the WooCommerce facts the contract assumed.
> **Key**: the store REST key was set to **Read/Write** for this run.

## What was verified

| #   | Check                                                                                                                                         | Result                                                                                                                |
| :-- | :-------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| 1   | **create_order** — `POST orders` with `line_items` (variable product 14 / variation 20) + `meta_data:[{key:'_xcale_order_ref', value:<ref>}]` | ✅ Order **id 21** created, `status: pending`, `total: 150000`, and the `_xcale_order_ref` echoed back in `meta_data` |
| 2   | **write authorization** — `PUT products/14/variations/20` (idempotent `{regular_price:"150000"}`) with the R/W key                            | ✅ `HTTP 200` (a Read-only key would have returned `401 woocommerce_rest_cannot_edit`)                                |
| 3   | **reconcile query A** — `GET orders?search=<ref>`                                                                                             | ❌ **returned 0** — WooCommerce `search` does **NOT** match `meta_data`                                               |
| 4   | **reconcile query B** — `GET orders?per_page=20` + match `meta_data` in the adapter                                                           | ✅ found order 21 by its `_xcale_order_ref`                                                                           |

## Decision closed (api-contract Q-3)

`?search=<ref>` is unreliable for reconciliation — it does not index `meta_data`, so it would report `found: false` for an order that actually exists, risking a **duplicate** on retry. **Resolution: `reconcile_order` fetches the most recent orders (`per_page=100&orderby=date&order=desc`) and confirms the `_xcale_order_ref` match in the adapter.** Reconcile runs right after a failed create, so the order is among the newest — 100 desc is ample.

- **Bug caught + fixed by this write-S0**: the initial `reconcile_order` used `?search=<ref>` (would have silently failed). Changed to fetch-recent + meta-match; locked by a unit test asserting `per_page=100` and no `search=` in the query.

## Field facts (for the contract)

- `create_order` body accepted: `status`, `line_items:[{product_id:<number>, variation_id?:<number>, quantity}]`, `meta_data:[{key,value}]`, optional `billing`.
- Order response carries `id` (number), `number`, `status`, `total` (string), and the echoed `meta_data`.
- Variation 20/19 of product 14 report `manage_stock: "parent"` (stock managed on the parent) — relevant when targeting `update_stock` at a variation whose parent owns stock.

## Review resolutions (2026-09-18, `code-reviewer` on the write diff)

The write tools were reviewed after write-S0. Findings and how each was resolved:

- **CRITICAL — a redirected write could double-apply.** The `safe-egress.ts` redirect loop followed 3xx for any method: a `307/308` on `create_order` would **replay the same body** (same `_xcale_order_ref`) to the redirect target → a duplicate order that `reconcile_order` can't distinguish (both carry the ref); and a `301/302/303` would silently **downgrade the write to a bodyless GET** → `ok()` for a write that never landed. **Design revised — supersedes the plan's "W4 downgrade":** a redirect (any 3xx-with-Location) on a **non-GET/HEAD** method now **fails closed** (`UnsafeHostError`). WooCommerce REST does not legitimately redirect a write; the caller reconciles/retries deliberately instead of the transport guessing. Reads (GET/HEAD) still follow redirects, re-validated per hop. Locked by tests (301/302/303/307/308 × POST/PUT reject; GET still follows).
- **WARNING — reconcile window was volume-bound, not time-bound.** `reconcile_order` gained an optional **`after`** (the caller's create-attempt timestamp, ISO 8601), threaded into `GET orders?after=…&per_page=100&orderby=date&order=desc`. It bounds the scan to the real uncertainty interval so a busy store (>100 orders since) can't scroll the target off page 1 → false `found:false` → duplicate (R-1). Omitted falls back to "100 newest" (fine for the low-volume pilot). Matches api-contract §2.4.
- **WARNING — 301/302 downgrade broader than spec + cross-origin write-body exfiltration.** Both subsumed by the fail-closed change above: writes never take a second hop, so a PUT is never silently GET'd and a `create_order` body (buyer PII) never travels to a redirect target.
- **SUGGESTION — numeric-id coercion.** `create_order` `lineItems[].productId`/`variationId` were `Number()`-coerced; a non-numeric string (`"abc"`→NaN→null) or exponent (`"1e2"`→100) would silently target the wrong product. Now validated `z.string().regex(/^\d+$/)` — rejected as `PROVIDER_INVALID_INPUT` before any network call.
- **SUGGESTION — `manage_stock:"parent"` variations.** `update_stock` forcing `manage_stock:true` on a parent-managed variation flips it to independent tracking (a behavior change, not just a value set). Documented inline; **follow-up**: a targeted write-S0 probe on a parent-managed variation before leaning on this at volume.

Confirmed sound by the review: SSRF guard intact, credential never in the URL, no gateway retry, `controlPlane` withdrawal, Provider Self-Containment, id path-encoding, error mapping.

## Residual / cleanup

- Test order **id 21** (`pending`, total 150000) was left in the sandbox — a real but harmless QA record.
- The idempotent PUT changed nothing (same price).
- **Open follow-up**: write-S0 probe of `update_stock` against a `manage_stock:"parent"` variation (see the last review resolution above).

## Round 2 — scope expansion (write-S0, 2026-09-19, live store via ngrok)

New write tools verified against the real store:

| Tool                           | Check                                               | Result                                                 |
| :----------------------------- | :-------------------------------------------------- | :----------------------------------------------------- |
| `update_order`                 | `PUT orders/22 {status:cancelled}`                  | ✅ order 22 → `status: cancelled` (the void primitive) |
| `create_category`              | `POST products/categories {name, description}`      | ✅ category **id 16** created                          |
| `update_category`              | `PUT products/categories/16 {description}`          | ✅ description updated                                 |
| `create_customer`              | `POST customers {email, first_name, billing.phone}` | ✅ customer **id 2** (phone from billing)              |
| `create_order` (customer link) | `POST orders {customer_id:2, line_items…}`          | ✅ order **24**, `customer_id: 2`, `pending`           |

- **`get_product` `status`**: the curated product now carries `status` (publish/draft/private). The
  404-vs-transient split needs no MCP core change — a GET-by-id 404 already maps to `PROVIDER_ERROR`
  (the default bucket, since 400/422→INVALID_INPUT, 401/403→AUTH_EXPIRED, 429→RATE_LIMITED,
  5xx→UNAVAILABLE), which the backend `catalogTruth` reads as `exists:false` while the transient codes
  propagate to `needs-reconfirmation`.
- Residual: test records left in the sandbox (category 16, customer 2, orders 22-cancelled/24) — real
  but harmless QA data.

## Round 3 — `create_product` (write-S0, 2026-09-19, live store via ngrok)

New write tool verified against the real store:

| Tool             | Check                                                                                                                                              | Result                                                                                                               |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| `create_product` | `POST products {name, type:'simple', status:'draft', regular_price, short_description, categories:[{id:16}], manage_stock:true, stock_quantity:7}` | ✅ product **id 25** created; `categories` echoed as `[16]`, `manage_stock:true`, `stock_quantity:7`, `status:draft` |

- **Field facts confirmed (the shape `create_product` assumes):** `type:'simple'` accepted; a category
  is passed as `categories:[{id:<number>}]` and echoed back as `[<id>]`; `manage_stock:true` is required
  for `stock_quantity` to stick (same rule as `update_stock`); `short_description` is a distinct field
  from `description`; omitting `status` and sending `draft` both yield a draft (we default to `draft`,
  mirroring `shopify_create_product` — never auto-publish an unfinished product).
- **Images intentionally NOT set (Mateo/Sara call, 2026-09-19).** No provider in the stack uploads
  product images today (`shopify_create_product` sets none; Toteat only reads Toteat's photo URLs), so
  `create_product` v1 omits images. WooCommerce ingests images by URL (`images:[{src}]`); adding that —
  and the "photo sent in chat → host → URL" pipeline — is a separate, cross-provider follow-up.
- Residual: draft product **id 25** left in the sandbox — a real but harmless QA record.
