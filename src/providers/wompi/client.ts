import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';
import { environmentOf, type WompiContext, type WompiEnvironment } from './context';

/** Verified (sandbox, 2026-10-21/22) and documented (production). */
const DEFAULT_BASE_URLS: Readonly<Record<WompiEnvironment, string>> = {
  sandbox: 'https://sandbox.wompi.co/v1',
  production: 'https://production.wompi.co/v1',
};

export type QueryParams = Readonly<Record<string, string | number | undefined>>;

/** Executes an authenticated request; the core reveals the private key and adds the bearer header. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface WompiClientDeps {
  /** Tests only: point both environments somewhere else. */
  readonly baseUrls?: Readonly<Record<WompiEnvironment, string>>;
}

export interface WompiClient {
  get(
    path: string,
    request: AuthedRequest,
    ctx: WompiContext,
    params?: QueryParams,
  ): Promise<RequestResult>;
  post(
    path: string,
    request: AuthedRequest,
    ctx: WompiContext,
    body: Readonly<Record<string, unknown>>,
  ): Promise<RequestResult>;
  /** Wompi's partial update (deactivating a link). `PUT` on the same path is a 404. */
  patch(
    path: string,
    request: AuthedRequest,
    ctx: WompiContext,
    body: Readonly<Record<string, unknown>>,
  ): Promise<RequestResult>;
}

function baseUrlFor(
  baseUrls: Readonly<Record<WompiEnvironment, string>>,
  ctx: WompiContext,
): string {
  return baseUrls[environmentOf(ctx.publicKey)];
}

function buildUrl(baseUrl: string, path: string, params: QueryParams = {}): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const query = qs.toString();
  return `${baseUrl}/${path}${query ? `?${query}` : ''}`;
}

export function createWompiClient(deps: WompiClientDeps = {}): WompiClient {
  const baseUrls = deps.baseUrls ?? DEFAULT_BASE_URLS;

  const sendJson = async (
    method: 'POST' | 'PATCH',
    path: string,
    request: AuthedRequest,
    ctx: WompiContext,
    body: Readonly<Record<string, unknown>>,
  ): Promise<RequestResult> =>
    request({
      method,
      url: buildUrl(baseUrlFor(baseUrls, ctx), path),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  return {
    get: async (path, request, ctx, params) =>
      request({ method: 'GET', url: buildUrl(baseUrlFor(baseUrls, ctx), path, params) }),

    post: (path, request, ctx, body) => sendJson('POST', path, request, ctx, body),
    patch: (path, request, ctx, body) => sendJson('PATCH', path, request, ctx, body),
  };
}
