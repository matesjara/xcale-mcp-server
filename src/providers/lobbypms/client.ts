import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';

/** LobbyPMS production API. There is no sandbox (LobbyPMS, 2026-10-13/14). */
const DEFAULT_BASE_URL = 'https://api.lobbypms.com/api';

/** Executes an authenticated request; the core appends `api_token` to the URL. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface LobbypmsClientDeps {
  readonly baseUrl?: string;
}

/** A query value: absent values are dropped, never sent as `undefined`. */
type Query = Readonly<Record<string, string | number | undefined>>;

export interface LobbypmsClient {
  /** GET `${baseUrl}/${path}?query`. The credential is NOT here — the core appends it. */
  get(path: string, request: AuthedRequest, query?: Query): Promise<RequestResult>;
  /** POST `${baseUrl}/${path}` with a JSON body. One call = one mutation; no retry here (ADR 0015). */
  post(path: string, request: AuthedRequest, body: Record<string, unknown>): Promise<RequestResult>;
  /** DELETE `${baseUrl}/${path}`. */
  delete(path: string, request: AuthedRequest): Promise<RequestResult>;
}

export function createLobbypmsClient(deps: LobbypmsClientDeps = {}): LobbypmsClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const url = (path: string, query?: Query) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    return `${baseUrl}/${path}${qs ? `?${qs}` : ''}`;
  };

  return {
    get: (path, request, query) => request({ method: 'GET', url: url(path, query) }),
    post: (path, request, body) =>
      request({
        method: 'POST',
        url: url(path),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    delete: (path, request) => request({ method: 'DELETE', url: url(path) }),
  };
}

/** One path segment, encoded — every dynamic id goes through here. */
export const seg = (v: string | number): string => encodeURIComponent(String(v));
