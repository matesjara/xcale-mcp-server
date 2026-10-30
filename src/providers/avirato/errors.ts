import type { RequestResult } from '../../core/http';
import { err, ok, type ToolOutcome } from '../../core/tool';

/**
 * The single unwrap every Avirato tool goes through. A 2xx answer is Avirato's envelope
 * `{ status: "success", data }`; the tool returns `data` verbatim (Fidelity over Unification).
 *
 * Failure is the core's status map for now; the body-aware cases of the contract's §D (403, the
 * not-found and validation codes) are added in slice S3.
 *
 * `operation` is a stable label (the tool's verb), never Avirato's response body.
 */
export function unwrapAvirato(res: RequestResult, operation: string): ToolOutcome {
  if (!res.ok) {
    return err(res.errorCode, `Avirato ${operation} failed (HTTP ${res.status})`);
  }
  return ok((res.data as { data?: unknown } | null)?.data);
}
