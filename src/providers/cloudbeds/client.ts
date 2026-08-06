import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';

const DEFAULT_BASE_URL = 'https://hotels.cloudbeds.com/api/v1.3';

/**
 * Cloudbeds **Payments v2** — a DIFFERENT API surface from the v1.3 host every other method uses:
 * JSON (not form-encoding) and a mandatory `X-Property-Id` header (api-contract §1). It is a fixed
 * constant, deliberately independent of the v1.3 `baseUrl` override, so a staging redirect of the
 * PMS host can never accidentally re-point the payments call.
 */
const PAYMENTS_BASE_URL = 'https://api.cloudbeds.com/payments/v2';

/**
 * **PMS v2.0** — a third surface, and not "v1.3 improved": a set of newer microservices (`addons`,
 * `amenities`, `events`, `doorlock`, …) that live on the same host as Payments but under their own
 * roots, each with its own version segment. They take `X-Property-Id` as a header rather than a
 * `propertyID` param, and they answer JSON directly (no `{success, data}` envelope) with failures as
 * real HTTP status codes — observed: a request without the scope is a plain `403 {"message": "You do
 * not have correct scope to perform this action"}`, not the v1.3 `200 + success:false`.
 *
 * Note v2 also inverts the scope spelling (`hotel:read` where v1.3 says `read:hotel`), which is why
 * scope strings are treated as opaque everywhere in this codebase.
 */
const V2_BASE_URL = 'https://api.cloudbeds.com';

/**
 * Percent-encode each Payments v2 path segment. Every id that reaches a payments URL goes through
 * here, so a caller-supplied value (`../refund`, `abc?x=1`) selects a resource NAME, never a
 * different endpoint or extra query params — regardless of what the tool's input schema allows.
 */
const paymentsPath = (segments: readonly string[]): string =>
  segments.map(encodeURIComponent).join('/');

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
  put(
    method: string,
    request: AuthedRequest,
    body: Record<string, unknown>,
  ): Promise<RequestResult>;
  /**
   * DELETE with its params on the **query string**. Observed against the live sandbox: Cloudbeds does
   * not parse a DELETE body, so params sent as a form body are simply absent and the call fails the
   * required-param check. This is why `del` takes `QueryParams` and not a body like `post`/`put` do.
   */
  del(method: string, request: AuthedRequest, params: QueryParams): Promise<RequestResult>;
  /**
   * POST to the **Cloudbeds Payments v2** API (`api.cloudbeds.com/payments/v2`) as JSON. Distinct
   * from `post` (v1.3, form-encoded): `segments` are percent-encoded and joined onto the payments
   * base (each element is ONE path segment — a caller-supplied id can never escape into a sibling
   * endpoint or smuggle query params), `body` is `JSON.stringify`'d, and `headers` (the caller
   * passes `X-Property-Id`) ride alongside the JSON content-type. Auth (the Bearer) is added by the
   * core materializer, as with every other method. The response is JSON **directly**
   * (`{ url, id, … }`), NOT the v1.3 `{ success, data }` envelope — callers read `res.ok`/`res.data`,
   * never `unwrap()`.
   */
  postPayments(
    segments: readonly string[],
    request: AuthedRequest,
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ): Promise<RequestResult>;
  /** GET from the Payments v2 API (e.g. `['pay-by-link', uuid]`). Same base, encoding, and `X-Property-Id` as `postPayments`. */
  getPayments(
    segments: readonly string[],
    request: AuthedRequest,
    headers: Record<string, string>,
  ): Promise<RequestResult>;
  /**
   * GET from a **PMS v2.0** microservice (e.g. `['addons', 'v1', 'addons']`). Segments are
   * percent-encoded and joined onto `api.cloudbeds.com`; the caller passes `X-Property-Id`. Like
   * Payments v2 and unlike v1.3, the response is JSON directly — read `res.ok`/`res.data`, never
   * `unwrap()`.
   */
  getV2(
    segments: readonly string[],
    request: AuthedRequest,
    headers: Record<string, string>,
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
    /**
     * PUT — for the methods that actually want PUT. **The verb is NOT derivable from the name.**
     *
     * This comment used to claim "Cloudbeds maps the method-name prefix to the HTTP verb: a `put*`
     * method sent as POST is a router-level 404". The 404 was real — observed on `putReservation` — but
     * the RULE was a generalisation from that one case, and the published spec refutes it:
     *
     *   putReservation · putGuest · putGuestNote · putReservationNote · putRoomBlock  → PUT
     *   putGroup · putRate · putAppPropertySettings · patchGroup · patchRate          → **POST**
     *
     * So five `put*`/`patch*` methods are POST endpoints, and following our own documented rule would
     * 404 them. Check `pms-v1.3-openapi.yaml` per method; never infer the verb from the prefix.
     */
    put(method, request, body) {
      return request({
        method: 'PUT',
        url: `${baseUrl}/${method}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: formEncode(body),
      });
    },
    del(method, request, params) {
      // Query string, not a body — a DELETE body is not parsed (see the interface note).
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) qs.set(key, String(value));
      }
      const query = qs.toString();
      return request({
        method: 'DELETE',
        url: query ? `${baseUrl}/${method}?${query}` : `${baseUrl}/${method}`,
      });
    },
    postPayments(segments, request, body, headers) {
      return request({
        method: 'POST',
        url: `${PAYMENTS_BASE_URL}/${paymentsPath(segments)}`,
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    },
    getPayments(segments, request, headers) {
      return request({
        method: 'GET',
        url: `${PAYMENTS_BASE_URL}/${paymentsPath(segments)}`,
        headers: { ...headers },
      });
    },
    getV2(segments, request, headers) {
      return request({
        method: 'GET',
        url: `${V2_BASE_URL}/${paymentsPath(segments)}`,
        headers: { ...headers },
      });
    },
  };
}
