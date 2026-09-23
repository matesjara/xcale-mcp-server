import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

/**
 * Mews error shaping. Evidence: `docs/design/mews-provider/design-notes.md` §1 and §5, recordings in
 * `__fixtures__/errors/`.
 *
 * ## 403 is a business refusal, not an expired credential
 *
 * The core maps 401 and 403 to `PROVIDER_AUTH_EXPIRED`. Mews uses 403 for "this property has no
 * availability for the selected dates" and for "Please provide reason." (both observed 2026-09-23).
 * Left to the default, every full hotel would be told to reconnect a perfectly good token, and the
 * consumer would mark the connection broken. Only **401** ("Cannot perform operation or session has
 * expired.") is fixed by a reconnect, so only 401 stays `PROVIDER_AUTH_EXPIRED`. One 403 is
 * neither: a concurrent edit that asks to "try again" is `PROVIDER_UNAVAILABLE`.
 *
 * ## 408 is a load refusal
 *
 * Mews documents 408 as a request that demanded too many resources. Like 429 it is fixed by backing
 * off, not by giving up, so it is `PROVIDER_RATE_LIMITED`.
 *
 * ## The reason travels
 *
 * Every Mews failure body is `{ Message, RequestId, Details }`. `Message` is short, fixed operator
 * English that named no guest in anything we observed, and it is the only way the agent can tell a
 * guest the truth ("the hotel is full on those dates" is not "the system is down"). So it goes into
 * the error text, capped and stripped of control characters, with `RequestId`, which identifies the
 * call in Mews' own support. `Details` does not travel: it is unobserved (always `null`).
 */

export type Unwrapped =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

const MAX_REASON = 200;

interface MewsFailureBody {
  readonly Message?: unknown;
  readonly RequestId?: unknown;
}

function parseFailure(body: string): { message?: string; requestId?: string } {
  try {
    const parsed = JSON.parse(body) as MewsFailureBody | null;
    const message = typeof parsed?.Message === 'string' ? clean(parsed.Message) : undefined;
    const requestId =
      typeof parsed?.RequestId === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.RequestId)
        ? parsed.RequestId
        : undefined;
    return {
      ...(message ? { message } : {}),
      ...(requestId ? { requestId } : {}),
    };
  } catch {
    return {};
  }
}

function clean(text: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return text
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, MAX_REASON);
}

/** Re-classify the statuses whose meaning in Mews differs from the core's default map. */
export function classifyMewsStatus(
  status: number,
  fallback: ProviderErrorCode,
  message?: string,
): ProviderErrorCode {
  if (status === 401) return ProviderErrorCode.AUTH_EXPIRED;
  if (status === 403) {
    // A 403 that asks to try again is a concurrent edit ("Someone else just changed this bill.
    // Refresh to see the latest and try again.", observed on a cancel; the same cancel passed 5 s
    // later). Transient, so the consumer re-reads and retries instead of giving up.
    return message !== undefined && /\btry again\b/i.test(message)
      ? ProviderErrorCode.PROVIDER_UNAVAILABLE
      : ProviderErrorCode.PROVIDER_ERROR;
  }
  if (status === 408 || status === 429) return ProviderErrorCode.RATE_LIMITED;
  return fallback;
}

/** The one unwrap every Mews call goes through. */
export function unwrapMews(res: RequestResult, operation: string): Unwrapped {
  if (!res.ok) {
    const { message, requestId } = parseFailure(res.body);
    const parts = [`Mews ${operation} failed (HTTP ${res.status})`];
    if (message) parts.push(message);
    if (requestId) parts.push(`Mews request ${requestId}`);
    return {
      ok: false,
      code: classifyMewsStatus(res.status, res.errorCode, message),
      message: parts.join(': '),
    };
  }
  if (res.data === null || typeof res.data !== 'object' || Array.isArray(res.data)) {
    // Every observed success is a JSON object. Anything else is not a success we can vouch for.
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: `Mews ${operation} returned an unrecognized response shape`,
    };
  }
  return { ok: true, data: res.data };
}
