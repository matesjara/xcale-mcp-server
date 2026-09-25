import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * HiMed Demográficos authenticates with a single `api_key` that HiMed issues to the clinic. Unlike
 * every earlier provider, the credential goes **in the JSON request body**, not a header or the URL —
 * `placement: 'body'` (ADR: body-placement-for-api-key). The materializer injects it; the client
 * never sees it.
 */
export const himedAuth: ProviderAuthDescriptor = {
  type: 'api_key',
  credentialDelivery: 'forwarded',
  fields: [{ key: 'api_key', label: 'API Key', placement: 'body' }],
};
