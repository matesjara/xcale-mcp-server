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
  };
}
