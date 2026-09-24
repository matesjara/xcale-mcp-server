import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Dentalink authenticates every call with a single **static token** in the `Authorization` header
 * under the non-standard `Token` scheme:
 *
 *   Authorization: Token <access_token>
 *
 * There is no OAuth, no refresh, and no query-string alternative in the vendor docs. The token is the
 * only secret; it is `forwarded` per call and revealed only at the core materializer's single
 * `.reveal()` site, which applies the `scheme` prefix (`Token `) — see ADR
 * `api-key-header-scheme-prefix`. The adapter never sees the raw token, so nothing here may interpolate
 * a credential into a URL, a log, or an error.
 */
export const dentalinkAuth: ProviderAuthDescriptor = {
  type: 'api_key',
  credentialDelivery: 'forwarded',
  fields: [{ key: 'Authorization', label: 'API Token', placement: 'header', scheme: 'Token' }],
};
