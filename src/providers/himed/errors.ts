import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

export type Unwrapped =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

/**
 * Unwrap a HiMed Demográficos response.
 *
 * Unlike Autoagendamiento, Demográficos uses **real HTTP status codes**: `201` success (created or
 * already exists), `207` a non-blocking optional-field warning (still 2xx → success), and `401/406/
 * 417/404` errors. The generic `mapHttpStatusToErrorCode` only routes `400/422` to `INVALID_INPUT`,
 * so we refine the caller-fixable Demográficos codes (`406/417/404`) here; `401` stays `AUTH_EXPIRED`,
 * `5xx`/transport stay `PROVIDER_UNAVAILABLE`.
 *
 * The message carries status + operation only — never the response body (PHI) or the request.
 */
export function unwrapHimed(res: RequestResult, operation: string): Unwrapped {
  if (!res.ok) {
    const code =
      res.status === 406 || res.status === 417 || res.status === 404
        ? ProviderErrorCode.INVALID_INPUT
        : res.errorCode;
    return { ok: false, code, message: `HiMed ${operation} failed (HTTP ${res.status})` };
  }
  // 2xx (201 / 207): the provider body is a plain status envelope ({ estado, mensaje }) with no PHI.
  return { ok: true, data: res.data };
}
