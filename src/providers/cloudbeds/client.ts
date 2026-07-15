import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';

const DEFAULT_BASE_URL = 'https://hotels.cloudbeds.com/api/v1.3';

export interface CloudbedsClientDeps {
  readonly baseUrl?: string;
}

export type QueryParams = Record<string, string | number | undefined>;

/**
 * Executes an authenticated request. The client builds an auth-free `RequestSpec` (URL shaping is the
 * provider's job); the core materializes auth (reveals + applies placement) and transports it. The
 * client never sees the credential.
 */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface CloudbedsClient {
  get(method: string, request: AuthedRequest, params: QueryParams): Promise<RequestResult>;
  post(
    method: string,
    request: AuthedRequest,
    body: Record<string, unknown>,
  ): Promise<RequestResult>;
}

/**
 * Cloudbeds writes are `application/x-www-form-urlencoded` and expect **PHP-style bracketed arrays**
 * (`rooms[0][roomTypeID]=…`) for `rooms`/`adults`/`children` — confirmed against the live sandbox
 * (api-contract §7-A). `undefined`/`null` are dropped so optional fields are simply absent rather than
 * sent as the string "undefined".
 */
function formEncode(body: Record<string, unknown>): URLSearchParams {
  const qs = new URLSearchParams();
  const put = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => put(`${key}[${i}]`, item));
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) put(`${key}[${k}]`, v);
      return;
    }
    qs.set(key, String(value));
  };
  for (const [key, value] of Object.entries(body)) put(key, value);
  return qs;
}

/** Thin Cloudbeds API v1.3 client. Provider-specific request shaping lives here, not in core. */
export function createCloudbedsClient(deps: CloudbedsClientDeps = {}): CloudbedsClient {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  return {
    get(method, request, params) {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) qs.set(key, String(value));
      }
      const query = qs.toString();
      const url = query ? `${baseUrl}/${method}?${query}` : `${baseUrl}/${method}`;
      return request({ method: 'GET', url });
    },
    post(method, request, body) {
      return request({
        method: 'POST',
        url: `${baseUrl}/${method}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: formEncode(body),
      });
    },
  };
}
