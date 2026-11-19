import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { RequestResult } from '../../../core/http';
import hotelNotFound from '../__fixtures__/errors/hotelNotFound.json';
import invalidCredentials from '../__fixtures__/errors/invalidCredentials.json';
import missingFields from '../__fixtures__/errors/missingFields.json';
import withFakeKey from '../__fixtures__/errors/withFakeKey.json';
import { unwrapAutocore } from '../errors';

const fixtures: Record<string, unknown> = {
  hotelNotFound,
  invalidCredentials,
  missingFields,
  withFakeKey,
};
const fixture = (name: string) => JSON.stringify(fixtures[name]);

/** A transport failure as the core's `sendRequest` hands it over (status already classified). */
function failure(status: number, body: string): RequestResult {
  const errorCode =
    status === 401 || status === 403
      ? ProviderErrorCode.AUTH_EXPIRED
      : status === 429
        ? ProviderErrorCode.RATE_LIMITED
        : status === 0 || status >= 500
          ? ProviderErrorCode.PROVIDER_UNAVAILABLE
          : status === 400 || status === 422
            ? ProviderErrorCode.INVALID_INPUT
            : ProviderErrorCode.PROVIDER_ERROR;
  return { ok: false, status, errorCode, body };
}

describe('unwrapAutocore', () => {
  it('reports rejected credentials as an expired credential, in its own words', () => {
    expect(
      unwrapAutocore(failure(401, fixture('invalidCredentials')), 'check credentials'),
    ).toEqual({
      ok: false,
      code: ProviderErrorCode.AUTH_EXPIRED,
      message: 'Autocore check credentials failed (HTTP 401)',
    });
  });

  it("never lets anything of Autocore's error body reach the outcome", () => {
    const outcome = unwrapAutocore(failure(401, fixture('withFakeKey')), 'create payment link');
    const text = JSON.stringify(outcome);
    for (const leak of ['FAKEACCESSKEY0000', 'RkFLRVRPS0VO', 'Credenciales', 'Error http']) {
      expect(text).not.toContain(leak);
    }
  });

  it("reports missing fields as invalid input without passing Autocore's Spanish text on", () => {
    const outcome = unwrapAutocore(failure(422, fixture('missingFields')), 'create payment link');
    expect(outcome).toEqual({
      ok: false,
      code: ProviderErrorCode.INVALID_INPUT,
      message: 'Autocore create payment link failed (HTTP 422)',
    });
    expect(JSON.stringify(outcome)).not.toContain('requerido');
  });

  it('keeps the core classification for a hotel not found, throttling and outages', () => {
    expect(
      unwrapAutocore(failure(404, fixture('hotelNotFound')), 'create payment link'),
    ).toMatchObject({
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: 'Autocore create payment link failed (HTTP 404)',
    });
    expect(unwrapAutocore(failure(429, ''), 'op')).toMatchObject({
      code: ProviderErrorCode.RATE_LIMITED,
    });
    expect(unwrapAutocore(failure(502, ''), 'op')).toMatchObject({
      code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
    });
  });

  it('says Autocore was unreachable when no response came back at all', () => {
    expect(unwrapAutocore(failure(0, 'fetch failed'), 'check credentials')).toEqual({
      ok: false,
      code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
      message: 'Autocore check credentials unreachable',
    });
  });

  it('hands back the JSON object Autocore answers on success (it has no common envelope)', () => {
    const data = { msg: 'Link de pago generado exitosamente', url: 'https://x/y', code: 'abc' };
    expect(unwrapAutocore({ ok: true, status: 200, data }, 'create payment link')).toEqual({
      ok: true,
      data,
    });
  });

  it('does not vouch for a 2xx that is not a JSON object', () => {
    for (const data of [null, 'ok', [1, 2]]) {
      expect(unwrapAutocore({ ok: true, status: 200, data }, 'op')).toEqual({
        ok: false,
        code: ProviderErrorCode.PROVIDER_ERROR,
        message: 'Autocore op returned an unexpected response',
      });
    }
  });
});
