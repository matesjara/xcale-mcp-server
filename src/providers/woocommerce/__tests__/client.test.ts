import { describe, expect, it } from 'vitest';

import type { RequestSpec } from '../../../core/auth/http-request';
import type { RequestResult } from '../../../core/http';
import { createWoocommerceClient } from '../client';
import type { WoocommerceContext } from '../context';

const ctx: WoocommerceContext = { storeUrl: 'https://store.example.com' };

/** A fake authed-request that records the RequestSpec the client built. */
function capture() {
  const specs: RequestSpec[] = [];
  const request = async (spec: RequestSpec): Promise<RequestResult> => {
    specs.push(spec);
    return { ok: true, status: 200, data: {} };
  };
  return { request, specs };
}

describe('WoocommerceClient write verbs', () => {
  it('post → POST RequestSpec: credential-free URL, JSON body, content-type header', async () => {
    const client = createWoocommerceClient();
    const { request, specs } = capture();

    await client.post('orders', { a: 1 }, request, ctx);

    const spec = specs[0]!;
    expect(spec.method).toBe('POST');
    expect(spec.url).toBe('https://store.example.com/wp-json/wc/v3/orders');
    expect(spec.url).not.toContain('consumer_key'); // credential is the Basic header, never the URL
    expect(spec.body).toBe(JSON.stringify({ a: 1 }));
    expect(spec.headers?.['content-type']).toBe('application/json');
  });

  it('put → PUT RequestSpec against a single resource', async () => {
    const client = createWoocommerceClient();
    const { request, specs } = capture();

    await client.put('products/14', { regular_price: '100' }, request, ctx);

    const spec = specs[0]!;
    expect(spec.method).toBe('PUT');
    expect(spec.url).toBe('https://store.example.com/wp-json/wc/v3/products/14');
    expect(spec.body).toBe(JSON.stringify({ regular_price: '100' }));
    expect(spec.headers?.['content-type']).toBe('application/json');
  });
});
