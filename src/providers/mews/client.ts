import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';

/** Executes an authenticated request; the core places the hotel's `AccessToken` in the body. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

/**
 * The Mews operations that only read. Mews throttles per `AccessToken` and answers 429 (E13); a read
 * repeated changes nothing, so it waits and tries again. A write never does: a create or a cancel
 * repeated without knowing what the first one did is how a hotel ends up with two bookings.
 */
const READ_OPERATION = /\/(getAll|get|getUrls|getPricing|getAvailability|price)(\/|$)/;

/** One wait per retry of a throttled read, in order. Short: a guest is waiting on WhatsApp. */
export const READ_RETRY_DELAYS_MS: readonly number[] = [1000, 2500];

/**
 * The longest wait a read takes when Mews says how long (`Retry-After`). Mews' window is 200 requests
 * per AccessToken in 30 s (docs › Environments); past this ceiling the read fails and the consumer
 * decides, rather than holding a guest's reply.
 */
export const MAX_RETRY_AFTER_MS = 5000;

export function isReadOperation(operation: string): boolean {
  return READ_OPERATION.test(operation);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface MewsClientDeps {
  /** `https://api.mews.com` (production) or `https://api.mews-demo.com`. */
  readonly baseUrl: string;
  /** xcale's partner `ClientToken`. Empty = the client refuses every call (fail closed). */
  readonly clientToken: string;
  /** The `Client` name Mews asks every integration to send (name and version). */
  readonly clientName: string;
  /** Injected so a test does not wait out a retry. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface MewsClient {
  /** False when this deployment has no `ClientToken`: tools answer before any request goes out. */
  readonly configured: boolean;
  /** `POST /api/connector/v1/<operation>` with the operation's fields plus our identity. */
  call(
    operation: string,
    fields: Readonly<Record<string, unknown>>,
    request: AuthedRequest,
  ): Promise<RequestResult>;
}

/**
 * Thin Connector API client. Every Mews operation is a POST whose body carries the operation's own
 * fields next to `ClientToken` and `Client`; the core adds `AccessToken` when it materializes the
 * request (ADR 0020). The `ClientToken` is never logged, never returned and never put in an error:
 * it is only ever part of the outgoing body.
 */
export function createMewsClient(deps: MewsClientDeps): MewsClient {
  const base = deps.baseUrl.replace(/\/+$/, '');
  return {
    configured: deps.clientToken.length > 0,
    call: async (operation, fields, request) => {
      const send = () =>
        request({
          method: 'POST',
          url: `${base}/api/connector/v1/${operation}`,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...fields,
            ClientToken: deps.clientToken,
            Client: deps.clientName,
          }),
        });
      const delays = isReadOperation(operation) ? READ_RETRY_DELAYS_MS : [];
      const sleep = deps.sleep ?? defaultSleep;
      let res = await send();
      for (const fallback of delays) {
        if (res.ok || res.status !== 429) break;
        // Mews says how long to wait; honour it, up to the ceiling. Longer than that, give up now.
        const asked = res.retryAfterMs;
        if (asked !== undefined && asked > MAX_RETRY_AFTER_MS) break;
        await sleep(asked ?? fallback);
        res = await send();
      }
      return res;
    },
  };
}
