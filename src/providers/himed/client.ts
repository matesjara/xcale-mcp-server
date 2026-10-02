import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';

/**
 * The HiMed transport for all three groups:
 *  - `post(endpoint, …)` → Demográficos + directory: `m.medsas.co/.../{Controller}/{op}.php`, one POST
 *    per `.php` endpoint (e.g. `Demograficos/crearPaciente.php`, `Sedes/consultarSedes.php`).
 *  - `callScheduling(…)` → Autoagendamiento: a single RPC endpoint dispatched by the `accion` body field.
 * The secret is NOT set here — the core materializer injects the called tool's group secret into the
 * JSON body (placement:'body'). The two groups that share `m.medsas.co` share `baseUrl`; scheduling has
 * its own `schedulingBaseUrl`.
 */
const DEFAULT_BASE_URL = 'https://m.medsas.co/interoperabilidad/Api/Controllers';
const DEFAULT_SCHEDULING_BASE_URL =
  'https://socket.medsas.co/test/notificaciones/envioConsumoAutoagendamiento';

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
  callScheduling(
    request: AuthedRequest,
    body: Record<string, unknown>,
  ): Promise<RequestResult>;
}

export function createHimedClient(deps: HimedClientDeps = {}): HimedClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const schedulingUrl = deps.schedulingBaseUrl ?? DEFAULT_SCHEDULING_BASE_URL;
  return {
    post: (endpoint, request, body) =>
      request({
        method: 'POST',
        url: `${baseUrl}/${endpoint}`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    callScheduling: (request, body) =>
      request({
        method: 'POST',
        url: schedulingUrl,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}
