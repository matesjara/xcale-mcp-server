import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';

/** Siigo public API base (Observed B1 — Flavor A, not the alliance surface). */
const DEFAULT_BASE_URL = 'https://api.siigo.com';

export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

/** Executes an authenticated request; the core reveals the minted JWT and applies `Bearer`. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface SiigoClientDeps {
  readonly baseUrl?: string;
  /**
   * The `Partner-Id` header value (deployment config). REQUIRED on every Siigo data call — Siigo 400s
   * with `header_required` without it. Empty string is allowed to construct (a deployment
   * misconfiguration surfaces as a data-call failure, not a crash at import).
   */
  readonly partnerId: string;
}

export interface SiigoClient {
  get(path: string, request: AuthedRequest, params?: QueryParams): Promise<RequestResult>;
}

/**
 * Build `${baseUrl}/${path}?${query}`. The credential is NOT here — the core's authentication
 * materializer appends `Authorization: Bearer <jwt>`; this client only carries the non-secret
 * `Partner-Id` header and the query params.
 */
function buildUrl(baseUrl: string, path: string, params: QueryParams = {}): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `${baseUrl}/${path}?${query}` : `${baseUrl}/${path}`;
}

export function createSiigoClient(deps: SiigoClientDeps): SiigoClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  return {
    get: (path, request, params) =>
      request({
        method: 'GET',
        url: buildUrl(baseUrl, path, params),
        // Partner-Id is non-secret deployment config, required on every data call. The materializer
        // merges these headers, then adds the Bearer JWT on top.
        headers: { 'Partner-Id': deps.partnerId },
      }),
  };
}
