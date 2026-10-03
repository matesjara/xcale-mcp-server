# WooCommerce Shipping Quote — write-S0 Evidence

> **Date**: 2026-10-03 · **Store**: `woo-sandbox-01` (LocalWP, `localhost:10004`)
> **Method**: live calls against the real store. The **quote** half uses the WooCommerce **Store API**
> (`/wp-json/wc/store/v1`, public, no consumer key); the **charge** half uses the admin REST
> (`/wp-json/wc/v3`, `consumer_key`/`consumer_secret`). Evidence-before-contract for
> `mcp_woocommerce_quote_shipping` + the `shipping_lines` addition to `create_order`.
> **Issues**: provider `matesjara/xcale-mcp-server#120`, backend epic `matesjara/xcale-backend#1303`.

## Why this exists

A WooCommerce order created through the admin REST (`wc/v3/orders`) carries **no shipping line unless
we send one** — the REST API does not run the store's shipping calculation. And `get_shipping_zone_methods`
returns the **configured base rate**, not the cart price (which depends on the product's shipping class).
So v1 sold the products only and left the freight uncollected. For a furniture tenant (The Chair) freight
is part of every sale, so the agent must (1) **quote** the real freight to the buyer's address and (2)
**charge** it on the order.

## Half 1 — Quote: the Store API cart (`wc/store/v1`)

The store's own checkout calculation is exposed by the public Store API. Confirmed flow:

1. **Nonce is required, and the server hands it to us.** A cart mutation without a nonce returns
   `401 woocommerce_rest_missing_nonce`, **but the response headers already carry `Nonce` and
   `Cart-Token`** (even on the 401). So the headless flow is: prime any cart request → read the
   `Nonce` + `Cart-Token` response headers → use them on the next call. The `Nonce` **rotates** on
   every response, so always carry the latest one forward; the `Cart-Token` (a JWT) keeps the same
   throwaway cart across calls. No consumer key, no cookie.
2. **Add items** — `POST /cart/add-item` `{ id, quantity }` (product or variation id).
3. **Set the destination** — `POST /cart/update-customer` `{ shipping_address: { country, state, city, postcode } }`.
   - **`state` must be ISO 3166-2** (`CO-QUI`, `CO-DC`, …). A bare `QUI` returns `400 rest_invalid_param`
     whose error body lists the valid codes — a clean signal the tool can surface, not guess.
4. **Read `shipping_rates`** from the cart response. Shape (nested — per shipping package, then rates):

```jsonc
cart.shipping_rates[<package>].shipping_rates[<rate>] = {
  rate_id: "flat_rate:2",
  name: "Flat rate",
  method_id: "flat_rate",
  price: "18000",              // STRING, in MINOR units (see Units below)
  currency_code: "COP",
  currency_minor_unit: 0,
  selected: false,             // the rate WooCommerce defaults to
  delivery_time: "", description: "", taxes: "0"
}
```

Measured (`localhost:10004`, cart = 2× product 26): both Armenia (`CO-QUI`, zone 1 "Córdoba, Quindío")
and Bogotá (`CO-DC`, zone 0 "rest") returned **Free shipping `0`** (selected) **+ Flat rate `18000` COP**.
The sandbox's two zones happen to carry the same methods, so it proves the **mechanism and shapes**, not
per-city variation. Real per-destination variation is Esteban's live evidence on **The Chair**
(#120): the TOGO lounge chair quotes **$180.000 to Bogotá, $0 to Armenia** — exactly why the quote must
come from the store, never estimated by us.

## Half 2 — Charge: `shipping_lines` on `create_order` (`wc/v3`)

`POST /wc/v3/orders` with a `shipping_lines` entry adds the freight to the order total. Confirmed:

- Sent: `line_items:[{product_id:26, quantity:2}]` + `shipping_lines:[{method_id:"flat_rate", method_title:"Flat rate", total:"18000"}]`.
- Result — **order 32**: `total: "218000"` (200.000 products + 18.000 freight), `shipping_total: "18000"`,
  and `payment_url` now reflects the full total. So a quoted rate, written back as a shipping line, makes
  the pay link charge the freight.

## Units (the one real gotcha)

- The **Store API** `price` is a **string in MINOR units** alongside `currency_minor_unit` (COP → 0, so
  `"18000"` = 18.000 COP; a 2-decimal currency → `"1500"` = 15.00).
- The **admin REST** order totals and `shipping_lines[].total` are a **major-unit decimal string**
  (`"18000"` for COP, `"15.00"` for USD).
- So the consumer converts: `create_order shipping total = storeApiPrice / 10^currency_minor_unit`,
  formatted with `currency_minor_unit` decimals. For COP they coincide; for 2-decimal currencies they do
  not. The `quote_shipping` tool should return BOTH the raw `price` + `currencyMinorUnit` (so no precision
  is lost) and a ready-to-send major-unit string the charge path can use verbatim.

## Contract decisions (drive the api-contract)

- **`mcp_woocommerce_quote_shipping`** (read) — input: `items:[{productId, variationId?, quantity}]` +
  `destination:{country, state?, city?, postcode?}`. Output: `options:[{rateId, methodId, title, cost,
  currencyMinorUnit, currencyCode, selected}]`, where `cost` is the major-unit decimal string ready for
  `create_order`. A destination the store does not serve → empty `options` (the agent says so, never
  estimates). Implemented over the Store API with the prime→nonce→add→update→read flow above, through the
  existing safe egress; the throwaway cart is server-side session state that expires and places no order.
- **`create_order`** — add optional `shippingLines:[{methodId, methodTitle, total}]` → WooCommerce
  `shipping_lines`. Additive; absent ⇒ current behaviour (no freight).

## Residual / cleanup

- Test **order 32** (`pending`, total 218.000, with the flat-rate line) left in the sandbox — a real but
  harmless QA record.
