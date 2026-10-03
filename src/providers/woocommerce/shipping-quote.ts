import { ProviderErrorCode } from '../../core/errors';
import type { FetchLike } from '../../core/http';
import { mapHttpStatusToErrorCode } from '../../core/http';

/**
 * Live shipping quote via the WooCommerce **Store API** (`wc/store/v1/cart`) — the store's OWN
 * checkout calculation, which is the only cart-accurate source of a freight price. The admin REST
 * `shipping/zones` exposes the CONFIGURED base rate, not the cart price (which depends on the
 * product's shipping class); see `docs/design/woocommerce-shipping-quote/write-s0-shipping-evidence.md`.
 *
 * The Store API is PUBLIC (no consumer key), so this does NOT use the authed client — it uses the
 * provider's SSRF-safe fetch directly, which is also the only way to read the `Nonce` / `Cart-Token`
 * RESPONSE headers the cart flow needs (the core transport returns the parsed body only). A cart
 * mutation without a nonce returns 401 but still hands the `Nonce` + `Cart-Token` back in the
 * headers; the nonce ROTATES per response, so it is re-captured and carried forward. The cart is a
 * throwaway server-side session that expires and places no order.
 *
 * v1 quotes by `productId` + quantity. WooCommerce shipping is shipping-class based and classes live
 * on the parent product, so the parent id yields the store's shipping cost; variation-level weight
 * nuances are a documented follow-up.
 */

const STORE_API = 'wp-json/wc/store/v1';

export interface ShippingItem {
  readonly productId: string;
  readonly quantity: number;
}

export interface ShippingDestination {
  readonly country: string;
  readonly state?: string;
  readonly city?: string;
  readonly postcode?: string;
}

/** Curated shipping option. `cost` is a major-unit decimal string, ready to hand to `create_order`. */
export interface WooShippingOption {
  readonly rateId: string;
  readonly methodId: string;
  readonly title: string;
  readonly cost: string;
  readonly currencyCode: string;
  readonly currencyMinorUnit: number;
  readonly selected: boolean;
}

export type ShippingQuoteResult =
  | { readonly ok: true; readonly options: WooShippingOption[] }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

interface RawRate {
  readonly rate_id?: string;
  readonly name?: string;
  readonly method_id?: string;
  readonly price?: string;
  readonly currency_code?: string;
  readonly currency_minor_unit?: number;
  readonly selected?: boolean;
}
interface RawCart {
  readonly shipping_rates?: ReadonlyArray<{ readonly shipping_rates?: readonly RawRate[] }>;
}

/** A minor-unit integer string → a major-unit decimal string per the currency's minor unit. */
export function toMajorUnit(price: string, minorUnit: number): string {
  const n = Number(price);
  if (!Number.isFinite(n)) return '0';
  if (!minorUnit || minorUnit <= 0) return String(Math.round(n));
  return (n / 10 ** minorUnit).toFixed(minorUnit);
}

function storeError(status: number): ShippingQuoteResult {
  return {
    ok: false,
    code: mapHttpStatusToErrorCode(status),
    message: `WooCommerce shipping quote error (HTTP ${status})`,
  };
}

export async function quoteShipping(
  fetchImpl: FetchLike,
  storeUrl: string,
  items: readonly ShippingItem[],
  destination: ShippingDestination,
): Promise<ShippingQuoteResult> {
  const base = `${storeUrl.replace(/\/+$/, '')}/${STORE_API}`;
  let nonce = '';
  let cartToken = '';
  const capture = (res: Response): void => {
    const n = res.headers.get('nonce');
    const t = res.headers.get('cart-token');
    if (n) nonce = n;
    if (t) cartToken = t;
  };
  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    ...(nonce ? { Nonce: nonce } : {}),
    ...(cartToken ? { 'Cart-Token': cartToken } : {}),
  });

  try {
    // 1) Prime — obtain the Nonce + Cart-Token from the response headers.
    capture(await fetchImpl(`${base}/cart`, { method: 'GET' }));
    // 2) Add each item to the throwaway cart.
    for (const it of items) {
      const res = await fetchImpl(`${base}/cart/add-item`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ id: Number(it.productId), quantity: it.quantity }),
      });
      capture(res);
      if (!res.ok) return storeError(res.status);
    }
    // 3) Set the destination so the store recalculates shipping for it.
    const upd = await fetchImpl(`${base}/cart/update-customer`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        shipping_address: {
          country: destination.country,
          ...(destination.state ? { state: destination.state } : {}),
          ...(destination.city ? { city: destination.city } : {}),
          ...(destination.postcode ? { postcode: destination.postcode } : {}),
        },
      }),
    });
    capture(upd);
    if (!upd.ok) return storeError(upd.status);
    const cart = (await upd.json()) as RawCart;
    // 4) Flatten the per-package rates into curated options. Empty ⇒ the store does not serve the
    //    destination (the caller says so; it never estimates).
    const options: WooShippingOption[] = (cart.shipping_rates ?? [])
      .flatMap((pkg) => pkg.shipping_rates ?? [])
      .filter((r): r is RawRate & { rate_id: string } => typeof r.rate_id === 'string')
      .map((r) => ({
        rateId: r.rate_id,
        methodId: r.method_id ?? '',
        title: r.name ?? '',
        cost: toMajorUnit(r.price ?? '0', r.currency_minor_unit ?? 0),
        currencyCode: r.currency_code ?? '',
        currencyMinorUnit: r.currency_minor_unit ?? 0,
        selected: Boolean(r.selected),
      }));
    return { ok: true, options };
  } catch {
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
      message: 'WooCommerce shipping quote: transport failure',
    };
  }
}
