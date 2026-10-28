import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Wompi authenticates every merchant call with the private key as a bearer token
 * (`Authorization: Bearer prv_test_…` / `prv_prod_…`), verified against the sandbox on 2026-10-22.
 *
 * One secret only. The public key is not a secret (it rides as call context, `context.ts`); the
 * events secret verifies Wompi's webhooks, which is the consumer's job, so it never reaches this
 * server; the integrity secret signs Wompi's embedded checkout, which payment links do not use.
 *
 * Delivery is `reference` — ADR 0003's hard gate for financial providers, as ADR 0010 settled it for
 * Siigo and Erbon. The private key is durable and creates payment links and reads every transaction,
 * so it never travels on a `tools/call`: the consumer hands over a short-lived reference and this
 * server resolves it at call time (Mateo, 2026-10-24).
 */
export const wompiAuth: ProviderAuthDescriptor = {
  type: 'bearer',
  credentialDelivery: 'reference',
  fields: [{ key: 'private_key', label: 'Wompi private key', placement: 'header' }],
};
