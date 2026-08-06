import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { RequestResult } from '../../../core/http';
import { classifyToteatFailure, unwrapToteat } from '../errors';

import bareFalse from '../__fixtures__/errors/bareFalse.json';
import invalidDateFormat from '../__fixtures__/errors/invalidDateFormat.json';
import invalidOrderNumber from '../__fixtures__/errors/invalidOrderNumber.json';
import maxPeriodExceeded from '../__fixtures__/errors/maxPeriodExceeded.json';
import notAuthorized from '../__fixtures__/errors/notAuthorized.json';
import rateLimited from '../__fixtures__/errors/rateLimited.json';
import shiftStatus from '../__fixtures__/getShiftStatus.json';

/** A 200 carrying whatever body — the shape Toteat uses for successes AND for most failures. */
const http200 = (data: unknown): RequestResult => ({ ok: true, status: 200, data });

const httpError = (status: number, errorCode: ProviderErrorCode): RequestResult => ({
  ok: false,
  status,
  errorCode,
  body: '',
});

describe('classifyToteatFailure', () => {
  it('does NOT map "Not Authorized" to AUTH_EXPIRED', () => {
    // The load-bearing assertion of this adapter. Toteat returns this identical body for a dead
    // token AND for a route the venue has not allow-listed in its POS security tab — verified live
    // on /fiscaldocuments with a working token. Mapping it to AUTH_EXPIRED would let one disabled
    // route flip a healthy connection to "reconnect required" for the whole tenant.
    expect(classifyToteatFailure(notAuthorized)).not.toBe(ProviderErrorCode.AUTH_EXPIRED);
    expect(classifyToteatFailure(notAuthorized)).toBe(ProviderErrorCode.PROVIDER_ERROR);
  });

  it('maps the date-family messages to INVALID_INPUT so the caller can correct them', () => {
    expect(classifyToteatFailure(invalidDateFormat)).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(classifyToteatFailure(maxPeriodExceeded)).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(classifyToteatFailure(invalidOrderNumber)).toBe(ProviderErrorCode.INVALID_INPUT);
  });

  it('maps a rate-limit envelope to RATE_LIMITED', () => {
    expect(classifyToteatFailure(rateLimited)).toBe(ProviderErrorCode.RATE_LIMITED);
  });

  it('falls back to PROVIDER_ERROR for an envelope with no message at all', () => {
    // Observed for a nonexistent venue id: `{"ok":false}` and nothing else. Genuinely ambiguous, so
    // it must not be dressed up as something the caller could act on.
    expect(classifyToteatFailure(bareFalse)).toBe(ProviderErrorCode.PROVIDER_ERROR);
  });

  it('does not mislabel an unrecognized message', () => {
    expect(classifyToteatFailure({ ok: false, msg: 'something entirely new' })).toBe(
      ProviderErrorCode.PROVIDER_ERROR,
    );
  });
});

describe('unwrapToteat', () => {
  it('treats HTTP 200 with ok:false as a FAILURE', () => {
    // Without this, a dead token reads as a successful call returning `undefined`, and the agent
    // narrates "there is nothing" instead of surfacing a broken connection.
    const result = unwrapToteat(http200(notAuthorized), 'shift status');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('Not Authorized');
  });

  it('unwraps a real success to its data', () => {
    const result = unwrapToteat(http200(shiftStatus), 'shift status');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toMatchObject({ status: 'open', localNumber: 1 });
  });

  it('maps a real 429 to RATE_LIMITED', () => {
    const result = unwrapToteat(httpError(429, ProviderErrorCode.RATE_LIMITED), 'menu');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ProviderErrorCode.RATE_LIMITED);
  });

  it('refuses a 200 whose body is not a Toteat envelope', () => {
    // A proxy or an error page answering 200 must not be read as an empty success.
    const result = unwrapToteat(http200('<html>gateway</html>'), 'menu');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ProviderErrorCode.PROVIDER_ERROR);
  });

  it('never returns AUTH_EXPIRED from any observed response', () => {
    const observed = [
      notAuthorized,
      bareFalse,
      invalidDateFormat,
      maxPeriodExceeded,
      invalidOrderNumber,
      rateLimited,
    ];

    for (const body of observed) {
      const result = unwrapToteat(http200(body), 'op');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).not.toBe(ProviderErrorCode.AUTH_EXPIRED);
    }
  });
});
