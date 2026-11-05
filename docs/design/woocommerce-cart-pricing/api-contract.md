# WooCommerce cart pricing — `mcp_woocommerce_price_cart` (#140)

> **Last modified:** 2026-11-05 · **Status:** implemented · **Issue:** matesjara/xcale-mcp-server#140 · **Epic:** matesjara/xcale-backend#1545
> · **Consumer:** matesjara/xcale-backend#1546 (charge) and #1547 (quote).

## Why

A store can price in the cart with a discount-rules plugin, quantity pricing or exclusions. The admin REST product reads return the price before those rules. The store's public **Store API cart** (`wp-json/wc/store/v1/cart`) runs the same calculation as the storefront, so it is the one source of what the store will charge. `quote_shipping` already drives that cart but keeps only `shipping_rates`. This tool publishes the rest.

**Decision: a new tool, not an extension of `quote_shipping`.** The freight quote's shape stays byte-for-byte unchanged, and this tool works with or without a destination. With one, a single call prices both the lines and the freight.

## Input

```ts
{
  items: { productId: string /* numeric; a variation's OWN id */; quantity: number /* int > 0 */ }[]; // min 1, each productId once
  destination?: { country: string; state?: string; city?: string; postcode?: string };    // same as quote_shipping
}
```

A repeated `productId` is refused before any call, because the cart would merge the two lines into one.

## Output (`ok` data)

```ts
{
  lines: (                                      // one per requested item, in the order asked
    | { productId; status: 'priced'; type: string | null; quantity: number;
        unitPrice: string | null;        // as the store DISPLAYS it (may include tax)
        regularUnitPrice: string | null; // same display basis
        discounted: boolean | null;      // unitPrice < regularUnitPrice; null if either is missing
        lineSubtotal: string | null;     // tax-exclusive, before cart discounts (line_subtotal)
        lineTotal: string | null;        // tax-exclusive, what the line charges (line_total) → create_order line `total` (#141)
        lineTax: string | null }
    | { productId; status: 'rejected'; quantity: number /* asked */; code: string; message: string }
  )[];
  totals: { items; itemsTax; discount;
            shipping;  // the selected rate of each package; null without a destination, for an unserved address, or a package with no selected rate
            tax;       // without a destination: computed for the store's default location
            total;     // the priced lines only; with a destination, includes the selected rate of each package; null when shipping is unknown
            currencyCode: string | null; currencyMinorUnit: number | null };
  needsShipping: boolean | null;                // the cart's own `needs_shipping`; null when the store does not say
  shippingOptions?: WooShippingOption[];        // only with a destination; same shape as quote_shipping
}
```

Rules:

- **A refused line is a fact, not a failed call.** When the store answers `add-item` with 400, the store's own `code` and `message` are returned for that line. If the store accepted an item but the cart read does not hold it, the line comes back as `code: 'not_in_cart'`. Any other non-OK status (401/403 → `PROVIDER_ERROR`, 5xx → `PROVIDER_UNAVAILABLE`) fails the call.
- **A price that cannot be read is `null`, never `"0"`.** A line whose `line_total` or quantity cannot be read is not priced: it comes back `status: 'rejected'`, `code: 'unreadable_line'`, since `lineTotal` is what an order charges.
- **The totals cover only the priced lines.** With a rejected line, `totals.total` is the total of the others, not of everything asked.
- **An address the store does not serve is a successful answer, not an error** (CTO, 2026-10-27, #168). `needsShipping: true` with no `shippingOptions` means the store does not ship there: `shipping: null` and `totals.total: null`, while the lines stay priced and `items` and `tax` stay. The cart reports `"0"` freight there, and passing it on would read as free shipping to an address the store cannot reach.
- **`totals.total` includes the rate the store selected for each package** (the `selected: true` option). When a package has no selected rate, `shipping` and `total` are `null`. For another option, the payable figure is the one `create_order` returns, never `total − selected + other`, because freight can carry tax.
- **An all-virtual cart** (`needsShipping: false`) keeps the store's `"0"` freight, which is true there. A store that does not say `needs_shipping` is treated as needing shipping.
- **The price is an anonymous guest's** (CPO, 2026-10-27, #168): it includes what the store applies in the cart on its own; no coupon code the customer mentions is checked or applied, and prices tied to who the buyer is (wholesale, first order, per email) are not included. A pay link built from this price charges this price. The description says only that, and never promises that a code is applied at checkout. Codes come next, quoting and charging together: matesjara/xcale-mcp-server#177.
- **No arithmetic beyond the minor-unit conversion**, which is the same as the freight's. The one comparison is `discounted`.
- **Session discipline is the same as the freight quote.** The cart is anonymous and throwaway, with no credential sent. It is emptied before the items go in and again at the end, whatever happens. No order is placed.
- Without a destination, the cart's freight is reported as `null`, not `"0"`: the cart says `"0"` when it has no address, which is not a free-shipping offer.

## Evidence — live, The Chair (2026-10-23)

These shapes were recorded on `thechaircol.com`, which runs Discount Rules at 15 % with IVA 19 % included in the displayed price, in COP (minor unit 0). The run used `scripts/contract-probe.mjs --tool mcp_woocommerce_price_cart --live` against the public cart, with a destination of CO-DC Bogotá:

| Item                                  | Result                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| CUZCO `100558` ×2 (simple)            | priced: `unitPrice` 2187050, `regularUnitPrice` 2573000, `discounted` true, `lineTotal` 3675714, `lineTax` 698386 |
| BOSTON gris `101517` ×1 (variation)   | priced: 656200 vs 772000, `lineTotal` 551429                                                                      |
| WASSILY `102943` (out of stock)       | rejected `woocommerce_rest_product_out_of_stock`                                                                  |
| BOSTON `100606` (variable, by parent) | rejected `woocommerce_rest_missing_attributes`                                                                    |
| totals                                | items 4227143 + tax 803157 + shipping 345000 = total 5375300; `discount` "0"                                      |

What the evidence fixes in the contract:

- **The plugin rewrites the line price.** It does not add a discount, so `totals.discount` is `"0"` while the line is discounted. "On sale" therefore comes from `unitPrice` vs `regularUnitPrice`.
- **The unit price includes tax here, but the line totals never do.** A consumer that sends `unitPrice × quantity` as a `create_order` line `total` charges the tax twice. It must send `lineTotal`.
- 2187050 matches the price The Chair's own pricing snippet publishes over REST, so the two sources cross-check.
