import { err, ok, type ToolOutcome } from '../../core/tool';
import type { RequestResult } from '../../core/http';

/**
 * The single unwrap every Erbon tool goes through. Erbon reports failure via HTTP status (401/403 for
 * auth, 400 for bad input, 429 under burst), so the core's `mapHttpStatusToErrorCode` (already applied
 * in `RequestResult.errorCode`) is authoritative and needs no per-provider re-classification.
 *
 * The provider's error body is NOT interpolated into the message (glossary rule): Erbon returns mixed
 * shapes — machine codes (`ERR_ROOM_AVAILABILITY_FETCH`) and pt-BR strings — and echoing them risks
 * leaking request context. A 2xx `data` is the verbatim payload (Fidelity over Unification).
 *
 * `operation` is a stable label (the tool's verb), never the Erbon response body.
 */
export function unwrapErbon(res: RequestResult, operation: string): ToolOutcome {
  if (!res.ok) {
    return err(res.errorCode, `Erbon ${operation} failed (HTTP ${res.status})`);
  }
  return ok(res.data);
}
