import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';

/** Dentalink public API base (vendor docs). HTTPS is mandatory. */
const DEFAULT_BASE_URL = 'https://api.dentalink.healthatom.com/api/v1';

export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

/** Executes an authenticated request; the core reveals the token and applies `Authorization: Token …`. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface DentalinkClientDeps {
  /** Base URL override — production Dentalink public API by default. Tests inject a stub. */
  readonly baseUrl?: string;
}

export interface DentalinkClient {
  get(path: string, request: AuthedRequest, params?: QueryParams): Promise<RequestResult>;
  post(
    path: string,
    request: AuthedRequest,
    body: Record<string, unknown>,
    params?: QueryParams,
  ): Promise<RequestResult>;
}

/**
 * Build `${baseUrl}/${path}?${query}`. The credential is NOT here — the core's authentication
 * materializer adds `Authorization: Token <token>`; this client only carries query params and, for
 * writes, the JSON body. `id_sucursal` and other selectors are ordinary params/body fields.
 */
function buildUrl(baseUrl: string, path: string, params: QueryParams = {}): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `${baseUrl}/${path}?${query}` : `${baseUrl}/${path}`;
}

export function createDentalinkClient(deps: DentalinkClientDeps = {}): DentalinkClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  return {
    get: (path, request, params) =>
      request({ method: 'GET', url: buildUrl(baseUrl, path, params) }),

    post: (path, request, body, params) =>
      request({
        method: 'POST',
        url: buildUrl(baseUrl, path, params),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}
