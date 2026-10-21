# WooCommerce — shipping tools: provider scope

- **Status:** proposal (2026-10-03) · before `/feature-design`
- **Full plan and phase order:** `xcale-backend/docs/design/woocommerce-shipping-tools/roadmap.md`
- **Tracking:** the epic issue in matesjara/xcale-backend (linked from #120). This doc is not a backlog.
- **Builds on:** #120 (`quote_shipping`, `shippingLines`, `currency`/`shippingTotal`, `packageId`) and its
  evidence, `docs/design/woocommerce-shipping-quote/write-s0-shipping-evidence.md`.

This document pins down **what the provider owns** for each of the 5 tools. All of them follow the
provider's pattern: curated responses, typed provider errors, safe egress, additive contract.

## Current inventory

| Tool | State |
|:-----|:------|
| `list_shipping_zones`, `get_shipping_zone_locations`, `get_shipping_zone_methods` | Exist (read, merchant view). `get_shipping_zone_methods` returns the base rate, not the cart price |
| `quote_shipping` | Exists (#120): Store API cart, options per package |
| `list_orders`, `get_order` | Exist (merchant read) |
| Shipment tracking | Missing: WooCommerce core has none |
| Webhooks | Missing (created/managed over REST `wc/v3/webhooks`) |

## What gets added, per tool

| # | Tool | Provider change | Contract |
|:--|:-----|:----------------|:---------|
| 1 | Shipment Tracking | `get_order_tracking` (read): reads the `_wc_shipment_tracking_items` meta from `GET /orders/{id}` and, when present, `wc-shipment-tracking/v3/orders/{id}/shipment-trackings`. Curated: `{ trackings: [{ carrier, trackingNumber, trackingUrl?, shippedAt? }] }`; empty ⇒ no tracking recorded yet | New tool, additive |
| 2 | Order Status & Tracking | `get_order`: add to `WooOrderDetail` what status needs (`datePaid`, `dateCompleted`, shipping lines). The buyer scope is the backend's, not the provider's | Additive fields |
| 3 | Shipping Zones & Methods | ✅ **Done (2026-10-03):** `get_country_states` (control-plane): `{ country }` → `GET /wc/v3/data/countries/{CC}` → `{ code, name, states: [{ code, name }] }`; no country → `{ countries: [{ code, name }] }`. The backend normalizes "Quindío" → `CO-QUI` | New tool, additive |
| 4 | Store API / Cart API | `quote_cart` over the `quote_shipping` flow (`apply-coupon`, `totals`) → `{ subtotal, discounts, shipping, taxes, total, currency }`; reuses the nonce/cart-token handling and the minor-unit conversion | New tool, additive |
| — | Unpaid-order expiry (2026-10-04) | ✅ `get_hold_stock_minutes` (control-plane, `settings/products`: the store's *Hold stock (minutes)*, `null` unless it manages stock and holds ≥ 1 min — WooCommerce's own rule) and `list_unpaid_orders({ before })` (control-plane, `pending` orders created before a UTC instant with `dates_are_gmt`, oldest first, only those carrying `_xcale_order_ref`). The expiry decision and the cancel live in the backend | Control-plane tools |
| 5 | Webhooks | ✅ **Done (2026-10-03):** `ensure_order_webhook` (control-plane) over `wc/v3/webhooks` — subscribes `order.updated` at the delivery URL with the per-connection secret; idempotent (an existing webhook at that URL is reused, secret refreshed, re-activated). Receiving and HMAC verification live in the backend. `remove_order_webhook` not built yet | Control-plane tool |

## Open questions (before design)

- **Tracking at The Chair:** a plugin (which one) or a manual order note? That decides tool 1's source.
- **Webhooks:** does the tenants' REST key (`read_write`) allow creating webhooks on every install?
  Verify on the sandbox, as #120's write-S0 did.
- ~~Variations on the Store API~~ — resolved: confirmed live by the backend #1303 e2e (2026-10-03).
