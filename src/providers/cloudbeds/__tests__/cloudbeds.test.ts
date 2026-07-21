import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { FetchLike } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import reservation from '../__fixtures__/getReservation.json';
import reservations from '../__fixtures__/getReservations.json';
import { createCloudbedsProvider } from '../provider';

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>): FetchLike {
  return (async (url: string | URL) => {
    const method = new URL(url.toString()).pathname.split('/').pop() ?? '';
    const route = routes[method];
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  }) as FetchLike;
}

const ctx = (metadata: Record<string, unknown>) => ({ token: new SecretString('tok'), metadata });

describe('cloudbeds provider', () => {
  it('passes the generic provider conformance suite', async () => {
    await runProviderConformance(createCloudbedsProvider({ fetchImpl: fakeFetch({}) }));
  });

  it('publishes oauth2 auth + a propertyID contextSchema for discovery', () => {
    const provider = createCloudbedsProvider();
    expect(provider.auth.type).toBe('oauth2');
    expect(provider.contextSchema).toMatchObject({ type: 'object' });
  });

  it('translates the uniform page/pageSize contract to Cloudbeds param names + sends propertyID', async () => {
    let calledUrl = '';
    const capturingFetch = (async (url: string | URL) => {
      calledUrl = url.toString();
      return new Response(JSON.stringify(reservations), { status: 200 });
    }) as FetchLike;
    const provider = createCloudbedsProvider({ fetchImpl: capturingFetch });
    await provider.callTool(
      'mcp_cloudbeds_list_reservations',
      { page: 2, pageSize: 10 },
      ctx({ propertyID: 'PROP1' }),
    );
    const qs = new URL(calledUrl).searchParams;
    expect(qs.get('propertyID')).toBe('PROP1');
    expect(qs.get('pageNumber')).toBe('2');
    expect(qs.get('resultsPerPage')).toBe('10');
    expect(qs.get('pageSize')).toBeNull(); // not Cloudbeds' name
  });

  it('list_reservations returns a uniform PaginatedResult (items kept verbatim)', async () => {
    const provider = createCloudbedsProvider({
      fetchImpl: fakeFetch({ getReservations: { body: reservations } }),
    });
    const r = await provider.callTool(
      'mcp_cloudbeds_list_reservations',
      { page: 1, pageSize: 2 },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r.kind).toBe('success');
    if (r.kind === 'success') {
      const data = r.data as { items: unknown[]; totalResults?: number; hasMore?: boolean };
      expect(data.items).toHaveLength(2);
      expect(data.totalResults).toBe(3);
      expect(data.hasMore).toBe(true);
    }
  });

  it('get_reservation returns the provider data verbatim (fidelity)', async () => {
    const provider = createCloudbedsProvider({
      fetchImpl: fakeFetch({ getReservation: { body: reservation } }),
    });
    const r = await provider.callTool(
      'mcp_cloudbeds_get_reservation',
      { reservationID: 'RES-1001' },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({ kind: 'success', data: { reservationID: 'RES-1001' } });
  });

  it('maps a provider 401 to PROVIDER_AUTH_EXPIRED (reconnect signal)', async () => {
    const provider = createCloudbedsProvider({
      fetchImpl: fakeFetch({ getReservation: { status: 401, body: { message: 'token expired' } } }),
    });
    const r = await provider.callTool(
      'mcp_cloudbeds_get_reservation',
      { reservationID: 'X' },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
  });

  it('rejects invalid args with INVALID_INPUT', async () => {
    const provider = createCloudbedsProvider({ fetchImpl: fakeFetch({}) });
    const r = await provider.callTool(
      'mcp_cloudbeds_get_reservation',
      {},
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
  });

  it('rejects a missing propertyID context with INVALID_INPUT', async () => {
    const provider = createCloudbedsProvider({ fetchImpl: fakeFetch({}) });
    const r = await provider.callTool('mcp_cloudbeds_get_hotel_details', {}, ctx({}));
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
  });
});
