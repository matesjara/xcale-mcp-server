import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * WooCommerce authenticates with **HTTP Basic**: `consumer_key` as the user and `consumer_secret`
 * as the password, i.e. `Authorization: Basic base64(consumer_key:consumer_secret)`. Both are durable
 * secrets used directly on every call — unlike Siigo, there is no token-exchange endpoint.
 *
 * The two secrets are joined into a single `consumer_key:consumer_secret` string by the consumer
 * (Rail A) and forwarded as one credential; this server stays single-secret and only Base64-encodes
 * it into the header (the `basic` materialization). See ADR 0018 (basic-http-auth-scheme).
 *
 * ⚠️ Base64 is not encryption — the credential is only safe over TLS. Rail A rejects non-`https`
 * store URLs at connect, so a materialized WooCommerce request is always HTTPS.
 */
export const woocommerceAuth: ProviderAuthDescriptor = {
  type: 'basic',
  credentialDelivery: 'forwarded',
  // Declared order IS the Basic order: consumer_key (user) : consumer_secret (password).
  fields: [
    { key: 'consumer_key', label: 'Consumer Key' },
    { key: 'consumer_secret', label: 'Consumer Secret' },
  ],
};
