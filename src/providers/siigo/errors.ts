import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

/**
 * Siigo error shaping.
 *
 * Unlike Toteat, Siigo uses HONEST HTTP status codes (Observed B1): `401 unauthorized`,
 * `400 header_required`, `429` under burst — so the core's `mapHttpStatusToErrorCode` (already applied
 * in `RequestResult.errorCode`) is correct and needs no per-provider re-classification. We only enrich
 * the human-readable message with Siigo's own error `Code` when present.
 *
 * Siigo error envelope: `{ "Status": <int>, "Errors": [ { "Code", "Message", "Params", "Detail" } ] }`.
 */
interface SiigoErrorBody {
  readonly Status?: number;
  readonly Errors?: ReadonlyArray<{
    readonly Code?: string;
    readonly Message?: string;
    readonly Params?: readonly string[];
    readonly Detail?: string;
  }>;
}

export type Unwrapped =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

/** Pull `Errors[0].Code`/`Message` out of a Siigo error body string, if it parses. */
function siigoErrorDetail(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as SiigoErrorBody;
    const first = parsed.Errors?.[0];
    if (!first) return undefined;
    const code = first.Code ? `${first.Code}` : undefined;
    const message = first.Message ? `${first.Message}` : undefined;
    if (code && message) return `${code}: ${message}`;
    return code ?? message;
  } catch {
    return undefined;
  }
}

/**
 * The single unwrap every Siigo tool goes through. Siigo reports failure honestly via HTTP status, so
 * a transport-level `!ok` is authoritative; a 2xx `data` is the verbatim payload (Fidelity over
 * Unification — no envelope reshaping, no per-field mapping).
 *
 * `operation` is a stable label (the tool's verb); the Siigo response body is never interpolated beyond
 * its own `Code`/`Message`.
 */
export function unwrapSiigo(res: RequestResult, operation: string): Unwrapped {
  if (!res.ok) {
    const detail = siigoErrorDetail(res.body);
    return {
      ok: false,
      code: res.errorCode,
      message: detail
        ? `Siigo ${operation} failed (HTTP ${res.status}) — ${detail}`
        : `Siigo ${operation} failed (HTTP ${res.status})`,
    };
  }
  return { ok: true, data: res.data };
}
