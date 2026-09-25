import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

export type Unwrapped =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

/**
 * Unwrap a HiMed Autoagendamiento response.
 *
 * Verified in the sandbox (2026-09-24): successful reads return **200/201** with a JSON array (or, for
 * `existePaciente` not-found, `{ mensaje, cantidad: 0 }`); auth/validation failures return **401** with
 * `{ mensaje }`. HiMed's Swagger also documents that a **200 can carry a captured processing error** —
 * so success is judged on the body, not the status alone.
 *
 * `401` → `AUTH_EXPIRED`: HiMed also answers 401 for a missing/malformed `accion`, but the adapter
 * always sends a valid `accion`, so a 401 in real use means a bad/expired token. The error message
 * carries status + operation only — never the body (may hold PHI) or the request (holds the token).
 *
 * ⏳ R-2: the exact shape of a 200-captured-error (vs a legit `{cantidad:0}`) is not yet observed on
 * the write path; when it is, add the discriminator here. Today a 2xx is treated as success and the
 * tool handler interprets the payload (e.g. `patient_exists` reads `cantidad`).
 */
export function unwrapHimedScheduling(res: RequestResult, operation: string): Unwrapped {
  if (!res.ok) {
    return {
      ok: false,
      code: res.errorCode,
      message: `HiMed scheduling ${operation} failed (HTTP ${res.status})`,
    };
  }
  return { ok: true, data: res.data };
}
