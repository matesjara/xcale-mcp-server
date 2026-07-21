import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../errors';
import { mapHttpStatusToErrorCode, requestJson } from '../http';
import { SecretString } from '../secret-string';

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

describe('requestJson', () => {
  it('returns parsed JSON and applies the token at egress (Bearer) — token never leaks', async () => {
    let seenAuth: string | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seenAuth = (init?.headers as Record<string, string> | undefined)?.authorization;
      return new Response(JSON.stringify({ hello: 'world' }), { status: 200 });
    }) as typeof fetch;

    const res = await requestJson('https://x', { token: new SecretString('s3cret'), fetchImpl });

    expect(res).toEqual({ ok: true, status: 200, data: { hello: 'world' } });
    expect(seenAuth).toBe('Bearer s3cret');
  });

  it('maps a non-2xx to a typed error result without leaking the token', async () => {
    const fetchImpl = (async () => new Response('unauthorized', { status: 401 })) as typeof fetch;
    const res = await requestJson('https://x', { token: new SecretString('s3cret'), fetchImpl });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe(ProviderErrorCode.AUTH_EXPIRED);
      expect(res.body).not.toContain('s3cret');
    }
  });

  it('maps a network failure to PROVIDER_UNAVAILABLE', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const res = await requestJson('https://x', { fetchImpl });
    expect(res).toMatchObject({
      ok: false,
      status: 0,
      errorCode: ProviderErrorCode.PROVIDER_UNAVAILABLE,
    });
  });
});
