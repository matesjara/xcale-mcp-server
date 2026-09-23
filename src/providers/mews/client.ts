import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';

/** Executes an authenticated request; the core places the hotel's `AccessToken` in the body. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface MewsClientDeps {
  /** `https://api.mews.com` (production) or `https://api.mews-demo.com`. */
  readonly baseUrl: string;
  /** xcale's partner `ClientToken`. Empty = the client refuses every call (fail closed). */
  readonly clientToken: string;
  /** The `Client` name Mews asks every integration to send (name and version). */
  readonly clientName: string;
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
 * request (ADR 0018). The `ClientToken` is never logged, never returned and never put in an error:
 * it is only ever part of the outgoing body.
 */
export function createMewsClient(deps: MewsClientDeps): MewsClient {
  const base = deps.baseUrl.replace(/\/+$/, '');
  return {
    configured: deps.clientToken.length > 0,
    call: (operation, fields, request) =>
      request({
        method: 'POST',
        url: `${base}/api/connector/v1/${operation}`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...fields,
          ClientToken: deps.clientToken,
          Client: deps.clientName,
        }),
      }),
  };
}
