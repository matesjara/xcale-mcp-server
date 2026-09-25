import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'himed';

/**
 * HiMed — Demográficos (patient records). A Colombian cloud clinical-records system.
 *
 * Writes only: create / update a patient and change a patient's document. Existence is queried from
 * the sibling `himed-scheduling` provider (`patient_exists`), so there is no cheap no-argument read
 * here and therefore no `connectionProbe`.
 *
 * The credential (`api_key`) travels in the JSON body — see `auth.ts` and the body-placement ADR.
 */
export const himedManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'HiMed — Pacientes',
  category: 'health',
  schemaVersion: '2026-09-25',
  providerVersion: '0.1.0',
};
