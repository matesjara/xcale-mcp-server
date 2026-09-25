import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';

/**
 * HiMed Autoagendamiento is a single endpoint; the `accion` field in the body picks the operation.
 * The handler builds the full body (accion + args + `codigo_servicio`); the core materializer injects
 * the `token` secret into that body (placement:'body'). The client only transports it.
 *
 * Default base URL is the **sandbox** (`/test/…`, runs without credentials). Production releases a
 * different URL after sandbox validation — set it via `baseUrl` / deployment config.
 */
const DEFAULT_BASE_URL =
  'https://socket.medsas.co/test/notificaciones/envioConsumoAutoagendamiento';

export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface HimedSchedulingClientDeps {
  readonly baseUrl?: string;
}

export interface HimedSchedulingClient {
  call(request: AuthedRequest, body: Record<string, unknown>): Promise<RequestResult>;
}

export function createHimedSchedulingClient(
  deps: HimedSchedulingClientDeps = {},
): HimedSchedulingClient {
  const url = deps.baseUrl ?? DEFAULT_BASE_URL;
  return {
    call: (request, body) =>
      request({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}
