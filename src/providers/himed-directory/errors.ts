import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

export type Unwrapped =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

/**
 * Unwrap a HiMed directory response. Reads return `200` with an `{ estado, <named array> }` envelope;
 * a bad api_key returns `401` → `AUTH_EXPIRED`, `404/406/417` are caller-fixable → `INVALID_INPUT`,
 * `5xx`/transport stay `PROVIDER_UNAVAILABLE`. The message carries status + operation only — never the
 * response body.
 */
export function unwrapHimedDirectory(
  res: RequestResult,
  operation: string,
): Unwrapped {
  if (!res.ok) {
    const code =
      res.status === 406 || res.status === 417 || res.status === 404
        ? ProviderErrorCode.INVALID_INPUT
        : res.errorCode;
    return {
      ok: false,
      code,
      message: `HiMed directory ${operation} failed (HTTP ${res.status})`,
    };
  }
  return { ok: true, data: res.data };
}

/** Pull a named array out of an `{ estado, <key>: [...] }` HiMed envelope. */
export function envelopeRows(
  data: unknown,
  key: string,
): ReadonlyArray<Record<string, unknown>> {
  const arr = (data as Record<string, unknown> | null)?.[key];
  return Array.isArray(arr) ? (arr as Array<Record<string, unknown>>) : [];
}
