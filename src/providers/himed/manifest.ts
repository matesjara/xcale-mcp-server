import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'himed';

/**
 * HiMed — `m.medsas.co` clinical directory + patient records (Colombian cloud clinical-records system).
 *
 * Patient writes (Demográficos): create / update a patient, change document. Directory reads: list
 * doctors (Usuarios) and sedes (Sedes) — the full directory with richer fields than the scheduling
 * lists. `list_locations` is a cheap read, so it doubles as the `connectionProbe`.
 *
 * The credential (`api_key`) travels in the JSON body — see `auth.ts` and the body-placement ADR.
 */
export const himedManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'HiMed — Directorio y Pacientes',
  category: 'health',
  schemaVersion: '2026-09-25',
  providerVersion: '0.1.0',
  connectionProbe: { tool: `mcp_${SLUG}_list_locations` },
};
