import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'himed-scheduling';

/**
 * HiMed — Autoagendamiento (appointments). Separate provider from `himed` because it uses a different
 * host and auth scheme (a `token` secret in the body + a non-secret `codigo_servicio` context), which
 * cannot share `himed`'s single `authDescriptor` (feature-design AD-2).
 *
 * Pull-only (no webhooks): reminders are done by polling `list_patient_appointments`. `list_locations`
 * is a cheap, no-argument read, so it doubles as the `connectionProbe` a consumer uses to validate a
 * credential before persisting the connection.
 */
export const himedSchedulingManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'HiMed — Citas',
  category: 'health',
  schemaVersion: '2026-09-25',
  providerVersion: '0.1.0',
  capabilities: { webhooks: false },
  connectionProbe: { tool: `mcp_${SLUG}_list_locations` },
};
