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
  // Bumped (2026-10-25): `list_patient_appointments` and `cancel_appointment` name the id space of
  // `idCita` (`recordOwnershipKind: 'himed:cita'`, ADR 0023), so a consumer no longer has to know it
  // per provider. (2026-10-18: `list_patient_appointments` carries `ownedResultField: 'idCita'`, so a
  // consumer can answer "¿qué citas tengo?" with the citas the patient booked here. A consumer caching
  // the 2026-10-17 menu would keep refusing it (fail-closed, not a leak), but would never serve it.
  // (2026-10-17: the published identity policies changed — every patient tool now carries
  // `alwaysEnforce: true`, `cancel_appointment` carries `recordOwnershipField: 'idCita'`, and
  // `create_appointment` / `create_patient` carry no policy. A consumer caching the 2026-10-14 menu
  // would keep the old policies (no `alwaysEnforce` ⇒ unenforced under a tenant's `off`), so the
  // bump is what makes the protection reach it; 2026-10-14: patient tools became `subject-bound` on
  // `idPaciente`; create_appointment requires `parentescoPideCita`.)
  schemaVersion: '2026-10-25',
  providerVersion: '0.7.0',
  connectionProbe: { tool: `mcp_${SLUG}_list_locations` },
  accountContextKeys: ['codigo_servicio'],
};
