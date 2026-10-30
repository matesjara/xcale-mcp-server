import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';
import type { AviratoContext } from './context';

/** Avirato API v3, production. The sandbox (`https://sandbox.avirato.com/v3`) has a byte-identical spec. */
const DEFAULT_BASE_URL = 'https://apiv3.avirato.com/v3';

/** Executes an authenticated request; the core reveals the minted JWT and applies `Bearer`. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface AviratoClientDeps {
  readonly baseUrl?: string;
}

/** Query values a call adds after `web_code`; `undefined` ones are left out. */
export type AviratoQuery = Readonly<Record<string, string | number | boolean | undefined>>;

export interface AviratoClient {
  /**
   * GET `${baseUrl}/{path}?web_code=…[&query]`. Every Avirato data call names the establishment in the
   * query string. The credential is NOT here: the core materializer appends `Authorization: Bearer <jwt>`.
   */
  get(
    path: string,
    request: AuthedRequest,
    ctx: AviratoContext,
    query?: AviratoQuery,
  ): Promise<RequestResult>;
  /**
   * POST `${baseUrl}/{path}?web_code=…` with a JSON body. Thin passthrough (ADR 0015): one call is at
   * most one request, never retried here.
   */
  post(
    path: string,
    request: AuthedRequest,
    ctx: AviratoContext,
    body: Record<string, unknown>,
  ): Promise<RequestResult>;
  /** DELETE `${baseUrl}/{path}?web_code=…`. One call, one request, never retried here. */
  del(path: string, request: AuthedRequest, ctx: AviratoContext): Promise<RequestResult>;
}

export function createAviratoClient(deps: AviratoClientDeps = {}): AviratoClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = (path: string, ctx: AviratoContext, query: AviratoQuery = {}) => {
    const params = new URLSearchParams({ web_code: String(ctx.web_code) });
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.append(key, String(value));
    }
    return `${baseUrl}/${path}?${params.toString()}`;
  };

  return {
    get: (path, request, ctx, query) => request({ method: 'GET', url: url(path, ctx, query) }),

    post: (path, request, ctx, body) =>
      request({
        method: 'POST',
        url: url(path, ctx),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),

    del: (path, request, ctx) => request({ method: 'DELETE', url: url(path, ctx) }),
  };
}
