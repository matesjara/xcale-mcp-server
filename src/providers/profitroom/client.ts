import type { z } from 'zod';

import type { RequestSpec } from '../../core/auth/http-request';
import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

/**
 * The fixed API base. Every request is built from THIS constant plus a parsed hotel key — never from
 * the connection's `bookingEngineUrl` (SSRF, see `context.ts`).
 */
const API_BASE = 'https://booking.profitroom.com/api/';

export type Resource = 'details' | 'rooms' | 'offers' | 'calendar' | 'availability';

export type ClientResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

export interface GetOptions {
  readonly query?: Readonly<Record<string, string>>;
}

/** The core's authenticated-request executor (`ToolHandlerContext.request`); `none` adds no auth. */
export type SendRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface ProfitroomClient {
  get<S extends z.ZodTypeAny>(
    request: SendRequest,
    hotelKey: string,
    resource: Resource,
    schema: S,
    opts?: GetOptions,
  ): Promise<ClientResult<z.infer<S>>>;
  /** Drop a hotel's cached static resources (used when a proposal names an unknown room/offer). */
  invalidate(hotelKey: string): void;
}

export interface ProfitroomClientOptions {
  /** Injectable clock for deterministic cache tests (default `Date.now`). */
  readonly now?: () => number;
}

/**
 * Static resources change rarely and `rooms` alone is ~45 KB / 1.4 s (contract §A.1): cached in memory,
 * per hotel (and query), for 15 minutes. Responses carry every translation, so the locale is chosen in
 * the provider, not asked of the engine. `calendar` and `availability` are NEVER cached — a price or an
 * open night must always be live. Only parsed successes are cached; a failure is retried next call.
 * Per process and public data only, so it holds no credential (Credential-in-Transit-Only untouched).
 */
const CACHE_TTL_MS = 15 * 60_000;
const CACHED: ReadonlySet<Resource> = new Set(['details', 'rooms', 'offers']);

export function createProfitroomClient(options: ProfitroomClientOptions = {}): ProfitroomClient {
  const now = options.now ?? Date.now;
  const cache = new Map<string, { readonly at: number; readonly data: unknown }>();

  return {
    invalidate(hotelKey) {
      for (const key of cache.keys()) {
        if (key.startsWith(`${hotelKey}|`)) cache.delete(key);
      }
    },

    async get(request, hotelKey, resource, schema, opts = {}) {
      const url = buildUrl(hotelKey, resource, opts);
      const cacheKey = CACHED.has(resource) ? `${hotelKey}|${url}` : null;
      const hit = cacheKey === null ? undefined : cache.get(cacheKey);
      if (hit !== undefined && now() - hit.at < CACHE_TTL_MS) {
        return { ok: true, data: hit.data };
      }

      const res = await request({
        method: 'GET',
        url,
        headers: { 'x-requested-with': 'XMLHttpRequest' },
      });
      if (!res.ok) return remapFailure(resource, res);
      // Fail closed (contract §C.4): a response that no longer has the fields we read is never
      // half-used. The message names the field path — never response data — for the consumer's log.
      const parsed = schema.safeParse(res.data);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue ? `${issue.path.join('.')} ${issue.message}` : 'unknown shape';
        return {
          ok: false,
          code: ProviderErrorCode.PROVIDER_ERROR,
          message: `unexpected response from Profitroom (${resource}: ${where})`,
        };
      }
      if (cacheKey !== null) {
        // Sweep on write: an expired entry of a hotel nobody asks for any more is dropped here, so the
        // long-running gateway never keeps it for good.
        const at = now();
        for (const [key, entry] of cache) {
          if (at - entry.at >= CACHE_TTL_MS) cache.delete(key);
        }
        cache.set(cacheKey, { at, data: parsed.data });
      }
      return { ok: true, data: parsed.data };
    },
  };
}

function buildUrl(hotelKey: string, resource: Resource, opts: GetOptions): string {
  const params = new URLSearchParams(opts.query);
  const qs = params.toString();
  return `${API_BASE}${encodeURIComponent(hotelKey)}/${resource}${qs ? `?${qs}` : ''}`;
}

/**
 * Contract §C.5, on top of the core's universal status policy (`mapHttpStatusToErrorCode`):
 * - 401/403 → UNAVAILABLE, not AUTH_EXPIRED. A credential-less provider has nothing to reconnect;
 *   a refusal here means the engine blocked us, and a reconnect prompt would mislead the consumer.
 * - 404 `auth.site_not_found` → INVALID_INPUT: the connection's URL names no Profitroom hotel.
 * Everything else keeps the core's code. Messages never echo the response body.
 */
function remapFailure(
  resource: Resource,
  res: Extract<RequestResult, { ok: false }>,
): ClientResult<never> {
  if (res.status === 0) {
    // The core transport's timeout / network failure (no HTTP answer at all).
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
      message: `Profitroom did not answer the ${resource} request`,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
      message: `Profitroom refused the ${resource} request (HTTP ${res.status})`,
    };
  }
  if (res.status === 404 && res.body.includes('auth.site_not_found')) {
    return {
      ok: false,
      code: ProviderErrorCode.INVALID_INPUT,
      message: 'bookingEngineUrl names no Profitroom hotel',
    };
  }
  return {
    ok: false,
    code: res.errorCode,
    message: `Profitroom ${resource} request failed (HTTP ${res.status})`,
  };
}
