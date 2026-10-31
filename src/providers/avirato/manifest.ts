import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'avirato';

/**
 * Avirato — a Spanish hotel PMS, API v3. The agent's menu holds the hotel's catalog and the reservation
 * reads; the quote and the reservation writes are backend-only (`controlPlane`). See
 * `docs/design/avirato-provider/`.
 *
 * No `connectionProbe`: like Erbon, a `credential_exchange` provider proves its credential by MINTING once
 * at connect.
 *
 * No `contextDiscovery`: no Avirato endpoint lists the establishments a user reaches — the login's own
 * `web_codes` do, and the consumer reads them from its mint.
 */
export const aviratoManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Avirato',
  category: 'hospitality',
  // The house tile (black, rx 6, the mark in white), traced from Avirato's own app icon.
  logoUrl: `/assets/${SLUG}.svg`,
  schemaVersion: '2026-10-30',
  providerVersion: '0.1.0',
};
