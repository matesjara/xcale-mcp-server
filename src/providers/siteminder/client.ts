import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';

/** Production — the only environment SiteMinder documents for the Direct Booking API (no sandbox). */
const DEFAULT_BASE_URL = 'https://directbooking.siteminder.com/public-api/api';

export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

/** Executes an authenticated request; the core reveals the key and sets `x-sm-api-key`. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface SiteminderClientDeps {
  readonly baseUrl?: string;
}

export interface SiteminderClient {
  /**
   * `GET /properties/{propertyUuid}{subPath}`. Every Direct Booking read is scoped by the property,
   * so the client owns that prefix; `subPath` segments come from the tools, already encoded.
   */
  getProperty(
    propertyUuid: string,
    subPath: string,
    request: AuthedRequest,
    params?: QueryParams,
  ): Promise<RequestResult>;
}

/** Encode one dynamic path segment. A room-type id from the model is never trusted to be a bare uuid. */
export function segment(value: string): string {
  return encodeURIComponent(value);
}

export function createSiteminderClient(deps: SiteminderClientDeps = {}): SiteminderClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  return {
    getProperty: (propertyUuid, subPath, request, params = {}) => {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) qs.set(key, String(value));
      }
      const query = qs.toString();
      const path = `${baseUrl}/properties/${segment(propertyUuid)}${subPath}`;
      return request({ method: 'GET', url: query ? `${path}?${query}` : path });
    },
  };
}
