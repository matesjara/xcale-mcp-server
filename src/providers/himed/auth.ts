import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * HiMed is one clinical system exposed as four APIs, each with its OWN key (ADR:
 * himed-multi-credential-provider, amended 2026-11-06): Demográficos (patient writes), Sedes, Doctores, and
 * Autoagendamiento (scheduling). Each is a separate `CredentialGroup`; a tool selects its group via
 * `ToolDefinition.credentialGroup`, and the materializer injects that group's secret into the JSON body.
 * The Sedes group keeps its original key, `directorio`, so a stored bundle stays valid.
 *
 * `fields` lists only the DISTINCT wire field names the groups inject (`api_key` for Demográficos, Sedes
 * and Doctores, `token` for Autoagendamiento) — there are just two, so no collision. The connect FORM is
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
      label: 'Sedes token',
      field: { key: 'api_key', label: 'API key', placement: 'body' },
      probe: 'mcp_himed_list_locations',
    },
    {
      key: 'doctores',
      label: 'Doctores token',
      field: { key: 'api_key', label: 'API key', placement: 'body' },
      probe: 'mcp_himed_list_doctors',
    },
    {
      key: 'autoagendamiento',
      label: 'Autoagendamiento token',
      field: { key: 'token', label: 'Token', placement: 'body' },
      probe: 'mcp_himed_verify_autoagendamiento',
    },
  ],
};
