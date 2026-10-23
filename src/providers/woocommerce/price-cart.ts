import { ProviderErrorCode } from '../../core/errors';
import type { FetchLike } from '../../core/http';
import { mapHttpStatusToErrorCode } from '../../core/http';
import type {
  RawCart,
  ShippingDestination,
  ShippingItem,
  WooShippingOption,
} from './shipping-quote';
import { toShippingOptions } from './shipping-quote';

/**
 * What the store's own cart charges, via the WooCommerce **Store API** (`wc/store/v1/cart`). A store
 * can price in the cart — a discount-rules plugin, quantity pricing, exclusions — and the admin REST
 * product reads return the price before those rules; the cart is the same calculation the storefront
 * runs, so it is the only source of what the store will actually charge.
 *
 * Same session discipline as `quoteShipping`: an anonymous, throwaway cart (no credential), emptied
 * before the items go in and again at the end whatever happens; no order is placed. Items are added by
 * a product OR a variation id — the cart refuses a variable product added by its parent.
 *
 * Measured on a real store (The Chair, 2026-10-23, Discount Rules 15 %): the plugin REWRITES the line
 * price rather than adding a discount, so `total_discount` is "0" while the line `price` is below its
 * `regular_price`. The unit `price` is the store's DISPLAY price (tax-inclusive there); the line
 * totals EXCLUDE tax — `line_total` is what `create_order` takes as a line `total`.
 */

const STORE_API = 'wp-json/wc/store/v1';

/** A line the cart priced. Amounts are major-unit decimal strings; null when the store sent none. */
export interface PricedCartLine {
  readonly productId: string;
  readonly status: 'priced';
  /** `simple` | `variation` | … as the store reports it. */
  readonly type: string | null;
  /** The quantity the cart holds — the store may limit it (e.g. a product sold individually). */
  readonly quantity: number;
  /** The unit price the cart charges, as the store displays it (may include tax). */
  readonly unitPrice: string | null;
  /** The unit list price the cart compares against, displayed the same way as `unitPrice`. */
  readonly regularUnitPrice: string | null;
  /** True when the cart charges less than the list price; null when either price is missing. */
  readonly discounted: boolean | null;
  /** The line before cart discounts, tax-exclusive (WooCommerce `line_subtotal`). */
  readonly lineSubtotal: string | null;
  /** What the line charges, tax-exclusive (WooCommerce `line_total`) — `create_order`'s line `total`. */
  readonly lineTotal: string | null;
  /** The tax on `lineTotal`. */
  readonly lineTax: string | null;
}

/** A line the cart refused (out of stock, not purchasable, a variable product without its variation). */
export interface RejectedCartLine {
  readonly productId: string;
  readonly status: 'rejected';
  /** The quantity that was asked for. */
  readonly quantity: number;
  /** The store's own error code, e.g. `woocommerce_rest_product_out_of_stock`. */
  readonly code: string;
  /** The store's own message, in the store's language. */
  readonly message: string;
}

export type CartLine = PricedCartLine | RejectedCartLine;

/** Cart totals as the store computed them. Amounts are major-unit decimal strings; null when absent. */
export interface CartTotals {
  /** The priced lines, tax-exclusive. */
  readonly items: string | null;
  readonly itemsTax: string | null;
  /** Cart-level discounts (coupons). A plugin that rewrites line prices leaves this at "0". */
  readonly discount: string | null;
  /** The freight, only when a destination was given; otherwise null. */
  readonly shipping: string | null;
  readonly tax: string | null;
  /** What the buyer pays. Includes the freight only when a destination was given. */
  readonly total: string | null;
  readonly currencyCode: string | null;
  readonly currencyMinorUnit: number | null;
}

export interface CartPricing {
  /** One per requested item, in the order asked. */
  readonly lines: CartLine[];
  readonly totals: CartTotals;
  /** The freight options for the destination; present only when a destination was given. */
  readonly shippingOptions?: WooShippingOption[];
}

export type PriceCartResult =
  | { readonly ok: true; readonly pricing: CartPricing }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

interface RawCartItem {
  readonly id?: number;
  readonly type?: string;
  readonly quantity?: number;
  readonly prices?: {
    readonly price?: string;
    readonly regular_price?: string;
    readonly currency_minor_unit?: number;
  };
  readonly totals?: {
    readonly line_subtotal?: string;
    readonly line_total?: string;
    readonly line_total_tax?: string;
    readonly currency_minor_unit?: number;
  };
}
interface RawPricedCart extends RawCart {
  readonly items?: readonly RawCartItem[];
  readonly totals?: {
    readonly total_items?: string;
    readonly total_items_tax?: string;
    readonly total_discount?: string;
    readonly total_shipping?: string | null;
    readonly total_tax?: string;
    readonly total_price?: string;
    readonly currency_code?: string;
    readonly currency_minor_unit?: number;
  };
}

/**
 * A minor-unit integer string → a major-unit decimal string; null when it is not a number. Unlike the
 * freight's converter this never yields "0" for an unreadable price: a price that cannot be read is
 * absent, never zero.
 */
function toMajor(value: string | null | undefined, minorUnit: number): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (!minorUnit || minorUnit <= 0) return String(Math.round(n));
  return (n / 10 ** minorUnit).toFixed(minorUnit);
}

function storeError(status: number): PriceCartResult {
  // Public endpoint, no credential sent: a 401/403 is the store refusing the cart, never an expired
  // credential (same reasoning as the freight quote).
  const mapped = mapHttpStatusToErrorCode(status);
  return {
    ok: false,
    code: mapped === ProviderErrorCode.AUTH_EXPIRED ? ProviderErrorCode.PROVIDER_ERROR : mapped,
    message: `WooCommerce cart pricing error (HTTP ${status})`,
  };
}

function toPricedLine(productId: string, item: RawCartItem): PricedCartLine {
  const minor = item.prices?.currency_minor_unit ?? item.totals?.currency_minor_unit ?? 0;
  const unitPrice = toMajor(item.prices?.price, minor);
  const regularUnitPrice = toMajor(item.prices?.regular_price, minor);
  return {
    productId,
    status: 'priced',
    type: item.type ?? null,
    quantity: item.quantity ?? 0,
    unitPrice,
    regularUnitPrice,
    discounted:
      unitPrice !== null && regularUnitPrice !== null
        ? Number(unitPrice) < Number(regularUnitPrice)
        : null,
    lineSubtotal: toMajor(item.totals?.line_subtotal, minor),
    lineTotal: toMajor(item.totals?.line_total, minor),
    lineTax: toMajor(item.totals?.line_total_tax, minor),
  };
}

function toTotals(cart: RawPricedCart, withShipping: boolean): CartTotals {
  const t = cart.totals;
  const minor = t?.currency_minor_unit ?? 0;
  return {
    items: toMajor(t?.total_items, minor),
    itemsTax: toMajor(t?.total_items_tax, minor),
    discount: toMajor(t?.total_discount, minor),
    // Without an address the cart reports "0" freight — not a free-shipping offer, so it is withheld.
    shipping: withShipping ? toMajor(t?.total_shipping, minor) : null,
    tax: toMajor(t?.total_tax, minor),
    total: toMajor(t?.total_price, minor),
    currencyCode: t?.currency_code ?? null,
    currencyMinorUnit: t?.currency_minor_unit ?? null,
  };
}

export async function priceCart(
  fetchImpl: FetchLike,
  storeUrl: string,
  items: readonly ShippingItem[],
  destination?: ShippingDestination,
): Promise<PriceCartResult> {
  const base = `${storeUrl.replace(/\/+$/, '')}/${STORE_API}`;
  let nonce = '';
  let cartToken = '';
  const send = async (path: string, method: string, body?: unknown): Promise<Response> => {
    const res = await fetchImpl(`${base}/${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(nonce ? { Nonce: nonce } : {}),
        ...(cartToken ? { 'Cart-Token': cartToken } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    // The nonce rotates per response; carry the latest forward.
    const n = res.headers.get('nonce');
    const t = res.headers.get('cart-token');
    if (n) nonce = n;
    if (t) cartToken = t;
    return res;
  };

  try {
    await send('cart', 'GET');
    const emptied = await send('cart/items', 'DELETE');
    if (!emptied.ok) return storeError(emptied.status);

    // A refused item is a fact about that line, not a failed call: the store answers 400 with its
    // own code (out of stock, not purchasable, missing variation attributes) and the cart stays usable.
    const rejected = new Map<string, RejectedCartLine>();
    for (const it of items) {
      const res = await send('cart/add-item', 'POST', {
        id: Number(it.productId),
        quantity: it.quantity,
      });
      if (res.ok) continue;
      if (res.status !== 400) return storeError(res.status);
      const body = (await res.json().catch(() => ({}))) as { code?: unknown; message?: unknown };
      rejected.set(it.productId, {
        productId: it.productId,
        status: 'rejected',
        quantity: it.quantity,
        code: typeof body.code === 'string' ? body.code : 'rejected',
        message: typeof body.message === 'string' ? body.message : '',
      });
    }

    let cartRes: Response;
    if (destination) {
      cartRes = await send('cart/update-customer', 'POST', {
        shipping_address: {
          country: destination.country,
          ...(destination.state ? { state: destination.state } : {}),
          ...(destination.city ? { city: destination.city } : {}),
          ...(destination.postcode ? { postcode: destination.postcode } : {}),
        },
      });
    } else {
      cartRes = await send('cart', 'GET');
    }
    if (!cartRes.ok) return storeError(cartRes.status);
    const cart = (await cartRes.json()) as RawPricedCart;

    const lines: CartLine[] = items.map((it) => {
      const refused = rejected.get(it.productId);
      if (refused) return refused;
      const item = (cart.items ?? []).find((i) => String(i.id) === it.productId);
      // Accepted but absent from the cart read: the store dropped it. Said as that, never priced at 0.
      if (!item) {
        return {
          productId: it.productId,
          status: 'rejected',
          quantity: it.quantity,
          code: 'not_in_cart',
          message: 'The store accepted the item but the cart does not hold it.',
        };
      }
      return toPricedLine(it.productId, item);
    });

    return {
      ok: true,
      pricing: {
        lines,
        totals: toTotals(cart, destination !== undefined),
        ...(destination ? { shippingOptions: toShippingOptions(cart) } : {}),
      },
    };
  } catch {
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
      message: 'WooCommerce cart pricing: transport failure',
    };
  } finally {
    // Leave nothing of ours in the session. Best-effort: the answer is already decided.
    if (cartToken) await send('cart/items', 'DELETE').catch(() => undefined);
  }
}
