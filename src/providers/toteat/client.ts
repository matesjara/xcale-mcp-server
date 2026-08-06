import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';
import type { ToteatContext } from './context';

/**
 * Production. The `*.appspot.com` hosts — including the one in Toteat's own OpenAPI `servers:`
 * block — are legacy and return incomplete data for migrated environments. A test asserts they never
 * appear in a built URL.
 */
const DEFAULT_BASE_URL = 'https://api.toteat.com/mw/or/1.0';

export type QueryParams = Readonly<Record<string, string | number | boolean | undefined>>;

/** Executes an authenticated request; the core reveals the credential and appends it. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface ToteatClientDeps {
  readonly baseUrl?: string;
}

export interface ToteatClient {
  get(
    path: string,
    request: AuthedRequest,
    ctx: ToteatContext,
    params?: QueryParams,
  ): Promise<RequestResult>;
  post(
    path: string,
    request: AuthedRequest,
    ctx: ToteatContext,
    body: Record<string, unknown>,
    params?: QueryParams,
  ): Promise<RequestResult>;
}

/**
 * Build the query string carrying the three context identifiers plus whatever the tool adds.
 *
 * `xapitoken` is deliberately absent: the core's authentication materializer appends it from the
 * forwarded credential. The client never sees the secret, which is the only reason a URL built here
 * is safe to hold in a variable.
 */
function buildUrl(
  baseUrl: string,
  path: string,
  ctx: ToteatContext,
  params: QueryParams = {},
): string {
  const qs = new URLSearchParams({ xir: ctx.xir, xil: ctx.xil, xiu: ctx.xiu });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  return `${baseUrl}/${path}?${qs.toString()}`;
}

export function createToteatClient(deps: ToteatClientDeps = {}): ToteatClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  return {
    get: (path, request, ctx, params) =>
      request({ method: 'GET', url: buildUrl(baseUrl, path, ctx, params) }),

    post: (path, request, ctx, body, params) =>
      request({
        method: 'POST',
        url: buildUrl(baseUrl, path, ctx, params),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}

// ---------------------------------------------------------------------------
// Date windows
// ---------------------------------------------------------------------------

/**
 * Toteat's period endpoints use **three different parameter namings and two date formats** across
 * seven paths — `ini`/`end`, `initial_date`/`final_date`, `start_date`/`end_date`; `YYYYMMDD`
 * everywhere except the cancellation report, which is the lone `YYYY-MM-DD`. All confirmed against
 * the live API. Each tool passes its own names; nothing here generalises them.
 */
export const MAX_WINDOW_DAYS = 15;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ToteatDateError extends Error {}

/** `2026-08-05` → `20260805`. The wire format for six of the seven period endpoints. */
export function toCompactDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

/**
 * Validate a period **before spending a request**. A rejected call still consumes one of the three
 * requests that endpoint allows per minute, so the cheapest place to fail is here.
 *
 * The 15-day cap is confirmed on `/sales` and `/fiscaldocuments`; the vendor README says "most
 * period queries" cap at 15 days, so it is applied everywhere as a conservative default. That part
 * is an inference, and it is why the message quotes the limit rather than claiming Toteat said so.
 */
export function assertDateWindow(start: string, end: string): void {
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) {
    throw new ToteatDateError('Dates must be ISO calendar dates (YYYY-MM-DD).');
  }
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new ToteatDateError('Dates must be ISO calendar dates (YYYY-MM-DD).');
  }
  if (to < from) {
    throw new ToteatDateError('The end date must be on or after the start date.');
  }
  const days = (to - from) / 86_400_000 + 1;
  if (days > MAX_WINDOW_DAYS) {
    throw new ToteatDateError(
      `The maximum period to query is ${MAX_WINDOW_DAYS} days; this request covers ${days}.`,
    );
  }
}
