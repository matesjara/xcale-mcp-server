import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

export type Unwrapped =
  | { readonly ok: true; readonly data: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

/**
 * The single unwrap every Autocore tool goes through.
 *
 * The status → code mapping is the core's (`mapHttpStatusToErrorCode`), already applied by the
 * transport; nothing Autocore-specific is re-derived here.
 *
 * **The response body of a failure is never read.** Autocore's errors are
 * `{ code: 0, message: "Error http: <n>", detail: "<free Spanish text>" }` (observed on Staging,
 * 2026-11-09): no stable code to act on, and free text that could one day echo what it received. The
 * message is ours, built from `operation` and the status alone; a test pins that no part of the body
 * survives.
 *
 * Autocore's successes share no envelope (the hotel listing, a created link, a status and a
 * cancellation each have their own shape), so a 2xx is handed back as the JSON object it is and each
 * tool checks the fields it needs. A 2xx that is not a JSON object is not a success this provider can
 * vouch for.
 */
export function unwrapAutocore(res: RequestResult, operation: string): Unwrapped {
  if (!res.ok) {
    return {
      ok: false,
      code: res.errorCode,
      // Status 0 is the transport's "no response at all" (timeout, DNS, refused connection).
      message:
        res.status === 0
          ? `Autocore ${operation} unreachable`
          : `Autocore ${operation} failed (HTTP ${res.status})`,
    };
  }
  const body = res.data;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return unexpected(operation);
  }
  return { ok: true, data: body as Readonly<Record<string, unknown>> };
}

/** A 2xx whose shape the tool cannot use: never a success built on a guess. */
export function unexpected(operation: string): Unwrapped & { ok: false } {
  return {
    ok: false,
    code: ProviderErrorCode.PROVIDER_ERROR,
    message: `Autocore ${operation} returned an unexpected response`,
  };
}
