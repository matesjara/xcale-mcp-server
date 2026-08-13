import { describe, expect, it, vi } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { createSiigoProvider } from '../provider';

import customersList from '../__fixtures__/customers-list.json';
import customerGet from '../__fixtures__/customer-get.json';
import invoicesList from '../__fixtures__/invoices-list.json';
import productsList from '../__fixtures__/products-list.json';
import unauthorized401 from '../__fixtures__/errors/unauthorized-401.json';
import partnerId400 from '../__fixtures__/errors/partner-id-400.json';

/** The minted JWT that reaches the provider already resolved (the `reference` path ran upstream). */
const JWT = 'eyJhbGciOi.header.signature.super-secret-minted-jwt';
const PARTNER_ID = 'EcomerceCG';

const CTX: ProviderCallContext = { credential: { secret: new SecretString(JWT) } };

/** A fetch double that records (url, init) and answers with a fixture at a given status. */
function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { impl: impl as unknown as typeof globalThis.fetch, calls };
}

function provider(body: unknown, status = 200) {
  const { impl, calls } = fakeFetch(body, status);
  return {
    provider: createSiigoProvider({ fetchImpl: impl, partnerId: PARTNER_ID }),
    calls,
  };
}

function successData(result: ToolResult): unknown {
  if (result.kind !== 'success') throw new Error(`expected success, got: ${result.message}`);
  return result.data;
}

function errorCode(result: ToolResult): ProviderErrorCode {
  if (result.kind !== 'error') throw new Error('expected an error result');
  return result.code;
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  const h = new Headers(init?.headers);
  return h.get(name);
}

describe('siigo provider — conformance', () => {
  it('satisfies the generic provider contract', async () => {
    await runProviderConformance(createSiigoProvider({ partnerId: PARTNER_ID }));
  });
});

describe('siigo provider — catalog surface', () => {
  it('publishes a credential_exchange descriptor with the Observed Flavor-A wire facts', () => {
    const p = createSiigoProvider({ partnerId: PARTNER_ID });
    expect(p.auth.type).toBe('credential_exchange');
    if (p.auth.type === 'credential_exchange') {
      expect(p.auth.credentialDelivery).toBe('reference');
      expect(p.auth.tokenEndpoint).toBe('https://api.siigo.com/auth');
      expect(p.auth.method).toBe('POST');
      // Snake_case logical==wire keys — the cross-repo credentialSecret JSON-shape contract.
      expect(p.auth.bodyFields).toEqual({ username: 'username', access_key: 'access_key' });
      expect(p.auth.responseFields).toEqual({ token: 'access_token', expiry: 'expires_in' });
      expect(p.auth.tokenPlacement).toBe('bearer_header');
      expect(p.auth.staticHeaders).toEqual([{ name: 'Partner-Id', source: 'deployment' }]);
    }
  });

  it('declares NO contextSchema — one Siigo credential = one company (Observed B1)', () => {
    expect(createSiigoProvider({ partnerId: PARTNER_ID }).contextSchema).toBeUndefined();
  });

  it('declares NO connectionProbe — connect validates by minting once, not a data probe', () => {
    expect(createSiigoProvider({ partnerId: PARTNER_ID }).manifest.connectionProbe).toBeUndefined();
  });

  it('publishes the curated read tool set (resources + reference data) under the mcp_siigo_ prefix', () => {
    const names = createSiigoProvider({ partnerId: PARTNER_ID })
      .listTools()
      .map((t) => t.name);
    expect(names).toEqual([
      // Resource reads (list + get)
      'mcp_siigo_list_customers',
      'mcp_siigo_get_customer',
      'mcp_siigo_list_invoices',
      'mcp_siigo_get_invoice',
      'mcp_siigo_list_products',
      'mcp_siigo_get_product',
      // Reference data (Phase 1a)
      'mcp_siigo_list_taxes',
      'mcp_siigo_list_account_groups',
      'mcp_siigo_list_price_lists',
      'mcp_siigo_list_cost_centers',
      'mcp_siigo_list_warehouses',
      'mcp_siigo_list_users',
      'mcp_siigo_list_document_types',
      'mcp_siigo_list_payment_types',
      // Additional read resources (Phase 1b)
      'mcp_siigo_list_purchases',
      'mcp_siigo_list_credit_notes',
      'mcp_siigo_list_vouchers',
      'mcp_siigo_list_journals',
      'mcp_siigo_list_quotations',
    ]);
  });
});

describe('siigo provider — additional read resources (Phase 1b, Observed envelope)', () => {
  const envelope = {
    pagination: { page: 1, page_size: 25, total_results: 7957 },
    results: [{ id: 'p-1', document: { id: 1 }, number: 5, total: 100000 }],
    _links: { self: { href: '...' } },
  };

  it('lists each Phase-1b resource on the right path with pagination, envelope verbatim', async () => {
    const cases: Array<[string, string]> = [
      ['mcp_siigo_list_purchases', '/v1/purchases'],
      ['mcp_siigo_list_credit_notes', '/v1/credit-notes'],
      ['mcp_siigo_list_vouchers', '/v1/vouchers'],
      ['mcp_siigo_list_journals', '/v1/journals'],
      ['mcp_siigo_list_quotations', '/v1/quotations'],
    ];
    for (const [tool, path] of cases) {
      const { provider: p, calls } = provider(envelope);
      const result = await p.callTool(tool, { page: 2, pageSize: 10 }, CTX);
      const parsed = new URL(calls[0]!.url);
      expect(parsed.pathname, tool).toBe(path);
      expect(parsed.searchParams.get('page')).toBe('2');
      expect(parsed.searchParams.get('page_size')).toBe('10');
      expect(successData(result)).toEqual(envelope);
    }
  });
});

describe('siigo provider — reference data (Phase 1a, Observed shapes)', () => {
  const TAXES = [
    { id: 1270, name: 'IVA 19%', type: 'IVA', percentage: 19, active: true },
    { id: 1271, name: 'ReteFuente', type: 'ReteFuente', percentage: 2.5, active: true },
  ];

  it('returns a flat reference-data array verbatim (no envelope), on the right path', async () => {
    const { provider: p, calls } = provider(TAXES);

    const result = await p.callTool('mcp_siigo_list_taxes', {}, CTX);

    expect(new URL(calls[0]!.url).pathname).toBe('/v1/taxes');
    expect(new URL(calls[0]!.url).search).toBe(''); // no-arg reference read
    expect(successData(result)).toEqual(TAXES); // flat array, verbatim
    expect(headerOf(calls[0]!.init, 'Partner-Id')).toBe(PARTNER_ID);
  });

  it('targets the hyphenated reference paths', async () => {
    const cases: Array<[string, string]> = [
      ['mcp_siigo_list_account_groups', '/v1/account-groups'],
      ['mcp_siigo_list_price_lists', '/v1/price-lists'],
      ['mcp_siigo_list_cost_centers', '/v1/cost-centers'],
      ['mcp_siigo_list_warehouses', '/v1/warehouses'],
    ];
    for (const [tool, path] of cases) {
      const { provider: p, calls } = provider([]);
      await p.callTool(tool, {}, CTX);
      expect(new URL(calls[0]!.url).pathname, tool).toBe(path);
    }
  });

  it('lists users with pagination (the one reference read that is a paginated envelope)', async () => {
    const usersEnvelope = {
      pagination: { page: 1, page_size: 25, total_results: 42 },
      results: [{ id: 916, username: 'seller1', email: 'seller1@example.com', active: true }],
    };
    const { provider: p, calls } = provider(usersEnvelope);

    const result = await p.callTool('mcp_siigo_list_users', { page: 2, pageSize: 50 }, CTX);

    const parsed = new URL(calls[0]!.url);
    expect(parsed.pathname).toBe('/v1/users');
    expect(parsed.searchParams.get('page')).toBe('2');
    expect(parsed.searchParams.get('page_size')).toBe('50');
    expect(successData(result)).toEqual(usersEnvelope);
  });

  it('requires and forwards the `type` filter for document types (Siigo 400s without it)', async () => {
    const { provider: p, calls } = provider([{ id: 1, code: 'FV-1', name: 'Factura', type: 'FV' }]);

    const ok = await p.callTool('mcp_siigo_list_document_types', { type: 'FV' }, CTX);
    expect(new URL(calls[0]!.url).searchParams.get('type')).toBe('FV');
    expect(ok.kind).toBe('success');

    // Missing the required filter fails validation before any request.
    const { provider: p2, calls: calls2 } = provider([]);
    const bad = await p2.callTool('mcp_siigo_list_document_types', {}, CTX);
    expect(errorCode(bad)).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(calls2).toHaveLength(0);
  });

  it('forwards the `document_type` filter (wire name) for payment types', async () => {
    const { provider: p, calls } = provider([
      { id: 5, name: 'Efectivo', type: 'Cash', active: true },
    ]);

    await p.callTool('mcp_siigo_list_payment_types', { documentType: 'FV' }, CTX);

    expect(new URL(calls[0]!.url).searchParams.get('document_type')).toBe('FV');
  });
});

describe('siigo provider — request shaping', () => {
  it('lists customers with Partner-Id + Bearer, mapping page/pageSize to the wire params', async () => {
    const { provider: p, calls } = provider(customersList);

    await p.callTool('mcp_siigo_list_customers', { page: 2, pageSize: 50 }, CTX);

    const { url, init } = calls[0]!;
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://api.siigo.com/v1/customers');
    expect(parsed.searchParams.get('page')).toBe('2');
    expect(parsed.searchParams.get('page_size')).toBe('50');
    expect(headerOf(init, 'Partner-Id')).toBe(PARTNER_ID);
    expect(headerOf(init, 'authorization')).toBe(`Bearer ${JWT}`);
  });

  it('defaults page=1 and page_size=25 when the caller omits them', async () => {
    const { provider: p, calls } = provider(customersList);

    await p.callTool('mcp_siigo_list_customers', {}, CTX);

    const parsed = new URL(calls[0]!.url);
    expect(parsed.searchParams.get('page')).toBe('1');
    expect(parsed.searchParams.get('page_size')).toBe('25');
  });

  it('gets a customer by id with no query params, on the /v1/customers/{id} path', async () => {
    const { provider: p, calls } = provider(customerGet);

    await p.callTool('mcp_siigo_get_customer', { id: '556cad10-9ca3-4718-8791-e8b718a3f8ba' }, CTX);

    const parsed = new URL(calls[0]!.url);
    expect(parsed.pathname).toBe('/v1/customers/556cad10-9ca3-4718-8791-e8b718a3f8ba');
    expect(parsed.search).toBe('');
    expect(headerOf(calls[0]!.init, 'Partner-Id')).toBe(PARTNER_ID);
  });

  it('targets the invoices and products endpoints for their tools', async () => {
    const inv = provider(invoicesList);
    await inv.provider.callTool('mcp_siigo_list_invoices', {}, CTX);
    expect(new URL(inv.calls[0]!.url).pathname).toBe('/v1/invoices');

    const prod = provider(productsList);
    await prod.provider.callTool('mcp_siigo_list_products', {}, CTX);
    expect(new URL(prod.calls[0]!.url).pathname).toBe('/v1/products');
  });
});

describe('siigo provider — reads (verbatim passthrough)', () => {
  it('returns the customers list envelope verbatim', async () => {
    const { provider: p } = provider(customersList);

    const result = await p.callTool('mcp_siigo_list_customers', {}, CTX);

    const data = successData(result) as { pagination: unknown; results: unknown[] };
    expect(data).toEqual(customersList); // no reshaping, no mapper
    expect(data.pagination).toEqual({ page: 1, page_size: 25, total_results: 82167 });
    expect(Array.isArray(data.results)).toBe(true);
  });

  it('returns a single invoice/product object verbatim on get and list', async () => {
    const { provider: p } = provider(invoicesList);
    const result = await p.callTool('mcp_siigo_list_invoices', {}, CTX);
    expect(successData(result)).toEqual(invoicesList);
  });
});

describe('siigo provider — error mapping (honest HTTP status)', () => {
  it('maps 401 unauthorized to AUTH_EXPIRED (→ reconnect)', async () => {
    const { provider: p } = provider(unauthorized401, 401);

    const result = await p.callTool('mcp_siigo_list_customers', {}, CTX);

    expect(errorCode(result)).toBe(ProviderErrorCode.AUTH_EXPIRED);
    if (result.kind === 'error') expect(result.message).toContain('unauthorized');
  });

  it('maps a 400 header_required (missing Partner-Id) to INVALID_INPUT', async () => {
    const { provider: p } = provider(partnerId400, 400);

    const result = await p.callTool('mcp_siigo_list_customers', {}, CTX);

    expect(errorCode(result)).toBe(ProviderErrorCode.INVALID_INPUT);
    if (result.kind === 'error') expect(result.message).toContain('header_required');
  });

  it('maps a 429 to RATE_LIMITED', async () => {
    const { provider: p } = provider({ Status: 429, Errors: [] }, 429);

    const result = await p.callTool('mcp_siigo_list_products', {}, CTX);

    expect(errorCode(result)).toBe(ProviderErrorCode.RATE_LIMITED);
  });

  it('rejects an out-of-range page before any request goes out', async () => {
    const { provider: p, calls } = provider(customersList);

    const result = await p.callTool('mcp_siigo_list_customers', { page: 0 }, CTX);

    expect(errorCode(result)).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(calls).toHaveLength(0);
  });
});

describe('siigo provider — credential containment', () => {
  it('keeps the minted JWT out of a transport-failure result', async () => {
    const failing = vi.fn(async (url: string | URL) => {
      throw new Error(`fetch failed for ${String(url)}`);
    }) as unknown as typeof globalThis.fetch;
    const p = createSiigoProvider({ fetchImpl: failing, partnerId: PARTNER_ID });

    const result = await p.callTool('mcp_siigo_list_customers', {}, CTX);

    expect(result.kind).toBe('error');
    expect(JSON.stringify(result)).not.toContain(JWT);
  });

  it('keeps the minted JWT out of an error-body result', async () => {
    const echoing = vi.fn(
      async (url: string | URL) =>
        new Response(`upstream rejected ${String(url)}`, { status: 502 }),
    ) as unknown as typeof globalThis.fetch;
    const p = createSiigoProvider({ fetchImpl: echoing, partnerId: PARTNER_ID });

    const result = await p.callTool('mcp_siigo_list_customers', {}, CTX);

    expect(JSON.stringify(result)).not.toContain(JWT);
  });
});
