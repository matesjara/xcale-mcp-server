import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

export type Unwrapped =
  | { readonly ok: true; readonly data: unknown; readonly meta?: unknown }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

/**
 * The single unwrap every Wompi tool goes through.
 *
 * The status → code mapping is the core's (`mapHttpStatusToErrorCode`), already applied by the
 * transport and identical for every provider; nothing Wompi-specific is re-derived here.
 *
 * **The response body of a failure is never read.** Wompi repeats the key it received inside its
 * error text (observed on the sandbox, 2026-10-21: `"…se recibió: prv_test_…"`), and the core only
 * redacts query values, not JSON fields. Wompi's business rejections also come as free Spanish text
 * with no stable code (the COP 1.500 minimum is a `422` with a sentence), so there is nothing in the
 * body worth the risk. The message is ours, built from `operation` and the status alone; a test pins
 * that no part of the body survives.
 */
export function unwrapWompi(res: RequestResult, operation: string): Unwrapped {
  if (!res.ok) {
    return {
      ok: false,
      code: res.errorCode,
      // Status 0 is the transport's "no response at all" (timeout, DNS, refused connection).
      message:
        res.status === 0
          ? `Wompi ${operation} unreachable`
          : `Wompi ${operation} failed (HTTP ${res.status})`,
    };
  }
  // Every Wompi success observed in the sandbox wraps its payload as `{ data, meta? }`. A 2xx without
  // that envelope is not a success this provider can vouch for.
  const body = res.data;
  if (body === null || typeof body !== 'object' || !('data' in body)) {
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: `Wompi ${operation} returned an unexpected response`,
    };
  }
  const { data, meta } = body as { data: unknown; meta?: unknown };
  return { ok: true, data, meta };
}
