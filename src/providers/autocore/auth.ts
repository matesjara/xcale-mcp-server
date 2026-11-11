import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Autocore authenticates every call with an `Auth-Token` header computed per request from two keys
 * and the current time — `base64(access_key;ts;sha256_hex(secret_key + ts))`, valid 30 s. The plain
 * `access_key` / `secret_key` headers its Bookings docs describe answer 401 on the payment endpoints
 * (observed on Staging, 2026-11-09). The core's `timestamped_hash_token` variant builds the token; this
 * provider never sees either key (ADR timestamped-hash-token-auth-scheme).
 *
 * Both keys are secret. The consumer composes them in the order `fields` declares
 * (`access_key:secret_key`) into one stored credential.
 *
 * Delivery is `reference` — ADR 0003's hard gate for financial providers, as ADR 0010 settled it: the
 * keys create payment links and cancel them, so they never travel on a `tools/call`.
 */
export const autocoreAuth: ProviderAuthDescriptor = {
  type: 'timestamped_hash_token',
  header: 'Auth-Token',
  credentialDelivery: 'reference',
  fields: [
    { key: 'access_key', label: 'Autocore access key' },
    { key: 'secret_key', label: 'Autocore secret key' },
  ],
};
