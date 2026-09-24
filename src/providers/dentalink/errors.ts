import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

export type Unwrapped =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

/**
 * Dentalink error shaping — **PROVISIONAL (Fase B)**.
 *
 * The vendor docs specify no error codes, statuses, or payloads, and no token has been run against the
 * live API yet (no sandbox exists). This provisional unwrap trusts the HTTP status via the core's
 * `mapHttpStatusToErrorCode` (`res.errorCode`), like Siigo, and returns 2xx `data` verbatim (Fidelity
 * over Unification). It is NOT the frozen classifier.
 *
 * The real classifier is written against observed responses when a token exists (api-contract §2/§8):
 * a missing token-permission must map to a distinct code, **never** `PROVIDER_AUTH_EXPIRED`; a booking
 * conflict → a typed conflict code; and if Dentalink turns out to answer `200 + { ok:false }` like
 * Toteat, classification moves onto the envelope. Until then, do not rely on this for the
 * permission-vs-dead-token distinction.
 *
 * `operation` is a stable label (the tool's verb); the response body is never interpolated (it could
 * carry data).
 */
export function unwrapDentalink(res: RequestResult, operation: string): Unwrapped {
  if (!res.ok) {
    return {
      ok: false,
      code: res.errorCode,
      message: `Dentalink ${operation} failed (HTTP ${res.status})`,
    };
  }
  return { ok: true, data: res.data };
}
