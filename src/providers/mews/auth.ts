import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Mews authenticates in the JSON body of every call, never in a header (observed 2026-09-23):
 *
 *   ClientToken  xcale's identity as a Mews partner  → this server's deployment config (`client.ts`)
 *   AccessToken  one hotel (enterprise)              → the connection's credential (this descriptor)
 *   Client       the integration's name and version  → deployment config
 *
 * The core places the `AccessToken` (ADR 0018, `json_body`); the adapter never sees it. `forwarded`
 * is allowed (ADR 0003): Mews is a PMS, not a payment or fiscal provider, and no tool takes a payment.
 * One tool can put money on a guest's bill — `cancel_reservation` with `postCancellationFee` — and
 * that is the hotel's own cancellation policy applied by its PMS, which the consumer gates like any
 * write.
 */
export const mewsAuth: ProviderAuthDescriptor = {
  type: 'api_key',
  credentialDelivery: 'forwarded',
  fields: [{ key: 'AccessToken', label: 'Access token', placement: 'json_body' }],
};
