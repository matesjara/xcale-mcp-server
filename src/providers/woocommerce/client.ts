import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';
import type { WoocommerceContext } from './context';

/** The WooCommerce REST API v3 path segment appended after the per-store base URL. */
const API_BASE = 'wp-json/wc/v3';

export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

/** Executes an authenticated request; the core materializes the Basic credential and sends it. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface WoocommerceClient {
  get(
    path: string,
    request: AuthedRequest,
    ctx: WoocommerceContext,
    params?: QueryParams,
  ): Promise<RequestResult>;
  post(
    path: string,
    body: unknown,
    request: AuthedRequest,
    ctx: WoocommerceContext,
    params?: QueryParams,
  ): Promise<RequestResult>;
  put(
    path: string,
    body: unknown,
    request: AuthedRequest,
    ctx: WoocommerceContext,
    params?: QueryParams,
  ): Promise<RequestResult>;
}

/** WooCommerce accepts a JSON body on writes; the credential stays in the Basic header, never here. */
const JSON_HEADERS = { 'content-type': 'application/json' } as const;

/**
 * Build `${storeUrl}/wp-json/wc/v3/${path}?${params}`.
 *
 * The credential is deliberately ABSENT from the URL: WooCommerce auth is HTTP Basic in the
 * `Authorization` header, applied by the core's materializer from the forwarded secret. The client
 * never sees the secret, so a URL built here carries no credential.
 */
function buildUrl(storeUrl: string, path: string, params: QueryParams = {}): string {
  const base = storeUrl.replace(/\/+$/, '');
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const query = qs.toString();
  return `${base}/${API_BASE}/${path}${query ? `?${query}` : ''}`;
}

export function createWoocommerceClient(): WoocommerceClient {
  return {
    get: (path, request, ctx, params) =>
      request({ method: 'GET', url: buildUrl(ctx.storeUrl, path, params) }),
    post: (path, body, request, ctx, params) =>
      request({
        method: 'POST',
        url: buildUrl(ctx.storeUrl, path, params),
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    put: (path, body, request, ctx, params) =>
      request({
        method: 'PUT',
        url: buildUrl(ctx.storeUrl, path, params),
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
  };
}
