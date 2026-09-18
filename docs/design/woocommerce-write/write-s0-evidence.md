# WooCommerce Write Tools — write-S0 Evidence

> **Date**: 2026-09-18 · **Store**: `woo-sandbox-01` (LocalWP), exposed via Live Link `encouraging-zone.localsite.io`
> **Method**: direct WooCommerce REST calls (real store). The Live Link enforces its own HTTP Basic gate (`mountain:various`), which collides with WooCommerce's Basic auth — so these run as **direct curls** (tunnel Basic + query-string `consumer_key`/`consumer_secret`), verifying WooCommerce's real behavior. The provider code path is exercised by fixtures + unit tests; write-S0's job is to confirm the WooCommerce facts the contract assumed.
> **Key**: the store REST key was set to **Read/Write** for this run.

## What was verified

| # | Check | Result |
|:--|:--|:--|
| 1 | **create_order** — `POST orders` with `line_items` (variable product 14 / variation 20) + `meta_data:[{key:'_xcale_order_ref', value:<ref>}]` | ✅ Order **id 21** created, `status: pending`, `total: 150000`, and the `_xcale_order_ref` echoed back in `meta_data` |
| 2 | **write authorization** — `PUT products/14/variations/20` (idempotent `{regular_price:"150000"}`) with the R/W key | ✅ `HTTP 200` (a Read-only key would have returned `401 woocommerce_rest_cannot_edit`) |
| 3 | **reconcile query A** — `GET orders?search=<ref>` | ❌ **returned 0** — WooCommerce `search` does **NOT** match `meta_data` |
| 4 | **reconcile query B** — `GET orders?per_page=20` + match `meta_data` in the adapter | ✅ found order 21 by its `_xcale_order_ref` |

## Decision closed (api-contract Q-3)

`?search=<ref>` is unreliable for reconciliation — it does not index `meta_data`, so it would report `found: false` for an order that actually exists, risking a **duplicate** on retry. **Resolution: `reconcile_order` fetches the most recent orders (`per_page=100&orderby=date&order=desc`) and confirms the `_xcale_order_ref` match in the adapter.** Reconcile runs right after a failed create, so the order is among the newest — 100 desc is ample.

- **Bug caught + fixed by this write-S0**: the initial `reconcile_order` used `?search=<ref>` (would have silently failed). Changed to fetch-recent + meta-match; locked by a unit test asserting `per_page=100` and no `search=` in the query.

## Field facts (for the contract)

- `create_order` body accepted: `status`, `line_items:[{product_id:<number>, variation_id?:<number>, quantity}]`, `meta_data:[{key,value}]`, optional `billing`.
- Order response carries `id` (number), `number`, `status`, `total` (string), and the echoed `meta_data`.
- Variation 20/19 of product 14 report `manage_stock: "parent"` (stock managed on the parent) — relevant when targeting `update_stock` at a variation whose parent owns stock.

## Residual / cleanup

- Test order **id 21** (`pending`, total 150000) was left in the sandbox — a real but harmless QA record.
- The idempotent PUT changed nothing (same price).
