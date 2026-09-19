import { describe, expect, it, vi } from 'vitest';

import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { createWoocommerceProvider } from '../provider';

import productsList from '../__fixtures__/products-list.json';
import productGet from '../__fixtures__/product-get.json';
import productVariations from '../__fixtures__/product-variations.json';
import categoriesList from '../__fixtures__/categories-list.json';
import shippingZones from '../__fixtures__/shipping-zones.json';
import shippingMethods from '../__fixtures__/shipping-methods.json';
import shippingLocations from '../__fixtures__/shipping-locations.json';
import ordersList from '../__fixtures__/orders-list.json';
import orderGet from '../__fixtures__/order-get.json';

const CTX: ProviderCallContext = {
  credential: { secret: new SecretString('ck_test:cs_test') },
  metadata: { storeUrl: 'https://store.example.com' },
};

/** A fetch double that records the URL + request headers it was asked for and answers with a fixture. */
function fakeFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const sentHeaders: Record<string, string>[] = [];
  const sentMethods: (string | undefined)[] = [];
  const sentBodies: (string | undefined)[] = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push(String(url));
    sentHeaders.push((init?.headers ?? {}) as Record<string, string>);
    sentMethods.push(init?.method);
    sentBodies.push(init?.body as string | undefined);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return {
    impl: impl as unknown as typeof globalThis.fetch,
    calls,
    sentHeaders,
    sentMethods,
    sentBodies,
  };
}

function provider(body: unknown, status = 200) {
  const { impl, calls, sentHeaders, sentMethods, sentBodies } = fakeFetch(body, status);
  return {
    provider: createWoocommerceProvider({ fetchImpl: impl }),
    calls,
    sentHeaders,
    sentMethods,
    sentBodies,
  };
}

function successData(result: ToolResult): unknown {
  if (result.kind !== 'success') throw new Error(`expected success, got: ${result.message}`);
  return result.data;
}

interface Page {
  items: { id: string; name: string; price: string; stockStatus: string; permalink: string }[];
  page: number;
  pageSize: number;
}

describe('woocommerce provider — catalog surface', () => {
  it('satisfies the generic provider conformance contract', async () => {
    await runProviderConformance(createWoocommerceProvider());
  });

  it('publishes a basic auth descriptor declaring the credential fields (consumer_key, consumer_secret)', () => {
    const auth = createWoocommerceProvider().auth;
    expect(auth.type).toBe('basic');
    if (auth.type === 'basic') {
      // Consumer-agnostic: a consumer learns what to collect (and the Basic order) from the catalog.
      expect(auth.fields.map((f) => f.key)).toEqual(['consumer_key', 'consumer_secret']);
    }
  });

  it('materializes Authorization: Basic base64(consumer_key:consumer_secret) on the request', async () => {
    const { provider: p, sentHeaders } = provider(productsList);
    await p.callTool('mcp_woocommerce_list_products', {}, CTX);
    const expected = 'Basic ' + Buffer.from('ck_test:cs_test').toString('base64');
    expect(sentHeaders[0]?.authorization).toBe(expected);
  });

  it('publishes the storeUrl context so a consumer knows what to forward', () => {
    const p = createWoocommerceProvider();
    const required = (p.contextSchema as { required?: string[] } | undefined)?.required ?? [];
    expect(required).toContain('storeUrl');
  });

  it('publishes storeUrl as format:uri — the cross-repo hint the consumer keys its SSRF handling on', () => {
    const p = createWoocommerceProvider();
    const props =
      (p.contextSchema as { properties?: Record<string, { format?: string }> } | undefined)
        ?.properties ?? {};
    // xcale-backend's `urlContextKeys` classifies a URL context field by this exact hint, then runs
    // `assertSafePublicUrl` + normalization at connect. Dropping it (e.g. z.string() instead of
    // z.string().url()) would silently disable the backend's connect-time SSRF guard.
    expect(props.storeUrl?.format).toBe('uri');
  });

  it('the default transport blocks a store URL that targets an internal address (SSRF)', async () => {
    // No fetchImpl injected → the provider defaults to its SSRF-safe egress. An internal IP literal
    // is rejected before any socket opens, surfaced as a typed tool error, never a fetch to 169.254.
    const p = createWoocommerceProvider();
    const result = await p.callTool(
      'mcp_woocommerce_list_products',
      {},
      {
        credential: { secret: new SecretString('ck_test:cs_test') },
        metadata: { storeUrl: 'https://169.254.169.254' },
      },
    );
    expect(result.kind).toBe('error');
  });

  it('names every tool under the mcp_woocommerce_ prefix', () => {
    const names = createWoocommerceProvider()
      .listTools()
      .map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.startsWith('mcp_woocommerce_')).toBe(true);
  });
});

describe('woocommerce provider — list_products', () => {
  it('builds ${storeUrl}/wp-json/wc/v3/products with paging and returns curated items', async () => {
    const { provider: p, calls } = provider(productsList);
    const result = await p.callTool('mcp_woocommerce_list_products', {}, CTX);

    // URL is built from the forwarded storeUrl context; the credential is NOT in the URL (Basic header).
    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/products?');
    expect(calls[0]).toContain('per_page=25');
    expect(calls[0]).toContain('page=1');

    const data = successData(result) as Page;
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(25);
    expect(data.items).toHaveLength(2);
    expect(data.items[0]).toEqual({
      id: '12',
      name: 'Camiseta',
      price: '100000',
      stockStatus: 'instock',
      stockQuantity: 46,
      permalink: 'https://store.example.com/product/camiseta/',
      status: 'publish',
    });
    // A product with manage_stock=false has no quantity — normalized to null, not omitted.
    expect(data.items[1]?.stockStatus).toBe('outofstock');
  });

  it('forwards search/filter params into the query string', async () => {
    const { provider: p, calls } = provider(productsList);
    await p.callTool(
      'mcp_woocommerce_list_products',
      { search: 'shirt', stockStatus: 'instock' },
      CTX,
    );
    expect(calls[0]).toContain('search=shirt');
    expect(calls[0]).toContain('stock_status=instock');
  });

  it('maps a provider 401 to a typed error (PROVIDER_AUTH_EXPIRED), never throws', async () => {
    const { provider: p } = provider({ code: 'woocommerce_rest_cannot_view' }, 401);
    const result = await p.callTool('mcp_woocommerce_list_products', {}, CTX);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.code).toBe('PROVIDER_AUTH_EXPIRED');
    }
  });
});

describe('woocommerce provider — get_product', () => {
  it('fetches products/{id} and returns curated detail with description stripped to plain text', async () => {
    const { provider: p, calls } = provider(productGet);
    const result = await p.callTool('mcp_woocommerce_get_product', { id: '12' }, CTX);

    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/products/12');
    const data = successData(result) as {
      id: string;
      sku: string | null;
      description: string;
      categories: { id: string; name: string }[];
      images: { src: string }[];
      variations: string[];
    };
    expect(data.id).toBe('12');
    expect(data.sku).toBe('CL-001');
    // HTML tags and entities are gone; text is collapsed.
    expect(data.description).toBe(
      'Camiseta marfil en jersey premium. 100% Algodón & alto gramaje.',
    );
    expect(data.description).not.toContain('<');
    expect(data.categories[0]).toEqual({ id: '15', name: 'Uncategorized' });
    expect(data.images[0]?.src).toContain('96541-1.webp');
    expect(data.variations).toEqual([]);
  });

  it('strips tags even when an attribute value contains ">"', async () => {
    const body = {
      id: 5,
      name: 'X',
      price: '1',
      stock_status: 'instock',
      stock_quantity: 1,
      permalink: 'u',
      description: '<a title="3 > 2">Sale</a> now',
    };
    const { provider: p } = provider(body);
    const result = await p.callTool('mcp_woocommerce_get_product', { id: '5' }, CTX);
    const data = successData(result) as { description: string };
    expect(data.description).toBe('Sale now');
    expect(data.description).not.toContain('>');
  });
});

describe('woocommerce provider — get_product_variations', () => {
  it('fetches products/{id}/variations and returns curated variations (attributes + per-variation stock)', async () => {
    const { provider: p, calls } = provider(productVariations);
    const result = await p.callTool('mcp_woocommerce_get_product_variations', { id: '12' }, CTX);

    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/products/12/variations');
    const data = successData(result) as {
      items: {
        id: string;
        attributes: { name: string; option: string }[];
        stockStatus: string;
      }[];
    };
    // Real S0 shape (confirmed against a variable product): {id, attributes:[{name,option}], price, stock}.
    expect(data.items).toHaveLength(3);
    expect(data.items[0]).toEqual({
      id: '18',
      attributes: [{ name: 'Talla', option: 'S' }],
      price: '150000',
      stockStatus: 'instock',
      stockQuantity: 76,
    });
    expect(data.items[2]?.attributes[0]?.option).toBe('L');
  });
});

describe('woocommerce provider — list_categories', () => {
  it('fetches products/categories and returns curated categories (parent normalized)', async () => {
    const { provider: p, calls } = provider(categoriesList);
    const result = await p.callTool('mcp_woocommerce_list_categories', {}, CTX);

    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/products/categories');
    const data = successData(result) as {
      items: { id: string; name: string; parent: string | null; count: number }[];
    };
    expect(data.items).toHaveLength(2);
    // parent 0 → null (top-level); parent 15 → "15".
    expect(data.items[0]).toEqual({
      id: '15',
      name: 'Uncategorized',
      slug: 'uncategorized',
      parent: null,
      count: 1,
    });
    expect(data.items[1]?.parent).toBe('15');
  });
});

describe('woocommerce provider — shipping', () => {
  it('list_shipping_zones returns curated zones including the id:0 catch-all', async () => {
    const { provider: p, calls } = provider(shippingZones);
    const result = await p.callTool('mcp_woocommerce_list_shipping_zones', {}, CTX);

    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/shipping/zones');
    const zones = successData(result) as { id: string; name: string; order: number }[];
    expect(zones).toHaveLength(2);
    expect(zones[0]?.id).toBe('0');
    expect(zones[1]).toEqual({ id: '1', name: 'Quindio', order: 0 });
  });

  it('get_shipping_zone_methods curates methodId/title/enabled and baseCost from settings.cost.value', async () => {
    const { provider: p, calls } = provider(shippingMethods);
    const result = await p.callTool('mcp_woocommerce_get_shipping_zone_methods', { id: '1' }, CTX);

    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/shipping/zones/1/methods');
    const methods = successData(result) as {
      methodId: string;
      enabled: boolean;
      baseCost: string | null;
    }[];
    // free_shipping has no cost → null; flat_rate exposes its base rate.
    expect(methods[0]).toEqual({
      methodId: 'free_shipping',
      title: 'Free shipping',
      enabled: true,
      baseCost: null,
    });
    expect(methods[1]).toEqual({
      methodId: 'flat_rate',
      title: 'Flat rate',
      enabled: true,
      baseCost: '18000',
    });
  });

  it('get_shipping_zone_locations returns curated {type, code} (shape confirmed against sandbox)', async () => {
    const { provider: p, calls } = provider(shippingLocations);
    const result = await p.callTool(
      'mcp_woocommerce_get_shipping_zone_locations',
      { id: '1' },
      CTX,
    );

    expect(calls[0]).toContain(
      'https://store.example.com/wp-json/wc/v3/shipping/zones/1/locations',
    );
    const locations = successData(result) as { type: string; code: string }[];
    // Real S0 shape: continent | country | state, e.g. state code "CO:CO-QUI".
    expect(locations).toHaveLength(3);
    expect(locations).toContainEqual({ type: 'country', code: 'CO' });
    expect(locations.find((l) => l.type === 'state')?.code).toBe('CO:CO-QUI');
  });
});

describe('woocommerce provider — orders', () => {
  it('list_orders returns curated summaries and forwards status/date filters', async () => {
    const { provider: p, calls } = provider(ordersList);
    const result = await p.callTool(
      'mcp_woocommerce_list_orders',
      { status: 'processing', after: '2026-09-01T00:00:00' },
      CTX,
    );

    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/orders?');
    expect(calls[0]).toContain('status=processing');
    expect(calls[0]).toContain('after=');
    const data = successData(result) as {
      items: { id: string; number: string; status: string; total: string; customerId: number }[];
    };
    expect(data.items[0]).toEqual({
      id: '14',
      number: '14',
      status: 'processing',
      currency: 'COP',
      total: '400000',
      dateCreated: '2026-09-14T22:33:26',
      customerId: 0,
    });
  });

  it('get_order returns line items and the condensed customer (contact + formatted shipping address)', async () => {
    const { provider: p, calls } = provider(orderGet);
    const result = await p.callTool('mcp_woocommerce_get_order', { id: '14' }, CTX);

    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/orders/14');
    const data = successData(result) as {
      id: string;
      lineItems: { name: string; quantity: number; total: string; sku: string | null }[];
      customer: { name: string; email: string; phone: string; shippingAddress: string };
    };
    expect(data.id).toBe('14');
    expect(data.lineItems[0]).toEqual({
      name: 'Camiseta',
      quantity: 4,
      total: '400000',
      sku: 'CL-001',
    });
    expect(data.customer).toEqual({
      name: 'Maria Lopez',
      email: 'maria@example.com',
      phone: '3001234567',
      shippingAddress: 'Calle 10 #5-55, Apto 302, Armenia, QUI, 630001, CO',
    });
  });
});

describe('woocommerce provider — update_product (write, S2)', () => {
  it('PUTs only the curated fields to products/{id} and returns the updated detail', async () => {
    const { provider: p, calls, sentMethods, sentBodies } = provider(productGet);
    const result = await p.callTool(
      'mcp_woocommerce_update_product',
      { id: '12', regularPrice: '120000', status: 'draft' },
      CTX,
    );
    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/products/12');
    expect(sentMethods[0]).toBe('PUT');
    expect(JSON.parse(sentBodies[0]!)).toEqual({ regular_price: '120000', status: 'draft' });
    expect((successData(result) as { id: string }).id).toBe('12');
  });

  it('rejects an id-only call (no mutable field) as INVALID_INPUT, no network', async () => {
    const { provider: p, calls } = provider(productGet);
    const result = await p.callTool('mcp_woocommerce_update_product', { id: '12' }, CTX);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe('PROVIDER_INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('maps a 401 (cannot_edit) to PROVIDER_AUTH_EXPIRED', async () => {
    const { provider: p } = provider({ code: 'woocommerce_rest_cannot_edit' }, 401);
    const result = await p.callTool(
      'mcp_woocommerce_update_product',
      { id: '12', status: 'publish' },
      CTX,
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe('PROVIDER_AUTH_EXPIRED');
  });
});

describe('woocommerce provider — update_stock (write, S3)', () => {
  it('PUTs stock to products/{id} and forces manage_stock when a quantity is set', async () => {
    const {
      provider: p,
      calls,
      sentMethods,
      sentBodies,
    } = provider({
      id: 12,
      stock_quantity: 50,
      stock_status: 'instock',
    });
    const result = await p.callTool(
      'mcp_woocommerce_update_stock',
      { id: '12', stockQuantity: 50 },
      CTX,
    );
    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/products/12');
    expect(sentMethods[0]).toBe('PUT');
    expect(JSON.parse(sentBodies[0]!)).toEqual({ stock_quantity: 50, manage_stock: true });
    expect(successData(result)).toMatchObject({ stockQuantity: 50, stockStatus: 'instock' });
  });

  it('routes to the variation endpoint when productId is given', async () => {
    const { provider: p, calls } = provider({ id: 20, stock_quantity: 5, stock_status: 'instock' });
    await p.callTool(
      'mcp_woocommerce_update_stock',
      { id: '20', productId: '14', stockQuantity: 5 },
      CTX,
    );
    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/products/14/variations/20');
  });

  it('sets stock_status alone (no manage_stock) when only status is given', async () => {
    const { provider: p, sentBodies } = provider({ id: 12, stock_status: 'outofstock' });
    await p.callTool('mcp_woocommerce_update_stock', { id: '12', stockStatus: 'outofstock' }, CTX);
    expect(JSON.parse(sentBodies[0]!)).toEqual({ stock_status: 'outofstock' });
  });
});

describe('woocommerce provider — create_order (write, S4)', () => {
  const CREATED = {
    id: 312,
    number: '312',
    status: 'pending',
    total: '300000',
    payment_url:
      'https://store.example.com/checkout/order-pay/312/?pay_for_order=true&key=wc_order_abc',
    order_key: 'wc_order_abc',
    meta_data: [{ key: '_xcale_order_ref', value: 'xco-7b1f2e' }],
  };

  it('POSTs orders with line_items + the orderReference in meta_data, echoes the ref + pay handle', async () => {
    const { provider: p, calls, sentMethods, sentBodies } = provider(CREATED, 201);
    const result = await p.callTool(
      'mcp_woocommerce_create_order',
      {
        orderReference: 'xco-7b1f2e',
        lineItems: [{ productId: '14', variationId: '20', quantity: 2 }],
        customer: { email: 'b@e.com', firstName: 'Ana' },
      },
      CTX,
    );
    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/orders');
    expect(sentMethods[0]).toBe('POST');
    const body = JSON.parse(sentBodies[0]!);
    expect(body.line_items).toEqual([{ product_id: 14, variation_id: 20, quantity: 2 }]);
    expect(body.meta_data).toEqual([{ key: '_xcale_order_ref', value: 'xco-7b1f2e' }]);
    expect(body.status).toBe('pending'); // default
    expect(body.billing).toMatchObject({ email: 'b@e.com', first_name: 'Ana' });
    expect(successData(result)).toMatchObject({
      id: '312',
      status: 'pending',
      orderReference: 'xco-7b1f2e',
      // the customer-facing pay handle for the hosted-checkout (pay-link) flow
      paymentUrl: CREATED.payment_url,
      orderKey: 'wc_order_abc',
    });
  });

  it('maps an empty payment_url to null (nothing to pay — terminal/COD)', async () => {
    const { provider: p } = provider({ ...CREATED, payment_url: '', order_key: undefined }, 201);
    const result = await p.callTool(
      'mcp_woocommerce_create_order',
      { orderReference: 'x', lineItems: [{ productId: '1', quantity: 1 }] },
      CTX,
    );
    expect(successData(result)).toMatchObject({ paymentUrl: null, orderKey: null });
  });

  it('forwards a shipping address (address1 required) to WooCommerce shipping', async () => {
    const { provider: p, sentBodies } = provider(CREATED, 201);
    await p.callTool(
      'mcp_woocommerce_create_order',
      {
        orderReference: 'xco-ship',
        lineItems: [{ productId: '14', quantity: 1 }],
        shipping: { address1: 'Cra 7 #45-10', city: 'Bogota', country: 'CO' },
      },
      CTX,
    );
    const body = JSON.parse(sentBodies[0]!);
    expect(body.shipping).toEqual({ address_1: 'Cra 7 #45-10', city: 'Bogota', country: 'CO' });
  });

  it('rejects a shipping block without a street (address1) as INVALID_INPUT, no network', async () => {
    const { provider: p, calls } = provider(CREATED, 201);
    const result = await p.callTool(
      'mcp_woocommerce_create_order',
      {
        orderReference: 'x',
        lineItems: [{ productId: '1', quantity: 1 }],
        shipping: { city: 'Bogota' },
      },
      CTX,
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe('PROVIDER_INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('maps a 401 to PROVIDER_AUTH_EXPIRED', async () => {
    const { provider: p } = provider({ code: 'woocommerce_rest_cannot_create' }, 401);
    const result = await p.callTool(
      'mcp_woocommerce_create_order',
      { orderReference: 'x', lineItems: [{ productId: '1', quantity: 1 }] },
      CTX,
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe('PROVIDER_AUTH_EXPIRED');
  });

  it.each(['abc', '1e2', '12.5', ''])(
    'rejects a non-numeric productId (%s) as INVALID_INPUT, no network',
    async (productId) => {
      const { provider: p, calls } = provider(CREATED, 201);
      const result = await p.callTool(
        'mcp_woocommerce_create_order',
        { orderReference: 'x', lineItems: [{ productId, quantity: 1 }] },
        CTX,
      );
      expect(result.kind).toBe('error');
      if (result.kind === 'error') expect(result.code).toBe('PROVIDER_INVALID_INPUT');
      expect(calls).toHaveLength(0); // never reaches WooCommerce as NaN/null
    },
  );
});

describe('woocommerce provider — reconcile_order (control-plane, S5)', () => {
  it('is withdrawn from tools/list but still routable', () => {
    const p = createWoocommerceProvider();
    expect(p.listTools().map((t) => t.name)).not.toContain('mcp_woocommerce_reconcile_order');
    expect(p.routableToolNames()).toContain('mcp_woocommerce_reconcile_order');
  });

  it('found → returns the order whose meta_data carries the orderReference', async () => {
    const orders = [
      { id: 99, meta_data: [{ key: 'other', value: 'x' }] },
      {
        id: 312,
        number: '312',
        status: 'pending',
        total: '300000',
        meta_data: [{ key: '_xcale_order_ref', value: 'xco-7b1f2e' }],
      },
    ];
    const { provider: p, calls } = provider(orders);
    const result = await p.callTool(
      'mcp_woocommerce_reconcile_order',
      { orderReference: 'xco-7b1f2e' },
      CTX,
    );
    // write-S0: WooCommerce `search` does NOT match meta_data, so reconcile fetches recent orders
    // (not ?search=) and confirms the ref in the adapter.
    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/orders');
    expect(calls[0]).toContain('per_page=100');
    expect(calls[0]).not.toContain('search=');
    const data = successData(result) as { found: boolean; order?: { id: string } };
    expect(data.found).toBe(true);
    expect(data.order?.id).toBe('312');
  });

  it('not found → { found: false } (safe to retry the create)', async () => {
    const { provider: p } = provider([{ id: 99, meta_data: [] }]);
    const result = await p.callTool(
      'mcp_woocommerce_reconcile_order',
      { orderReference: 'nope' },
      CTX,
    );
    expect(successData(result)).toEqual({ found: false });
  });

  it('bounds the recent window with `after` when the caller supplies its attempt time', async () => {
    const { provider: p, calls } = provider([]);
    await p.callTool(
      'mcp_woocommerce_reconcile_order',
      { orderReference: 'xco-7b1f2e', after: '2026-09-18T12:00:00Z' },
      CTX,
    );
    // `after` bounds the window to the real uncertainty interval so volume can't scroll the
    // target off page 1 (the R-1 duplicate risk).
    expect(calls[0]).toContain('after=');
    expect(calls[0]).toContain(encodeURIComponent('2026-09-18T12:00:00Z'));
  });
});

describe('woocommerce provider — v1 scope expansion (round 2)', () => {
  it('update_order PUTs the order status (cancel path)', async () => {
    const {
      provider: p,
      calls,
      sentMethods,
      sentBodies,
    } = provider(
      { id: 23, number: '23', status: 'cancelled', total: '150000', meta_data: [] },
      200,
    );
    const result = await p.callTool(
      'mcp_woocommerce_update_order',
      { id: '23', status: 'cancelled' },
      CTX,
    );
    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/orders/23');
    expect(sentMethods[0]).toBe('PUT');
    expect(JSON.parse(sentBodies[0]!)).toEqual({ status: 'cancelled' });
    expect(successData(result)).toMatchObject({ id: '23', status: 'cancelled' });
  });

  it('update_order rejects a non-numeric id as INVALID_INPUT, no network', async () => {
    const { provider: p, calls } = provider({}, 200);
    const result = await p.callTool(
      'mcp_woocommerce_update_order',
      { id: 'abc', status: 'cancelled' },
      CTX,
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe('PROVIDER_INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('create_order links a customer when customerId is given', async () => {
    const { provider: p, sentBodies } = provider(
      { id: 30, number: '30', status: 'pending', total: '150000', meta_data: [] },
      201,
    );
    await p.callTool(
      'mcp_woocommerce_create_order',
      { orderReference: 'xco-c1', lineItems: [{ productId: '14', quantity: 1 }], customerId: '7' },
      CTX,
    );
    expect(JSON.parse(sentBodies[0]!).customer_id).toBe(7);
  });

  it('create_category POSTs name/parent/description', async () => {
    const {
      provider: p,
      calls,
      sentMethods,
      sentBodies,
    } = provider({ id: 51, name: 'Camisetas', slug: 'camisetas', parent: 5, count: 0 }, 201);
    const result = await p.callTool(
      'mcp_woocommerce_create_category',
      { name: 'Camisetas', parent: '5', description: 'ropa' },
      CTX,
    );
    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/products/categories');
    expect(sentMethods[0]).toBe('POST');
    expect(JSON.parse(sentBodies[0]!)).toEqual({
      name: 'Camisetas',
      parent: 5,
      description: 'ropa',
    });
    expect(successData(result)).toMatchObject({ id: '51', name: 'Camisetas', parent: '5' });
  });

  it('update_category rejects an id-only call (no mutable field) as INVALID_INPUT', async () => {
    const { provider: p, calls } = provider({}, 200);
    const result = await p.callTool('mcp_woocommerce_update_category', { id: '51' }, CTX);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe('PROVIDER_INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('create_customer POSTs email + name and threads phone into billing', async () => {
    const {
      provider: p,
      calls,
      sentMethods,
      sentBodies,
    } = provider(
      { id: 7, email: 'b@e.com', first_name: 'Ana', last_name: 'P', billing: { phone: '+57300' } },
      201,
    );
    const result = await p.callTool(
      'mcp_woocommerce_create_customer',
      { email: 'b@e.com', firstName: 'Ana', lastName: 'P', phone: '+57300' },
      CTX,
    );
    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/customers');
    expect(sentMethods[0]).toBe('POST');
    const body = JSON.parse(sentBodies[0]!);
    expect(body).toMatchObject({
      email: 'b@e.com',
      first_name: 'Ana',
      billing: { phone: '+57300' },
    });
    expect(successData(result)).toEqual({
      id: '7',
      email: 'b@e.com',
      firstName: 'Ana',
      lastName: 'P',
      phone: '+57300',
    });
  });

  it('get_customer maps the curated customer (phone from billing)', async () => {
    const { provider: p } = provider({ id: 7, email: 'b@e.com', billing: { phone: '+57300' } });
    const result = await p.callTool('mcp_woocommerce_get_customer', { id: '7' }, CTX);
    expect(successData(result)).toMatchObject({
      id: '7',
      email: 'b@e.com',
      phone: '+57300',
      firstName: null,
    });
  });

  it('list_customers forwards search/email and returns curated items', async () => {
    const { provider: p, calls } = provider([{ id: 7, email: 'b@e.com', billing: {} }]);
    const result = await p.callTool('mcp_woocommerce_list_customers', { search: 'ana' }, CTX);
    expect(calls[0]).toContain('customers');
    expect(calls[0]).toContain('search=ana');
    expect((successData(result) as { items: unknown[] }).items).toHaveLength(1);
  });

  it('create_product POSTs a simple product with curated fields and returns the detail', async () => {
    const {
      provider: p,
      calls,
      sentMethods,
      sentBodies,
    } = provider(
      {
        id: 88,
        name: 'Camiseta',
        price: '50000',
        stock_status: 'instock',
        stock_quantity: 10,
        permalink: 'https://store.example.com/producto/camiseta',
        status: 'draft',
      },
      201,
    );
    const result = await p.callTool(
      'mcp_woocommerce_create_product',
      {
        name: 'Camiseta',
        regularPrice: '50000',
        description: 'Algodón',
        categories: ['5'],
        stockQuantity: 10,
      },
      CTX,
    );
    expect(calls[0]).toContain('https://store.example.com/wp-json/wc/v3/products');
    expect(sentMethods[0]).toBe('POST');
    expect(JSON.parse(sentBodies[0]!)).toEqual({
      name: 'Camiseta',
      type: 'simple',
      status: 'draft',
      regular_price: '50000',
      description: 'Algodón',
      categories: [{ id: 5 }],
      manage_stock: true,
      stock_quantity: 10,
    });
    expect(successData(result)).toMatchObject({ id: '88', name: 'Camiseta', status: 'draft' });
  });

  it('create_product defaults status to draft when omitted', async () => {
    const { provider: p, sentBodies } = provider(
      {
        id: 89,
        name: 'X',
        price: '',
        stock_status: 'instock',
        stock_quantity: null,
        permalink: '',
        status: 'draft',
      },
      201,
    );
    await p.callTool('mcp_woocommerce_create_product', { name: 'X' }, CTX);
    expect(JSON.parse(sentBodies[0]!)).toEqual({ name: 'X', type: 'simple', status: 'draft' });
  });

  it('create_product rejects an empty name as INVALID_INPUT, no network', async () => {
    const { provider: p, calls } = provider({}, 201);
    const result = await p.callTool('mcp_woocommerce_create_product', { name: '' }, CTX);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe('PROVIDER_INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('create_product rejects a non-numeric category id as INVALID_INPUT, no network', async () => {
    const { provider: p, calls } = provider({}, 201);
    const result = await p.callTool(
      'mcp_woocommerce_create_product',
      { name: 'X', categories: ['abc'] },
      CTX,
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe('PROVIDER_INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('exposes the new tools in tools/list (update_order, category + customer writes, create_product)', () => {
    const names = createWoocommerceProvider()
      .listTools()
      .map((t) => t.name);
    for (const n of [
      'mcp_woocommerce_update_order',
      'mcp_woocommerce_create_category',
      'mcp_woocommerce_update_category',
      'mcp_woocommerce_list_customers',
      'mcp_woocommerce_get_customer',
      'mcp_woocommerce_create_customer',
      'mcp_woocommerce_update_customer',
      'mcp_woocommerce_create_product',
    ]) {
      expect(names).toContain(n);
    }
  });
});
