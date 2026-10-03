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
| 3 | Shipping Zones & Methods | `get_country_states` (read): `GET /wc/v3/data/countries/{cc}` → `{ states: [{ code, name }] }`, so the backend can normalize "Quindío" → `CO-QUI` | New tool, additive |
| 4 | Store API / Cart API | `quote_cart` over the `quote_shipping` flow (`apply-coupon`, `totals`) → `{ subtotal, discounts, shipping, taxes, total, currency }`; reuses the nonce/cart-token handling and the minor-unit conversion | New tool, additive |
| 5 | Webhooks | Control-plane (`ToolDefinition.controlPlane`, never shown to a model): `ensure_order_webhook` / `remove_order_webhook` over `wc/v3/webhooks` (`order.updated`, `delivery_url`, `secret`). Receiving and HMAC verification live in the backend | Control-plane tools |

## Open questions (before design)

- **Tracking at The Chair:** a plugin (which one) or a manual order note? That decides tool 1's source.
- **Webhooks:** does the tenants' REST key (`read_write`) allow creating webhooks on every install?
  Verify on the sandbox, as #120's write-S0 did.
- **Variations on the Store API:** confirm live that `add-item` with a variation id quotes correctly
  (#120's write-S0 only exercised a simple product).
