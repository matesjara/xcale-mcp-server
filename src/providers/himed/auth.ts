import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * HiMed is one clinical system exposed as three APIs, each with its OWN token (ADR:
 * himed-multi-credential-provider): Demográficos (patient writes), the directory (Doctores + Sedes), and
 * Autoagendamiento (scheduling). Each is a separate `CredentialGroup`; a tool selects its group via
 * `ToolDefinition.credentialGroup`, and the materializer injects that group's secret into the JSON body.
 *
 * `fields` lists only the DISTINCT wire field names the groups inject (`api_key` for Demográficos +
 * directory, `token` for Autoagendamiento) — there are just two, so no collision. The connect FORM is
 * derived from `groups` (one secret per group, keyed by `group.key`), not from `fields`.
 */
export const himedAuth: ProviderAuthDescriptor = {
  type: 'api_key',
  credentialDelivery: 'forwarded',
  fields: [
    { key: 'api_key', label: 'API key', placement: 'body' },
    { key: 'token', label: 'Token', placement: 'body' },
  ],
  groups: [
    {
      key: 'demograficos',
      label: 'Demográficos token',
      field: { key: 'api_key', label: 'API key', placement: 'body' },
      // Demográficos has no read endpoint: the probe is a create with an EMPTY body — HiMed checks the
      // token first (401) and then rejects the empty data (400), so nothing is ever written.
      probe: 'mcp_himed_verify_demograficos',
    },
    {
      key: 'directorio',
      label: 'Service token (directory)',
      field: { key: 'api_key', label: 'API key', placement: 'body' },
      probe: 'mcp_himed_list_locations',
    },
    {
      key: 'autoagendamiento',
      label: 'Autoagendamiento token',
      field: { key: 'token', label: 'Token', placement: 'body' },
      probe: 'mcp_himed_verify_autoagendamiento',
    },
  ],
};
