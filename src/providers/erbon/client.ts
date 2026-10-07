import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';
import type { ErbonContext } from './context';

/** Erbon production API base. Sandbox uses the same host with test credentials (Observed). */
const DEFAULT_BASE_URL = 'https://api.erbonsoftware.com';

/** Executes an authenticated request; the core reveals the minted JWT and applies `Bearer`. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface ErbonClientDeps {
  readonly baseUrl?: string;
}

export interface ErbonClient {
  /**
   * GET `${baseUrl}/hotel/{hotelID}[/path]`. Erbon takes its filter params (dates, idRate, …) in
   * request HEADERS, not the query string — so callers pass them via `headers`, not a query map. The
   * credential is NOT here: the core materializer appends `Authorization: bearer <jwt>`.
   */
  get(
    path: string,
    request: AuthedRequest,
    ctx: ErbonContext,
    headers?: Readonly<Record<string, string>>,
  ): Promise<RequestResult>;
  /**
   * POST `${baseUrl}/hotel/{hotelID}[/path]` with a JSON body — the write tools (`create_booking`,
   * `create_guest`). Thin passthrough (ADR 0015): one call = one mutation, no retry here. The
   * credential is NOT here — the core materializer appends `Authorization: bearer <jwt>`.
   */
  post(
    path: string,
    request: AuthedRequest,
    ctx: ErbonContext,
    body: Record<string, unknown>,
    headers?: Readonly<Record<string, string>>,
  ): Promise<RequestResult>;
}

export function createErbonClient(deps: ErbonClientDeps = {}): ErbonClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = (path: string, ctx: ErbonContext) =>
    `${baseUrl}/hotel/${encodeURIComponent(ctx.hotelID)}${path ? `/${path}` : ''}`;

  return {
    get: (path, request, ctx, headers) =>
      request({ method: 'GET', url: url(path, ctx), ...(headers ? { headers } : {}) }),

    post: (path, request, ctx, body, headers) =>
      request({
        method: 'POST',
        url: url(path, ctx),
        headers: { 'content-type': 'application/json', ...(headers ?? {}) },
        body: JSON.stringify(body),
      }),
  };
}
