import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * HiMed Directory authenticates with a single `api_key` (the clinic's "Token de Servicio") that HiMed
 * issues for the directory APIs (Usuarios + Sedes) — a different credential from Demográficos. The
 * credential goes in the JSON request body (`placement: 'body'`, the body-placement ADR); the
 * materializer injects it and the client never sees it.
 */
export const himedDirectoryAuth: ProviderAuthDescriptor = {
  type: 'api_key',
  credentialDelivery: 'forwarded',
  fields: [{ key: 'api_key', label: 'API Key', placement: 'body' }],
};
