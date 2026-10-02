import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'himed-directory';

/**
 * HiMed Directory — `m.medsas.co` read-only directory (Colombian cloud clinical-records system):
 * the clinic's doctors (Usuarios) and sedes (Sedes), the full listing with richer fields than the
 * scheduling lists.
 *
 * Split out of the `himed` provider (2026-10-01): HiMed issues a SEPARATE token per API — the
 * Demográficos api_key does NOT authenticate the directory and vice versa (confirmed against the
 * sandbox + the developer docs, one API = one api key). The credential (`api_key`, the clinic's
 * "Token de Servicio") travels in the JSON body. `list_locations` is a cheap read, so it doubles as
 * the `connectionProbe`.
 */
export const himedDirectoryManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'HiMed — Directorio',
  category: 'health',
  schemaVersion: '2026-09-25',
  providerVersion: '0.1.0',
  connectionProbe: { tool: `mcp_${SLUG}_list_locations` },
};
