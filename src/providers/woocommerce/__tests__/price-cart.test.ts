import { describe, expect, it, vi } from 'vitest';

import { SecretString } from '../../../core/secret-string';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { createWoocommerceProvider } from '../provider';

const CTX: ProviderCallContext = {
  credential: { secret: new SecretString('ck_test:cs_test') },
  metadata: { storeUrl: 'https://store.example.com' },
};

function successData(result: ToolResult): unknown {
  if (result.kind !== 'success') throw new Error(`expected success, got: ${result.message}`);
  return result.data;
}

const H = { 'content-type': 'application/json', Nonce: 'n-1', 'Cart-Token': 'tok-1' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: H });

// Shapes recorded from The Chair's real cart, 2026-10-23 (Discount Rules 15 %, IVA 19 % included in
// the displayed price, COP minor unit 0). The plugin rewrites the line price; total_discount is "0".
const VARIATION = {
  id: 101517,
  type: 'variation',
  quantity: 1,
  prices: {
    price: '656200',
    regular_price: '772000',
    sale_price: '656200',
    currency_minor_unit: 0,
  },
  totals: { line_subtotal: '551429', line_total: '551429', line_total_tax: '104771' },
};
const SIMPLE_X3 = {
  id: 102985,
  type: 'simple',
  quantity: 3,
  prices: {
    price: '123250',
    regular_price: '145000',
    sale_price: '123250',
    currency_minor_unit: 0,
  },
  totals: { line_subtotal: '310714', line_total: '310714', line_total_tax: '59036' },
};
const TOTALS = {
  total_items: '862143',
  total_items_tax: '163807',
  total_discount: '0',
  total_shipping: '0',
  total_tax: '163807',
  total_price: '1025950',
  currency_code: 'COP',
  currency_minor_unit: 0,
};

/** A Store API double: add-item answers per id (201 by default); the cart read returns `cart`. */
function cartFetch(cart: unknown, addItem: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${u.replace(/^.*\/wc\/store\/v1/, '')}`);
    if (u.endsWith('/cart/items') && method === 'DELETE') return json([]);
    if (u.endsWith('/cart/add-item')) {
      const id = String(JSON.parse(String(init?.body)).id);
      return (addItem[id] ?? (() => json({}, 201)))();
    }
    if (u.endsWith('/cart/update-customer') || u.endsWith('/cart')) return json(cart);
    return json({}, 404);
  });
  return { impl: impl as unknown as typeof globalThis.fetch, calls };
}
const refuse = (code: string, message: string) => () =>
  json({ code, message, data: { status: 400 } }, 400);

const price = (impl: typeof globalThis.fetch, args: Record<string, unknown>) =>
  createWoocommerceProvider({ fetchImpl: impl }).callTool('mcp_woocommerce_price_cart', args, CTX);

describe('woocommerce provider — price_cart (Store API, #140)', () => {
  it('prices each line as the cart charges it — variation, quantity > 1, a refused line in place', async () => {
    const { impl, calls } = cartFetch(
      { items: [VARIATION, SIMPLE_X3], totals: TOTALS },
      {
        '102943': refuse(
          'woocommerce_rest_product_out_of_stock',
          'No puedes añadir «WASSILY» al carrito porque el producto está agotado.',
        ),
      },
    );
    const result = await price(impl, {
      items: [
        { productId: '101517', quantity: 1 },
        { productId: '102943', quantity: 1 },
        { productId: '102985', quantity: 3 },
      ],
    });
    expect(successData(result)).toEqual({
      lines: [
        {
          productId: '101517',
          status: 'priced',
          type: 'variation',
          quantity: 1,
          unitPrice: '656200',
          regularUnitPrice: '772000',
          discounted: true,
          lineSubtotal: '551429',
          lineTotal: '551429',
          lineTax: '104771',
        },
        {
          productId: '102943',
          status: 'rejected',
          quantity: 1,
          code: 'woocommerce_rest_product_out_of_stock',
          message: 'No puedes añadir «WASSILY» al carrito porque el producto está agotado.',
        },
        {
          productId: '102985',
          status: 'priced',
          type: 'simple',
          quantity: 3,
          unitPrice: '123250',
          regularUnitPrice: '145000',
          discounted: true,
          lineSubtotal: '310714',
          lineTotal: '310714',
          lineTax: '59036',
        },
      ],
      totals: {
        items: '862143',
        itemsTax: '163807',
        discount: '0',
        shipping: null, // no destination: the cart's "0" is not a free-shipping offer
        tax: '163807',
        total: '1025950',
        currencyCode: 'COP',
        currencyMinorUnit: 0,
      },
    });
    // Emptied before the items go in and again at the end; no address is set without a destination.
    expect(calls[0]).toBe('GET /cart');
    expect(calls[1]).toBe('DELETE /cart/items');
    expect(calls.at(-1)).toBe('DELETE /cart/items');
    expect(calls.some((c) => c.endsWith('/update-customer'))).toBe(false);
  });

  it('a variable product added by its parent is refused per line with the store code', async () => {
    const { impl } = cartFetch(
      { items: [], totals: TOTALS },
      {
        '100606': refuse(
          'woocommerce_rest_missing_attributes',
          'Faltan atributos para el producto variable.',
        ),
      },
    );
    const result = await price(impl, { items: [{ productId: '100606', quantity: 1 }] });
    expect(successData(result)).toMatchObject({
      lines: [
        { productId: '100606', status: 'rejected', code: 'woocommerce_rest_missing_attributes' },
      ],
    });
  });

  it('a store with no cart rule: the price is the list price and nothing is discounted', async () => {
    const plain = {
      ...SIMPLE_X3,
      prices: {
        price: '145000',
        regular_price: '145000',
        sale_price: '145000',
        currency_minor_unit: 0,
      },
    };
    const { impl } = cartFetch({ items: [plain], totals: TOTALS });
    const result = await price(impl, { items: [{ productId: '102985', quantity: 3 }] });
    expect(successData(result)).toMatchObject({
      lines: [
        { status: 'priced', unitPrice: '145000', regularUnitPrice: '145000', discounted: false },
      ],
      totals: { discount: '0' },
    });
  });

  it('with a destination it prices the freight too, in the same call', async () => {
    const rate = {
      rate_id: 'flat_rate:2',
      name: 'Envío',
      method_id: 'flat_rate',
      price: '18000',
      currency_code: 'COP',
      currency_minor_unit: 0,
      selected: true,
    };
    const { impl, calls } = cartFetch({
      items: [SIMPLE_X3],
      totals: { ...TOTALS, total_shipping: '18000', total_price: '1043950' },
      shipping_rates: [{ package_id: 0, shipping_rates: [rate] }],
    });
    const result = await price(impl, {
      items: [{ productId: '102985', quantity: 3 }],
      destination: { country: 'CO', state: 'CO-DC' },
    });
    expect(successData(result)).toMatchObject({
      totals: { shipping: '18000', total: '1043950' },
      shippingOptions: [{ rateId: 'flat_rate:2', cost: '18000', selected: true, packageId: '0' }],
    });
    expect(calls).toContain('POST /cart/update-customer');
  });

  it('without a destination there is no shippingOptions key at all', async () => {
    const { impl } = cartFetch({ items: [SIMPLE_X3], totals: TOTALS });
    const data = successData(
      await price(impl, { items: [{ productId: '102985', quantity: 3 }] }),
    ) as Record<string, unknown>;
    expect('shippingOptions' in data).toBe(false);
  });

  it('a price the store did not send is absent, never 0', async () => {
    const noPrice = { ...SIMPLE_X3, prices: { currency_minor_unit: 0 }, totals: {} };
    const { impl } = cartFetch({ items: [noPrice], totals: {} });
    const result = await price(impl, { items: [{ productId: '102985', quantity: 3 }] });
    expect(successData(result)).toMatchObject({
      lines: [
        {
          status: 'priced',
          unitPrice: null,
          regularUnitPrice: null,
          discounted: null,
          lineTotal: null,
        },
      ],
      totals: { items: null, total: null },
    });
  });

  it('converts minor units like the freight does (USD, minor unit 2)', async () => {
    const usd = {
      id: 7,
      type: 'simple',
      quantity: 1,
      prices: { price: '1500', regular_price: '2000', currency_minor_unit: 2 },
      totals: { line_subtotal: '1500', line_total: '1500', line_total_tax: '0' },
    };
    const { impl } = cartFetch({
      items: [usd],
      totals: { total_price: '1500', currency_minor_unit: 2 },
    });
    const result = await price(impl, { items: [{ productId: '7', quantity: 1 }] });
    expect(successData(result)).toMatchObject({
      lines: [{ unitPrice: '15.00', regularUnitPrice: '20.00', lineTotal: '15.00' }],
      totals: { total: '15.00' },
    });
  });

  it('an item the store accepted but the cart does not hold comes back as that fact', async () => {
    const { impl } = cartFetch({ items: [], totals: TOTALS });
    const result = await price(impl, { items: [{ productId: '5', quantity: 1 }] });
    expect(successData(result)).toMatchObject({
      lines: [{ productId: '5', status: 'rejected', code: 'not_in_cart' }],
    });
  });

  it('a store error on add-item fails the call and still empties the cart', async () => {
    const { impl, calls } = cartFetch({ items: [], totals: TOTALS }, { '5': () => json({}, 503) });
    const result = await price(impl, { items: [{ productId: '5', quantity: 1 }] });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe('PROVIDER_UNAVAILABLE');
    expect(calls.at(-1)).toBe('DELETE /cart/items');
  });

  it('a 401 from the public cart is the store refusing it, not an expired credential', async () => {
    const { impl } = cartFetch({ items: [], totals: TOTALS }, { '5': () => json({}, 401) });
    const result = await price(impl, { items: [{ productId: '5', quantity: 1 }] });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe('PROVIDER_ERROR');
  });

  it('refuses a repeated productId before any call — the cart would merge the lines', async () => {
    const { impl, calls } = cartFetch({ items: [], totals: TOTALS });
    const result = await price(impl, {
      items: [
        { productId: '5', quantity: 1 },
        { productId: '5', quantity: 2 },
      ],
    });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe('PROVIDER_INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('says it is read-only: a throwaway cart, emptied, no order placed', () => {
    const tool = createWoocommerceProvider()
      .listTools()
      .find((t) => t.name === 'mcp_woocommerce_price_cart');
    expect(tool?.description).toMatch(/cart/i);
    expect(tool?.description).toMatch(/empt/i);
    expect(tool?.description).toMatch(/no order/i);
  });
});
