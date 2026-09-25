import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

export type Unwrapped =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

/**
 * Unwrap a HiMed Autoagendamiento response. Verified against the sandbox (2026-09-24/25):
 *
 * - Reads succeed with **200/201** and a JSON array (or `{ mensaje, cantidad: 0 }` for a not-found
 *   patient). Writes succeed with **200** and `{ success: true, mensaje }` (e.g. cancelarCita).
 * - **HiMed overloads `401`**: it returns `401` for a bad/expired token AND for validation errors
 *   (`CrearCita` → `401 { estado:'error', mensaje:'El parentesco es obligatorio' }`). And its Swagger
 *   says a **200 can carry a captured error** too. So classification is by the **body**, never the
 *   status: only a token-related message is `AUTH_EXPIRED`; every other `estado:'error'` / `success:
 *   false` is a caller-fixable `INVALID_INPUT`. Mapping all 401s to `AUTH_EXPIRED` would tell a clinic
 *   to reconnect a perfectly good credential (the Toteat "Not Authorized" hazard).
 *
 * The returned message carries the provider's **control message** (`mensaje`) — a validation/auth
 * string, never the response data (which may hold PHI).
 */
interface HimedEnvelope {
  readonly estado?: string;
  readonly success?: boolean;
  readonly mensaje?: string;
}

function parseBody(raw: unknown): HimedEnvelope | null {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as HimedEnvelope;
    } catch {
      return null;
    }
  }
  return raw !== null && typeof raw === 'object' ? (raw as HimedEnvelope) : null;
}

function classify(mensaje: string | undefined): ProviderErrorCode {
  return (mensaje ?? '').toLowerCase().includes('token')
    ? ProviderErrorCode.AUTH_EXPIRED
    : ProviderErrorCode.INVALID_INPUT;
}

function fail(operation: string, mensaje: string | undefined, status: number): Unwrapped {
  return {
    ok: false,
    code: classify(mensaje),
    message: mensaje
      ? `HiMed scheduling ${operation}: ${mensaje}`
      : `HiMed scheduling ${operation} failed (HTTP ${status})`,
  };
}

export function unwrapHimedScheduling(res: RequestResult, operation: string): Unwrapped {
  if (!res.ok) {
    // 5xx / transport keep the generic code; 401/4xx get classified by the body message.
    if (res.errorCode === ProviderErrorCode.PROVIDER_UNAVAILABLE) {
      return {
        ok: false,
        code: res.errorCode,
        message: `HiMed scheduling ${operation} failed (HTTP ${res.status})`,
      };
    }
    return fail(operation, parseBody(res.body)?.mensaje, res.status);
  }

  // A 2xx can still carry a captured error.
  const body = parseBody(res.data);
  if (body && (body.estado === 'error' || body.success === false)) {
    return fail(operation, body.mensaje, res.status);
  }
  return { ok: true, data: res.data };
}
