import { describe, expect, it, vi } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { createWompiProvider } from '../provider';

import createPaymentLink from '../__fixtures__/createPaymentLink.json';
import belowMinimum from '../__fixtures__/errors/belowMinimum.json';
import invalidAccessToken from '../__fixtures__/errors/invalidAccessToken.json';
import deactivatePaymentLink from '../__fixtures__/deactivatePaymentLink.json';
import listTransactions from '../__fixtures__/listTransactions.json';
import probeEmpty from '../__fixtures__/probeEmpty.json';

/** Visibly fake: never derived from a real key. */
const PRIVATE_KEY = 'prv_test_FAKEKEYFORTHEWOMPITESTS00';

const SANDBOX: ProviderCallContext = {
  credential: { secret: new SecretString(PRIVATE_KEY) },
  metadata: { publicKey: 'pub_test_FAKE' },
};

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

/**
 * A fetch double that records every request as it really leaves the core (headers already
 * materialized) and answers with the queued responses in order; the last one repeats.
 */
function recordingFetch(...responses: Array<{ status?: number; body: unknown }>) {
  const calls: RecordedCall[] = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fetchImpl: impl as unknown as typeof globalThis.fetch, calls };
}

function successData(result: ToolResult): unknown {
  if (result.kind !== 'success') throw new Error(`expected success, got: ${result.message}`);
  return result.data;
}

describe('wompi provider — credential probe', () => {
  it('proves a private key with a lookup that creates nothing and returns nothing personal', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: probeEmpty });
    const provider = createWompiProvider({ fetchImpl });

    const result = await provider.callTool('mcp_wompi_check_credentials', {}, SANDBOX);

    expect(successData(result)).toEqual({ valid: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe(
      'https://sandbox.wompi.co/v1/transactions?reference=xcale-connection-probe',
    );
    expect(calls[0]!.headers['authorization']).toBe(`Bearer ${PRIVATE_KEY}`);
  });

  // Wompi's 401 echoes the key it received (observed): the outcome carries none of that body.
  it('reports a key Wompi rejects as an expired credential, without echoing its body', async () => {
    const { fetchImpl } = recordingFetch({ status: 401, body: invalidAccessToken });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_check_credentials',
      {},
      SANDBOX,
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
    expect(JSON.stringify(result)).not.toContain('prv_test_FAKEKEYFORTHEREDACTIONTEST0');
    expect(JSON.stringify(result)).not.toContain('se recibió');
  });

  it('refuses, without calling Wompi, a public key whose prefix names no environment', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: { data: [] } });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_check_credentials',
      {},
      { ...SANDBOX, metadata: { publicKey: 'pub_stg_FAKE' } },
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(calls).toHaveLength(0);
  });

  it('sends a production public key to the production API', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: { data: [] } });

    await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_check_credentials',
      {},
      {
        ...SANDBOX,
        metadata: { publicKey: 'pub_prod_FAKE' },
      },
    );

    expect(calls[0]!.url).toBe(
      'https://production.wompi.co/v1/transactions?reference=xcale-connection-probe',
    );
  });
});

describe('wompi provider — catalog surface', () => {
  // The environment is read from the key prefix, so the connect form asks for nothing else.
  it('asks the consumer for the public key only', () => {
    const schema = createWompiProvider().contextSchema as
      | { required?: string[]; properties?: Record<string, unknown> }
      | undefined;

    expect(schema?.required).toEqual(['publicKey']);
    expect(Object.keys(schema?.properties ?? {})).toEqual(['publicKey']);
  });

  it('names its probe and its account key so a consumer can validate and identify a connection', () => {
    const { manifest } = createWompiProvider();

    expect(manifest.connectionProbe?.tool).toBe('mcp_wompi_check_credentials');
    expect(manifest.accountContextKeys).toEqual(['publicKey']);
  });
});

describe('wompi provider — create payment link', () => {
  const LINK = {
    name: 'Valoración inicial',
    description: 'Valoración inicial',
    amountInCents: 15000000,
    currency: 'COP',
    expiresAt: '2026-10-24T14:36:01.000Z',
    sku: '6712f0c1a9e4b2d3c4e5f601',
  };

  it('creates a single-use link for the exact amount and hands back its checkout page', async () => {
    const { fetchImpl, calls } = recordingFetch({ status: 201, body: createPaymentLink });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_create_payment_link',
      LINK,
      SANDBOX,
    );

    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('https://sandbox.wompi.co/v1/payment_links');
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      name: 'Valoración inicial',
      description: 'Valoración inicial',
      single_use: true,
      collect_shipping: false,
      currency: 'COP',
      amount_in_cents: 15000000,
      expires_at: '2026-10-24T14:36:01.000Z',
      sku: '6712f0c1a9e4b2d3c4e5f601',
    });
    // Wompi's response carries no URL (verified): the checkout page is built from the link id.
    expect(successData(result)).toEqual({
      linkId: 'test_XGd2UH',
      url: 'https://checkout.wompi.co/l/test_XGd2UH',
      expiresAt: '2026-10-24T14:36:01.000Z',
      active: true,
    });
  });

  it('refuses a link without a description before calling Wompi, which would reject it anyway', async () => {
    const { fetchImpl, calls } = recordingFetch({ status: 201, body: createPaymentLink });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_create_payment_link',
      { ...LINK, description: '' },
      SANDBOX,
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(calls).toHaveLength(0);
  });

  it('reports an amount under Wompi’s minimum as invalid input, without Wompi’s text', async () => {
    const { fetchImpl } = recordingFetch({ status: 422, body: belowMinimum });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_create_payment_link',
      { ...LINK, amountInCents: 100000 },
      SANDBOX,
    );

    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.INVALID_INPUT,
      message: 'Wompi create payment link failed (HTTP 422)',
    });
    expect(JSON.stringify(result)).not.toContain('150000');
  });

  it('does not report a link it cannot read back as created', async () => {
    const { fetchImpl } = recordingFetch({ status: 201, body: { data: { name: 'x' } } });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_create_payment_link',
      LINK,
      SANDBOX,
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
  });
});

describe('wompi provider — deactivate payment link', () => {
  // Wompi keeps a single-use link payable after it is paid (verified), so the consumer deactivates
  // it on settle. Only PATCH reaches this route: PUT is a 404 (verified).
  it('deactivates a link with PATCH and confirms it no longer takes payments', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: deactivatePaymentLink });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_deactivate_payment_link',
      { linkId: 'test_XGd2UH' },
      SANDBOX,
    );

    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.url).toBe('https://sandbox.wompi.co/v1/payment_links/test_XGd2UH');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ active: false });
    expect(successData(result)).toEqual({ linkId: 'test_XGd2UH', active: false });
  });

  // The consumer keeps watching a link it could not deactivate; a false "deactivated" would make it
  // stop watching a link that still takes payments.
  it('does not claim a link is deactivated when Wompi still reports it active', async () => {
    const { fetchImpl } = recordingFetch({ body: createPaymentLink });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_deactivate_payment_link',
      { linkId: 'test_XGd2UH' },
      SANDBOX,
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
  });

  it('refuses a link id that is not a plain id before building any path from it', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: deactivatePaymentLink });
    const p = createWompiProvider({ fetchImpl });

    for (const linkId of ['../transactions', 'test_XGd2UH/../x', 'a?b=1', 'a b']) {
      const result = await p.callTool('mcp_wompi_deactivate_payment_link', { linkId }, SANDBOX);
      expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    }
    expect(calls).toHaveLength(0);
  });
});

describe('wompi provider — list transactions', () => {
  const WINDOW = { fromDate: '2026-10-22T00:00:00.000Z', untilDate: '2026-10-23T00:00:00.000Z' };

  it('lists the window’s transactions with only what settlement needs, and no payer data', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: listTransactions });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_list_transactions',
      WINDOW,
      SANDBOX,
    );

    const url = new URL(calls[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://sandbox.wompi.co/v1/transactions');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from_date: WINDOW.fromDate,
      until_date: WINDOW.untilDate,
      page: '1',
      page_size: '200',
    });
    expect(successData(result)).toEqual({
      transactions: [
        {
          id: '11977675-1792680357-70475',
          paymentLinkId: 'test_XGd2UH',
          status: 'APPROVED',
          amountInCents: 15000000,
          currency: 'COP',
          createdAt: '2026-10-22T14:45:57.695Z',
          finalizedAt: '2026-10-22T14:46:03.278Z',
        },
        {
          id: '11977675-1792680256-98745',
          paymentLinkId: 'test_XGd2UH',
          status: 'DECLINED',
          amountInCents: 15000000,
          currency: 'COP',
          createdAt: '2026-10-22T14:44:16.567Z',
          finalizedAt: '2026-10-22T14:44:18.514Z',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('comprador@example.com');
  });

  // Wompi ignores a payment link filter (verified), so the consumer finds its payment in the whole
  // window: a transaction left on a page never read is a settled payment that looks unpaid.
  it("reads every page of the window until Wompi's total is reached", async () => {
    const first = listPage(1, 200, 201);
    const second = listPage(2, 1, 201);
    const { fetchImpl, calls } = recordingFetch({ body: first }, { body: second });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_list_transactions',
      WINDOW,
      SANDBOX,
    );

    expect(calls.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2']);
    const { transactions } = successData(result) as { transactions: Array<{ id: string }> };
    expect(transactions).toHaveLength(201);
    expect(transactions[200]!.id).toBe('tx-2-0');
  });

  // A partial list is worse than none: the consumer would settle against it as if it were whole.
  it('refuses a window larger than 50 pages instead of returning part of it', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: listPage(1, 200, 10_001) });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_list_transactions',
      WINDOW,
      SANDBOX,
    );

    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: 'Wompi transaction window too large; narrow fromDate/untilDate',
    });
    // Wompi's total on the first page already tells: no point reading 49 pages to throw them away.
    expect(calls).toHaveLength(1);
  });

  // Settlement acts on APPROVED only; one row in a state Wompi adds later must not hide the others.
  it('keeps listing when a transaction carries a status this provider does not know', async () => {
    const page = listPage(1, 2, 2);
    page.data[1] = { ...page.data[1]!, status: 'SOME_NEW_STATE' };
    const { fetchImpl } = recordingFetch({ body: page });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_list_transactions',
      WINDOW,
      SANDBOX,
    );

    const { transactions } = successData(result) as { transactions: Array<{ status: string }> };
    expect(transactions.map((t) => t.status)).toEqual(['APPROVED', 'SOME_NEW_STATE']);
  });

  // An open window shifts while it is read: a transaction created between two page requests pushes
  // a row from page 1 onto page 2. The consumer must see each transaction once.
  it('returns each transaction once when a row shifts onto the next page', async () => {
    const first = listPage(1, 200, 201);
    const second = { ...listPage(2, 1, 201), data: [first.data[199]!] };
    const { fetchImpl } = recordingFetch({ body: first }, { body: second });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_list_transactions',
      WINDOW,
      SANDBOX,
    );

    const { transactions } = successData(result) as { transactions: Array<{ id: string }> };
    expect(transactions).toHaveLength(200);
    expect(new Set(transactions.map((t) => t.id)).size).toBe(200);
  });

  // Observed on the sandbox: an empty window comes back as `{ data: [], meta: {} }`, with no count.
  it('reads an empty window answered with no count as no transactions', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: probeEmpty });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_list_transactions',
      WINDOW,
      SANDBOX,
    );

    expect(successData(result)).toEqual({ transactions: [] });
    expect(calls).toHaveLength(1);
  });

  // Rows without a count cannot say whether more pages follow: settling from them could miss one.
  it('refuses a page that carries transactions but no count', async () => {
    const { fetchImpl } = recordingFetch({ body: { data: listTransactions.data, meta: {} } });

    const result = await createWompiProvider({ fetchImpl }).callTool(
      'mcp_wompi_list_transactions',
      WINDOW,
      SANDBOX,
    );

    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: 'Wompi list transactions returned an unexpected response',
    });
  });

  it('refuses a window that does not move forward, without calling Wompi', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: listTransactions });
    const p = createWompiProvider({ fetchImpl });

    for (const untilDate of [WINDOW.fromDate, '2026-10-21T00:00:00.000Z']) {
      const result = await p.callTool(
        'mcp_wompi_list_transactions',
        { fromDate: WINDOW.fromDate, untilDate },
        SANDBOX,
      );
      expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    }
    expect(calls).toHaveLength(0);
  });
});

/** One page of Wompi's listing: `count` transactions out of `total`, ids unique per page. */
function listPage(page: number, count: number, total: number) {
  const template = listTransactions.data[0]!;
  return {
    data: Array.from({ length: count }, (_, i) => ({ ...template, id: `tx-${page}-${i}` })),
    meta: { page, page_size: 200, total_results: total },
  };
}
