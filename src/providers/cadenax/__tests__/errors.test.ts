import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { RequestResult } from '../../../core/http';
import { cadenaxErrorCode, unwrapCadenax } from '../errors';

const failure = (status: number, body: unknown, errorCode: ProviderErrorCode): RequestResult => ({
  ok: false,
  status,
  errorCode,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('cadenax errors', () => {
  it('reads the machine code from details.code, never from the root', () => {
    expect(
      cadenaxErrorCode(JSON.stringify({ error: 'x', details: { code: 'INSUFFICIENT_LOT_STOCK' } })),
    ).toBe('INSUFFICIENT_LOT_STOCK');
    expect(cadenaxErrorCode(JSON.stringify({ error: 'x', code: 'ROOT_CODE' }))).toBeUndefined();
  });

  it('reads a bare machine word in `error` as the code, and does not repeat it as a sentence', () => {
    const body = { error: 'OFFICE_MIGRATION_MIRROR_READ_ONLY' };
    expect(cadenaxErrorCode(JSON.stringify(body))).toBe('OFFICE_MIGRATION_MIRROR_READ_ONLY');
    const r = unwrapCadenax(failure(423, body, ProviderErrorCode.PROVIDER_ERROR), 'create');
    expect(r).toEqual({
      ok: false,
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: 'Cadenax create failed (HTTP 423, OFFICE_MIGRATION_MIRROR_READ_ONLY)',
    });
  });

  it('ignores a code that is not a machine word', () => {
    expect(
      cadenaxErrorCode(JSON.stringify({ error: 'x', details: { code: 'not a code; drop' } })),
    ).toBeUndefined();
  });

  it('recovers the code and the sentence from a body the transport cut', () => {
    const cut =
      '{"error":"Insufficient stock in lot","details":{"code":"INSUFFICIENT_LOT_STOCK","lots":[{"id":"64f0';
    const r = unwrapCadenax(failure(400, cut, ProviderErrorCode.INVALID_INPUT), 'create');
    expect(r).toEqual({
      ok: false,
      code: ProviderErrorCode.INVALID_INPUT,
      message:
        'Cadenax create failed (HTTP 400, INSUFFICIENT_LOT_STOCK): Insufficient stock in lot',
    });
  });

  it('maps 401 to reconnect-required whatever the core said', () => {
    const r = unwrapCadenax(
      failure(401, { error: 'Invalid or expired API key' }, ProviderErrorCode.PROVIDER_ERROR),
      'whoami',
    );
    expect(r).toMatchObject({ ok: false, code: ProviderErrorCode.AUTH_EXPIRED });
  });

  it('maps 403 and 423 to a provider error though the core defaults 403 to reconnect', () => {
    for (const status of [403, 423]) {
      const r = unwrapCadenax(
        failure(status, { error: 'refused' }, ProviderErrorCode.AUTH_EXPIRED),
        'read',
      );
      expect(r, String(status)).toMatchObject({
        ok: false,
        code: ProviderErrorCode.PROVIDER_ERROR,
      });
    }
  });

  it('drops a sentence that is too long or names a key', () => {
    const long = unwrapCadenax(
      failure(400, { error: 'x'.repeat(301) }, ProviderErrorCode.INVALID_INPUT),
      'read',
    );
    expect(long).toMatchObject({ message: 'Cadenax read failed (HTTP 400)' });
    const key = unwrapCadenax(
      failure(400, { error: 'header X-API-Key was cof_live_abc' }, ProviderErrorCode.INVALID_INPUT),
      'read',
    );
    expect(key).toMatchObject({ message: 'Cadenax read failed (HTTP 400)' });
  });

  it('refuses a 2xx that is not an object', () => {
    for (const data of [null, 'ok', 3]) {
      const r = unwrapCadenax({ ok: true, status: 200, data }, 'read');
      expect(r).toMatchObject({ ok: false, code: ProviderErrorCode.PROVIDER_ERROR });
    }
  });

  it('returns a 2xx object untouched', () => {
    const data = { success: true, reservation: { _id: 'a' } };
    expect(unwrapCadenax({ ok: true, status: 200, data }, 'read')).toEqual({ ok: true, data });
  });
});
