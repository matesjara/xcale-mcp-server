import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';

/** Restofy's API. Every call is `POST {base}/{module}/{action}` with a JSON body (observed). */
const DEFAULT_BASE_URL = 'https://restofy.pro/api';

/** Executes an authenticated request; the core reveals the minted JWT and applies `Bearer`. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface RestofyClientDeps {
  readonly baseUrl?: string;
}

export interface RestofyClient {
  /**
   * POST `${baseUrl}/${path}` with a JSON body. `path` is a fixed `module/action` literal from `tools.ts`,
   * never built from input. The credential is NOT here: the core materializer adds `Authorization`.
   * One call is one request, never retried here (ADR 0015).
   */
  call(
    path: string,
    request: AuthedRequest,
    body?: Record<string, unknown>,
    headers?: Readonly<Record<string, string>>,
  ): Promise<RequestResult>;
}

export function createRestofyClient(deps: RestofyClientDeps = {}): RestofyClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  return {
    call: (path, request, body = {}, headers = {}) =>
      request({
        method: 'POST',
        url: `${baseUrl}/${path}`,
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
  };
}
