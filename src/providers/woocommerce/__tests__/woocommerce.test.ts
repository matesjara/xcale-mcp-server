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

/** A fetch double that records the URL it was asked for and answers with a fixture. */
function fakeFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { impl: impl as unknown as typeof globalThis.fetch, calls };
}

function provider(body: unknown, status = 200) {
  const { impl, calls } = fakeFetch(body, status);
  return { provider: createWoocommerceProvider({ fetchImpl: impl }), calls };
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

  it('publishes a basic auth descriptor (HTTP Basic over the forwarded ck:cs)', () => {
    expect(createWoocommerceProvider().auth.type).toBe('basic');
  });

  it('publishes the storeUrl context so a consumer knows what to forward', () => {
    const p = createWoocommerceProvider();
    const required = (p.contextSchema as { required?: string[] } | undefined)?.required ?? [];
    expect(required).toContain('storeUrl');
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
    expect(data.items).toHaveLength(2);
    expect(data.items[0]).toEqual({
      id: '101',
      attributes: [{ name: 'Talla', option: 'S' }],
      price: '100000',
      stockStatus: 'instock',
      stockQuantity: 10,
    });
    expect(data.items[1]?.stockStatus).toBe('outofstock');
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

  it('get_shipping_zone_locations returns curated {type, code} (shape ⏳, from docs)', async () => {
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
    expect(locations[0]).toEqual({ type: 'country', code: 'CO' });
    expect(locations[1]?.type).toBe('state');
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
