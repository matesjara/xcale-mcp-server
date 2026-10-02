import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'himed';

/**
 * HiMed Demográficos — `m.medsas.co` patient records (Colombian cloud clinical-records system):
 * create / update a patient and change a patient's document. The directory reads (Doctores, Sedes) are
 * a SEPARATE provider (`himed-directory`) because HiMed issues a separate token per API (2026-10-01).
 *
 * The credential (`api_key`) travels in the JSON body — see `auth.ts` and the body-placement ADR.
 *
 * **No `connectionProbe`:** Demográficos exposes only writes (crearPaciente/modificar) — no read, ping
 * or validate endpoint exists (confirmed against the developer docs). So a pasted key cannot be proven
 * at connect; it is validated lazily on the first patient write (a bad key surfaces as AUTH_EXPIRED →
 * reconnect). The consumer must opt into connecting this provider without a probe — see the backend
 * ADR on probe-less credential connect.
 */
export const himedManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'HiMed — Pacientes',
  category: 'health',
  schemaVersion: '2026-09-25',
  providerVersion: '0.2.0',
};
