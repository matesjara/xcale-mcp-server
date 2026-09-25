import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';

/**
 * HiMed's `m.medsas.co` APIs (Demográficos, Usuarios/Doctores, Sedes). Every operation is a POST to a
 * `{Controller}/{op}.php` path with a JSON body; the `api_key` is NOT set here — the core materializer
 * injects it into the body (placement:'body'), which is the only reason a body built here is safe to
 * hold in a variable. The `endpoint` passed by each tool is the full controller sub-path
 * (e.g. `Demograficos/crearPaciente.php`, `Usuarios/consultarUsuarios.php`, `Sedes/consultarSedes.php`).
 */
const DEFAULT_BASE_URL = 'https://m.medsas.co/interoperabilidad/Api/Controllers';

/** Executes an authenticated request; the core reveals the credential and injects it into the body. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface HimedClientDeps {
  readonly baseUrl?: string;
}

export interface HimedClient {
  post(
    endpoint: string,
    request: AuthedRequest,
    body: Record<string, unknown>,
  ): Promise<RequestResult>;
}

export function createHimedClient(deps: HimedClientDeps = {}): HimedClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  return {
    post: (endpoint, request, body) =>
      request({
        method: 'POST',
        url: `${baseUrl}/${endpoint}`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}
