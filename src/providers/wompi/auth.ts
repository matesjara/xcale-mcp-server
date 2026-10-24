import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Wompi authenticates every merchant call with the private key as a bearer token
 * (`Authorization: Bearer prv_test_…` / `prv_prod_…`), verified against the sandbox on 2026-10-22.
 *
 * One secret only. The public key is not a secret (it rides as call context, `context.ts`); the
 * events secret verifies Wompi's webhooks, which is the consumer's job, so it never reaches this
 * server; the integrity secret signs Wompi's embedded checkout, which payment links do not use.
 */
export const wompiAuth: ProviderAuthDescriptor = {
  type: 'bearer',
  credentialDelivery: 'forwarded',
  fields: [{ key: 'private_key', label: 'Wompi private key', placement: 'header' }],
};
