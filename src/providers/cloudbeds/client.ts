import type { FetchLike, RequestResult } from '../../core/http';
import { requestJson } from '../../core/http';
import type { SecretString } from '../../core/secret-string';

const DEFAULT_BASE_URL = 'https://hotels.cloudbeds.com/api/v1.3';

export interface CloudbedsClientDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  readonly baseUrl?: string;
}

export type QueryParams = Record<string, string | number | undefined>;

export interface CloudbedsClient {
  get(method: string, token: SecretString, params: QueryParams): Promise<RequestResult>;
}

/** Thin Cloudbeds API v1.3 client. Provider-specific request shaping lives here, not in core. */
export function createCloudbedsClient(deps: CloudbedsClientDeps = {}): CloudbedsClient {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  return {
    get(method, token, params) {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) qs.set(key, String(value));
      }
      const query = qs.toString();
      const url = query ? `${baseUrl}/${method}?${query}` : `${baseUrl}/${method}`;
      return requestJson(url, { method: 'GET', token, fetchImpl: deps.fetchImpl });
    },
  };
}
