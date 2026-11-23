import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';

/** Cadenax production API. Staging is `https://staging-api-cofinet.cadenax.com/api` (its OpenAPI `servers`). */
const DEFAULT_BASE_URL = 'https://api-cofinet.cadenax.com/api';

/** Executes an authenticated request; the core reveals the key and sets `X-API-Key`. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface CadenaxClientDeps {
  readonly baseUrl?: string;
}

/** Query values of one call; `undefined` ones are left out. */
export type CadenaxQuery = Readonly<Record<string, string | number | boolean | undefined>>;

export interface CadenaxClient {
  /**
   * GET `${baseUrl}/{segments…}[?query]`. Each segment is encoded here, so a caller passes raw
   * values (`['lots', id]`) and can never build a path out of one. The credential is NOT here: the
   * core materializer adds the `X-API-Key` header.
   */
  get(
    segments: readonly string[],
    request: AuthedRequest,
    query?: CadenaxQuery,
  ): Promise<RequestResult>;
}

export function createCadenaxClient(deps: CadenaxClientDeps = {}): CadenaxClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  return {
    get: (segments, request, query = {}) => {
      const path = segments.map((segment) => encodeURIComponent(segment)).join('/');
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.append(key, String(value));
      }
      const qs = params.toString();
      return request({ method: 'GET', url: `${baseUrl}/${path}${qs ? `?${qs}` : ''}` });
    },
  };
}
