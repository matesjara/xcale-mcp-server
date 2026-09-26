import type { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

/**
 * Map a failed WooCommerce `RequestResult` to a typed error outcome — the one place the provider
 * shapes an error, so every tool is identical.
 *
 * **Status/code only — never interpolate `res.body` or the URL.** The body can echo request context
 * (and on query-credential providers the credential); the core already redacts it, and this keeps it
 * out of the tool's message entirely. 401/403 arrive here as `PROVIDER_AUTH_EXPIRED` (via
 * `mapHttpStatusToErrorCode`), so a revoked/insufficient key surfaces as a reconnect signal.
 *
 * The return shape is the common error member of both `ToolOutcome` and `PaginatedHandlerResult`,
 * so single-object tools and `definePaginatedList` handlers can both `return wooError(res)`.
 */
export function wooError(res: Extract<RequestResult, { ok: false }>): {
  readonly ok: false;
  readonly code: ProviderErrorCode;
  readonly message: string;
} {
  return { ok: false, code: res.errorCode, message: `WooCommerce error (HTTP ${res.status})` };
}
