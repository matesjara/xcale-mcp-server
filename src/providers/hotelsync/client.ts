import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';
import type { HotelSyncContext } from './context';

/** HotelSync production. Staging is `https://beta.hotelsync.com`, with its own partner token. */
export const HOTELSYNC_PRODUCTION_URL = 'https://app.hotelsync.com';

/**
 * The only hosts this server sends a HotelSync session to. The session key and the partner token ride in
 * every request body, so a configurable host must never point anywhere else (CTO decision on #187).
 */
export const HOTELSYNC_ALLOWED_HOSTS: readonly string[] = [
  HOTELSYNC_PRODUCTION_URL,
  'https://beta.hotelsync.com',
];

/** Executes an authenticated request; the core places `key` and `token` in the JSON body. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface HotelSyncClientDeps {
  /** One of {@link HOTELSYNC_ALLOWED_HOSTS}; production by default. */
  readonly baseUrl?: string;
}

export interface HotelSyncClient {
  /**
   * POST `${baseUrl}${path}` with `{ id_properties, ...body }`. Every HotelSync endpoint is a JSON POST. The
   * property comes from the call context, never from a tool input; `key` and `token` are added by the core
   * materializer, which refuses to overwrite them — so the body never carries them from here.
   */
  post(
    path: string,
    request: AuthedRequest,
    ctx: HotelSyncContext,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<RequestResult>;
}

/** Whether `baseUrl` (trailing slashes ignored) is one of the allowed HotelSync hosts. */
export function isAllowedHotelSyncHost(baseUrl: string): boolean {
  return HOTELSYNC_ALLOWED_HOSTS.includes(baseUrl.replace(/\/+$/, ''));
}

export function createHotelSyncClient(deps: HotelSyncClientDeps = {}): HotelSyncClient {
  const baseUrl = (deps.baseUrl ?? HOTELSYNC_PRODUCTION_URL).replace(/\/+$/, '');
  if (!isAllowedHotelSyncHost(baseUrl)) {
    // A host outside the allowlist would receive the session key and the partner token. Fail at
    // construction; the provider factory turns it into a boot warning and fail-closed tools.
    throw new Error('HotelSync base URL is not an allowed HotelSync host');
  }
  return {
    post: (path, request, ctx, body = {}) =>
      request({
        method: 'POST',
        url: `${baseUrl}${path}`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, id_properties: ctx.id_properties }),
      }),
  };
}
