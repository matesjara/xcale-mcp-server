/**
 * The two request shapes on either side of Authentication Materialization
 * (ADR: credential-delivery-strategies).
 *
 * A provider client builds a `RequestSpec` (no auth, no secret). The `AuthenticationMaterializer`
 * reveals the credential and turns it into a fully materialized, plain `HttpRequest` that the HTTP
 * transport sends. The transport never sees a `SecretString`, a `ResolvedCredential`, or any auth
 * scheme — it just sends a built request.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT';

/** What a provider client builds: the request minus authentication. */
export interface RequestSpec {
  readonly method: HttpMethod;
  readonly url: string;
  /** Provider-set headers (e.g. content-type). Auth headers are added by materialization, not here. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | URLSearchParams;
}

/** The materialized, plain request the transport sends — no secret, no auth abstraction. */
export interface HttpRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | URLSearchParams;
}
