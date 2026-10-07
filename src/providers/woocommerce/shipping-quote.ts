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
 * Items are added by `productId` + quantity, where `productId` is a product OR a variation id — a
 * consumer must send a variation's OWN id: the Store API refuses a variable product added by its
 * parent (verified live on the sandbox, backend #1303 e2e).
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
  /**
   * The cart package this rate prices. The store selects ONE rate per package, so a split cart
   * (shipping classes, bulky items) charges one rate from each package.
   */
  readonly packageId: string;
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
  readonly shipping_rates?: ReadonlyArray<{
    readonly package_id?: number | string;
    readonly shipping_rates?: readonly RawRate[];
  }>;
}

/** A minor-unit integer string → a major-unit decimal string per the currency's minor unit. */
export function toMajorUnit(price: string, minorUnit: number): string {
  const n = Number(price);
  if (!Number.isFinite(n)) return '0';
  if (!minorUnit || minorUnit <= 0) return String(Math.round(n));
  return (n / 10 ** minorUnit).toFixed(minorUnit);
}

function storeError(status: number): ShippingQuoteResult {
  // The Store API is public and carries no credential, so a 401/403 here is the store refusing the
  // cart (a security plugin, carts disabled) — never an expired credential. Mapping it to
  // AUTH_EXPIRED would send the consumer into a reconnect flow for a credential it never sent.
  const mapped = mapHttpStatusToErrorCode(status);
  return {
    ok: false,
    code: mapped === ProviderErrorCode.AUTH_EXPIRED ? ProviderErrorCode.PROVIDER_ERROR : mapped,
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
    // 1b) Start from an EMPTY cart. The session is not always fresh: a store whose anonymous
    //     requests resolve to a persistent session (a session/auth plugin; the Local sandbox resolves
    //     them to its admin) hands back a cart that already holds items — and they would be priced
    //     into the freight, then overflow stock (backend #1303 e2e, 2026-10-03).
    const emptied = await fetchImpl(`${base}/cart/items`, { method: 'DELETE', headers: headers() });
    capture(emptied);
    if (!emptied.ok) return storeError(emptied.status);
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
    const options: WooShippingOption[] = (cart.shipping_rates ?? []).flatMap((pkg, index) =>
      (pkg.shipping_rates ?? [])
        // A rate without a readable price is dropped, never defaulted: a "0" would charge free
        // freight the store did not offer. A real free rate arrives as "0" and stays.
        .filter(
          (r): r is RawRate & { rate_id: string; price: string } =>
            typeof r.rate_id === 'string' &&
            typeof r.price === 'string' &&
            r.price.trim() !== '' &&
            Number.isFinite(Number(r.price)),
        )
        .map((r) => ({
          rateId: r.rate_id,
          methodId: r.method_id ?? '',
          title: r.name ?? '',
          cost: toMajorUnit(r.price, r.currency_minor_unit ?? 0),
          currencyCode: r.currency_code ?? '',
          currencyMinorUnit: r.currency_minor_unit ?? 0,
          selected: Boolean(r.selected),
          packageId: String(pkg.package_id ?? index),
        })),
    );
    return { ok: true, options };
  } catch {
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
      message: 'WooCommerce shipping quote: transport failure',
    };
  } finally {
    // Leave nothing of ours in the session, whatever happened above. Best-effort: the quote's answer
    // is already decided, so a failed cleanup must not change it.
    if (cartToken) {
      await fetchImpl(`${base}/cart/items`, { method: 'DELETE', headers: headers() }).catch(
        () => undefined,
      );
    }
  }
}
