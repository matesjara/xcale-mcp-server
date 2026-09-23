import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Mews authenticates in the JSON body of every call, never in a header (observed 2026-09-23):
 *
 *   ClientToken  xcale's identity as a Mews partner  → this server's deployment config (`client.ts`)
 *   AccessToken  one hotel (enterprise)              → the connection's credential (this descriptor)
 *   Client       the integration's name and version  → deployment config
 *
 * The core places the `AccessToken` (ADR 0018, `json_body`); the adapter never sees it. `forwarded`
 * is allowed: nothing this provider publishes moves money (ADR 0003).
 */
export const mewsAuth: ProviderAuthDescriptor = {
  type: 'api_key',
  credentialDelivery: 'forwarded',
  fields: [{ key: 'AccessToken', label: 'Access token', placement: 'json_body' }],
};
