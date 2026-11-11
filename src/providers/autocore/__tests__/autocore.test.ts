import { describe, expect, it, vi } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { createAutocoreProvider } from '../provider';

import invalidCredentials from '../__fixtures__/errors/invalidCredentials.json';
import listHotels from '../__fixtures__/listHotels.json';

/** Visibly fake keys, composed as the consumer stores them. Never derived from real ones. */
const STAGING: ProviderCallContext = {
  credential: { secret: new SecretString('AK123:SK456') },
  metadata: { hotelId: 5, environment: 'staging' },
};
/** The Auth-Token for AK123 / SK456 at 1700000000 (an independently computed vector, see core tests). */
const TOKEN_AT_1700000000 =
  'QUsxMjM7MTcwMDAwMDAwMDs2ZjA4ODc5N2FkOWM1MGQyNTYzZTQwOTNiODhhZjI2NzMyMzMxOGM1OWIxYzI2OWNlNDBhYjQwNDliNjMzMzEz';
const clock = () => 1_700_000_000_000;

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

/** Records every request as it leaves the core (auth materialized) and answers in order; the last repeats. */
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

/** A listing page of `count` hotels starting at id `firstId`, out of `total`. */
function hotelsPage(firstId: number, count: number, total: number) {
  return {
    paginate_info: {
      start: 0,
      items: count,
      total_items: total,
      total_pages: Math.ceil(total / 10),
    },
    data: Array.from({ length: count }, (_, i) => ({
      id: firstId + i,
      is_archived: false,
      is_active: true,
      name: `Hotel ${firstId + i}`,
      currencies: [{ is_primary: true, currency: { code: 'COP' } }],
    })),
  };
}

const withMetadata = (metadata: Record<string, unknown>): ProviderCallContext => ({
  ...STAGING,
  metadata,
});

describe('autocore provider — connection probe', () => {
  it('proves the keys reach the hotel and names it, with nothing else of its record', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: listHotels });
    const provider = createAutocoreProvider({ fetchImpl, clock });

    const result = await provider.callTool('mcp_autocore_check_credentials', {}, STAGING);

    expect(successData(result)).toEqual({
      valid: true,
      hotel: {
        id: 5,
        name: 'STG XCALE HOTEL',
        active: true,
        currencies: ['COP', 'USD'],
        primaryCurrency: 'COP',
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe('https://api-stg.autocore.pro/v2/hotels?offset=0&limit=10');
    expect(calls[0]!.headers['Auth-Token']).toBe(TOKEN_AT_1700000000);
    expect(JSON.stringify(result)).not.toMatch(/PLACEHOLDER|commission|redeban/i);
  });

  it('refuses a hotel the keys do not reach, pointing at the id rather than the keys', async () => {
    const { fetchImpl } = recordingFetch({ body: listHotels });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_check_credentials',
      {},
      withMetadata({ hotelId: 6, environment: 'staging' }),
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.INVALID_INPUT,
      message: 'Autocore hotel 6 is not reachable with these keys',
    });
  });

  // Observed: `links.next` points past the end even on the last page. Paging follows `total_items`.
  it('pages by total_items, not by links.next, and finds a hotel on a later page', async () => {
    const { fetchImpl, calls } = recordingFetch(
      { body: hotelsPage(1, 10, 15) },
      { body: hotelsPage(11, 5, 15) },
    );
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_check_credentials',
      {},
      withMetadata({ hotelId: 13, environment: 'staging' }),
    );
    expect(successData(result)).toMatchObject({ valid: true, hotel: { id: 13 } });
    expect(calls.map((c) => c.url)).toEqual([
      'https://api-stg.autocore.pro/v2/hotels?offset=0&limit=10',
      'https://api-stg.autocore.pro/v2/hotels?offset=10&limit=10',
    ]);
  });

  it('stops after 20 pages rather than walking an unbounded listing', async () => {
    const responses = Array.from({ length: 25 }, (_, page) => ({
      body: hotelsPage(1000 + 10 * page, 10, 250),
    }));
    const { fetchImpl, calls } = recordingFetch(...responses);
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_check_credentials',
      {},
      STAGING,
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: 'Autocore hotel listing too large',
    });
    expect(calls).toHaveLength(20);
  });

  it('reports keys Autocore rejects as an expired credential, without echoing its body', async () => {
    const { fetchImpl } = recordingFetch({ status: 401, body: invalidCredentials });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_check_credentials',
      {},
      STAGING,
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.AUTH_EXPIRED,
      message: 'Autocore check credentials failed (HTTP 401)',
    });
    expect(JSON.stringify(result)).not.toContain('Credenciales');
  });

  it('reads the host from the environment and refuses an unknown one without calling anyone', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: listHotels });
    const provider = createAutocoreProvider({ fetchImpl, clock });
    await provider.callTool(
      'mcp_autocore_check_credentials',
      {},
      withMetadata({ hotelId: 5, environment: 'production' }),
    );
    expect(calls[0]!.url.startsWith('https://api.autocore.pro/v2/hotels')).toBe(true);

    const refused = await provider.callTool(
      'mcp_autocore_check_credentials',
      {},
      withMetadata({ hotelId: 5, environment: 'testing' }),
    );
    expect(refused).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(calls).toHaveLength(1);
  });

  it('does not vouch for a listing without its count', async () => {
    const { fetchImpl } = recordingFetch({ body: { data: [] } });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_check_credentials',
      {},
      STAGING,
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: 'Autocore check credentials returned an unexpected response',
    });
  });
});
