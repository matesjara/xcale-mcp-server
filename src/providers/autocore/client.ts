import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';
import type { AutocoreContext, AutocoreEnvironment } from './context';

/** Staging observed (2026-11-09); Production documented. */
const DEFAULT_BASE_URLS: Readonly<Record<AutocoreEnvironment, string>> = {
  staging: 'https://api-stg.autocore.pro',
  production: 'https://api.autocore.pro',
};

export type QueryParams = Readonly<Record<string, string | number | undefined>>;

/** Executes an authenticated request; the core reveals the keys and adds the `Auth-Token` header. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface AutocoreClientDeps {
  /** Tests only: point both environments somewhere else. */
  readonly baseUrls?: Readonly<Record<AutocoreEnvironment, string>>;
}

/** Paths start with `/` (`/v2/hotels`). No method retries: a create is not idempotent at Autocore. */
export interface AutocoreClient {
  get(
    path: string,
    request: AuthedRequest,
    ctx: AutocoreContext,
    params?: QueryParams,
  ): Promise<RequestResult>;
  post(
    path: string,
    request: AuthedRequest,
    ctx: AutocoreContext,
    body: Readonly<Record<string, unknown>>,
  ): Promise<RequestResult>;
  delete(path: string, request: AuthedRequest, ctx: AutocoreContext): Promise<RequestResult>;
}

function buildUrl(baseUrl: string, path: string, params: QueryParams = {}): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const query = qs.toString();
  return `${baseUrl}${path}${query ? `?${query}` : ''}`;
}

export function createAutocoreClient(deps: AutocoreClientDeps = {}): AutocoreClient {
  const baseUrls = deps.baseUrls ?? DEFAULT_BASE_URLS;
  const base = (ctx: AutocoreContext) => baseUrls[ctx.environment];

  return {
    get: (path, request, ctx, params) =>
      request({ method: 'GET', url: buildUrl(base(ctx), path, params) }),

    post: (path, request, ctx, body) =>
      request({
        method: 'POST',
        url: buildUrl(base(ctx), path),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),

    delete: (path, request, ctx) => request({ method: 'DELETE', url: buildUrl(base(ctx), path) }),
  };
}
