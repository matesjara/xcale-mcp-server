import type { RequestSpec } from '../../core/auth/http-request';
import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

/**
 * The HiMed transport for all three groups:
 *  - `post(endpoint, …)` → Demográficos + directory: `{baseUrl}/{Controller}/{op}.php`, one POST per
 *    `.php` endpoint (e.g. `Demograficos/crearPaciente.php`, `Sedes/consultarSedes.php`).
 *  - `callScheduling(…)` → Autoagendamiento: a single RPC endpoint dispatched by the `accion` body field.
 * The secret is NOT set here — the core materializer injects the called tool's group secret into the
 * JSON body (placement:'body'). Demográficos + directory share `baseUrl`; scheduling has its own
 * `schedulingBaseUrl`.
 *
 * There is NO default host. The previous scheduling default was HiMed's TEST endpoint, so a deploy
 * that forgot `HIMED_SCHEDULING_BASE_URL` would have booked real patients into the sandbox with nobody
 * noticing. Each environment sets both (Doppler); an unset one fails closed — no request leaves.
 */

/** Executes an authenticated request; the core reveals the group secret and injects it into the body. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface HimedClientDeps {
  readonly baseUrl?: string;
  readonly schedulingBaseUrl?: string;
}

export interface HimedClient {
  post(
    endpoint: string,
    request: AuthedRequest,
    body: Record<string, unknown>,
  ): Promise<RequestResult>;
  callScheduling(request: AuthedRequest, body: Record<string, unknown>): Promise<RequestResult>;
}

function notConfigured(envVar: string): Promise<RequestResult> {
  return Promise.resolve({
    ok: false,
    status: 0,
    errorCode: ProviderErrorCode.PROVIDER_UNAVAILABLE,
    body: `HiMed host not configured (${envVar})`,
  });
}

export function createHimedClient(deps: HimedClientDeps = {}): HimedClient {
  const baseUrl = deps.baseUrl?.replace(/\/+$/, '');
  const schedulingUrl = deps.schedulingBaseUrl;
  return {
    post: (endpoint, request, body) =>
      baseUrl
        ? request({
            method: 'POST',
            url: `${baseUrl}/${endpoint}`,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
        : notConfigured('HIMED_BASE_URL'),
    callScheduling: (request, body) =>
      schedulingUrl
        ? request({
            method: 'POST',
            url: schedulingUrl,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
        : notConfigured('HIMED_SCHEDULING_BASE_URL'),
  };
}
