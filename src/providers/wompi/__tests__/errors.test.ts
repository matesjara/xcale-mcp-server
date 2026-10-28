import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { RequestResult } from '../../../core/http';
import { unwrapWompi } from '../errors';

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

describe('unwrapWompi', () => {
  it('reports a rejected key as an expired credential, in its own words', () => {
    const body = JSON.stringify({
      error: { type: 'INVALID_ACCESS_TOKEN', reason: 'Llave no válida' },
    });

    expect(unwrapWompi(failure(401, body), 'probe')).toEqual({
      ok: false,
      code: ProviderErrorCode.AUTH_EXPIRED,
      message: 'Wompi probe failed (HTTP 401)',
    });
  });

  // Observed on the sandbox (2026-10-21): Wompi echoes the key it received inside its error text.
  // The core only redacts query values, so the provider must not let any of the body through.
  it('never lets the key Wompi echoes in its error reach the outcome', () => {
    const key = 'prv_test_FAKEKEYFORTHEREDACTIONTEST0';
    const body = JSON.stringify({
      error: {
        type: 'INVALID_ACCESS_TOKEN',
        reason: `El token proporcionado no tiene el formato correcto, se recibió: ${key}`,
      },
    });

    const outcome = unwrapWompi(failure(401, body), 'list transactions');

    expect(JSON.stringify(outcome)).not.toContain(key);
    expect(JSON.stringify(outcome)).not.toContain('se recibió');
  });

  it("reports a business rejection as invalid input without passing Wompi's text on", () => {
    const body = JSON.stringify({
      error: {
        type: 'UNPROCESSABLE',
        reason: 'La base de la transacción debe ser igual o mayor a 150000',
      },
    });

    expect(unwrapWompi(failure(422, body), 'create payment link')).toEqual({
      ok: false,
      code: ProviderErrorCode.INVALID_INPUT,
      message: 'Wompi create payment link failed (HTTP 422)',
    });
  });

  it('says Wompi was unreachable when no response came back at all', () => {
    expect(unwrapWompi(failure(0, 'fetch failed'), 'create payment link')).toEqual({
      ok: false,
      code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
      message: 'Wompi create payment link unreachable',
    });
  });

  it('keeps the core classification for throttling and outages', () => {
    expect(unwrapWompi(failure(429, ''), 'list transactions')).toMatchObject({
      code: ProviderErrorCode.RATE_LIMITED,
    });
    expect(unwrapWompi(failure(503, ''), 'list transactions')).toMatchObject({
      code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
    });
  });

  it('hands back what Wompi wraps in data on success, with its meta', () => {
    const res: RequestResult = {
      ok: true,
      status: 201,
      data: { data: { id: 'test_XGd2UH', active: true }, meta: {} },
    };

    expect(unwrapWompi(res, 'create payment link')).toEqual({
      ok: true,
      data: { id: 'test_XGd2UH', active: true },
      meta: {},
    });
  });

  it("does not vouch for a 2xx that is not Wompi's envelope", () => {
    for (const body of [null, 'ok', { result: [] }]) {
      expect(unwrapWompi({ ok: true, status: 200, data: body }, 'list transactions')).toEqual({
        ok: false,
        code: ProviderErrorCode.PROVIDER_ERROR,
        message: 'Wompi list transactions returned an unexpected response',
      });
    }
  });
});
