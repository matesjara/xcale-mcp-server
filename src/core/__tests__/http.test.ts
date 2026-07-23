import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../errors';
import { mapHttpStatusToErrorCode, sendRequest } from '../http';

describe('mapHttpStatusToErrorCode', () => {
  it('maps HTTP statuses to the closed ProviderErrorCode set', () => {
    expect(mapHttpStatusToErrorCode(401)).toBe(ProviderErrorCode.AUTH_EXPIRED);
    expect(mapHttpStatusToErrorCode(403)).toBe(ProviderErrorCode.AUTH_EXPIRED);
    expect(mapHttpStatusToErrorCode(429)).toBe(ProviderErrorCode.RATE_LIMITED);
    expect(mapHttpStatusToErrorCode(503)).toBe(ProviderErrorCode.PROVIDER_UNAVAILABLE);
    expect(mapHttpStatusToErrorCode(400)).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(mapHttpStatusToErrorCode(404)).toBe(ProviderErrorCode.PROVIDER_ERROR);
  });
});

describe('sendRequest (auth-blind transport)', () => {
  it('returns parsed JSON and forwards the pre-built headers verbatim (no auth knowledge)', async () => {
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string> | undefined;
      return new Response(JSON.stringify({ hello: 'world' }), { status: 200 });
    }) as typeof fetch;

    const res = await sendRequest(
      {
        method: 'GET',
        url: 'https://x',
        headers: { authorization: 'Bearer already-materialized' },
      },
      { fetchImpl },
    );

    expect(res).toEqual({ ok: true, status: 200, data: { hello: 'world' } });
    // The transport forwards whatever headers the materializer built — it never constructs auth itself.
    expect(seenHeaders?.authorization).toBe('Bearer already-materialized');
  });

  it('maps a non-2xx to a typed error result', async () => {
    const fetchImpl = (async () => new Response('unauthorized', { status: 401 })) as typeof fetch;
    const res = await sendRequest({ method: 'GET', url: 'https://x', headers: {} }, { fetchImpl });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe(ProviderErrorCode.AUTH_EXPIRED);
    }
  });

  it('maps a network failure to PROVIDER_UNAVAILABLE', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const res = await sendRequest({ method: 'GET', url: 'https://x', headers: {} }, { fetchImpl });
    expect(res).toMatchObject({
      ok: false,
      status: 0,
      errorCode: ProviderErrorCode.PROVIDER_UNAVAILABLE,
    });
  });
});
