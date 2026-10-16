import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'himed';

/**
 * HiMed — one Colombian cloud clinical-records system, exposed as a single provider over three
 * credential groups (ADR: himed-multi-credential-provider): Demográficos (patient writes), the directory
 * (Doctores + Sedes) and Autoagendamiento (scheduling). The connect form collects one token per group
 * plus the `codigo_servicio` context; `list_locations` (directory) is the `connectionProbe`. The account
 * identity is the clinic's `codigo_servicio`.
 */
export const himedManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'HiMed',
  category: 'health',
  logoUrl: '/assets/himed.svg',
  // Bumped (2026-10-14 review): every tool that reads or changes one patient publishes a
  // `subject-bound` identityPolicy on `idPaciente` (the two reads were mislabeled `subject-scoped`), and
  // create_appointment requires `parentescoPideCita` instead of defaulting it.
  schemaVersion: '2026-10-14',
  providerVersion: '0.4.0',
  connectionProbe: { tool: `mcp_${SLUG}_list_locations` },
  accountContextKeys: ['codigo_servicio'],
};
