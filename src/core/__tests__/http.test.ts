import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../errors';
import { mapHttpStatusToErrorCode, redactQueryValues, sendRequest } from '../http';

const TOKEN = 'super-secret-api-token';
const URL_WITH_CREDENTIAL = `https://api.example.com/shiftstatus?xir=123&xil=1&xapitoken=${TOKEN}`;

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

/**
 * The URL as a credential surface.
 *
 * `credential-boundary-review.md` reasons about a credential in a *header*. Providers whose
 * `api_key` descriptor uses `placement: 'query'` (Toteat sends `xapitoken` that way) break that
 * assumption: for them the URL **is** the credential, and undici routinely puts the request URL into
 * a fetch-failure message.
 *
 * These assert the control where it actually lives. An earlier version of this suite asserted only
 * that a *tool result* was clean — which passed with the redaction removed, because the adapter
 * happens not to interpolate `body` into its message. That made the test worthless as a guard on
 * this behaviour: `RequestResult.body` is a shared shape any provider or log sink may surface.
 */
describe('redactQueryValues (credential-in-URL containment)', () => {
  it('masks every query value while keeping the parameter names', () => {
    const redacted = redactQueryValues(URL_WITH_CREDENTIAL);

    expect(redacted).not.toContain(TOKEN);
    // Names survive, so an operator can still tell which call failed.
    expect(redacted).toContain('xapitoken=[REDACTED]');
    expect(redacted).toContain('xir=[REDACTED]');
    expect(redacted).toContain('https://api.example.com/shiftstatus');
  });

  it('masks a credential embedded in surrounding prose, not just a bare URL', () => {
    const message = `TypeError: fetch failed for ${URL_WITH_CREDENTIAL} after 15000ms`;

    expect(redactQueryValues(message)).not.toContain(TOKEN);
  });

  it('leaves text with no query string untouched', () => {
    expect(redactQueryValues('ECONNREFUSED')).toBe('ECONNREFUSED');
  });
});

describe('sendRequest — the credential never survives in a result', () => {
  it('redacts a transport-failure message that carries the request URL', async () => {
    const fetchImpl = (async (url: string) => {
      // Exactly what undici does: the target lands in the error message.
      throw new Error(`fetch failed for ${url}`);
    }) as typeof fetch;

    const res = await sendRequest(
      { method: 'GET', url: URL_WITH_CREDENTIAL, headers: {} },
      { fetchImpl },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.body).not.toContain(TOKEN);
  });

  it('redacts an error body that echoes the request URL back', async () => {
    const fetchImpl = (async (url: string) =>
      new Response(`gateway rejected ${url}`, { status: 502 })) as typeof fetch;

    const res = await sendRequest(
      { method: 'GET', url: URL_WITH_CREDENTIAL, headers: {} },
      { fetchImpl },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.body).not.toContain(TOKEN);
  });
});
