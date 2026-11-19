import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'restofy';

/**
 * Restofy — a Colombian restaurant POS (menu, orders, kitchen, reservations). The agent's menu holds the
 * restaurant's profile, channels, menu, the order quote and status, contacts and reservations; the order
 * write and the two reads that return other people's records are control plane. See
 * `docs/design/restofy-provider/`.
 *
 * No `connectionProbe`: like Avirato, a `credential_exchange` provider proves its credential by MINTING
 * once at connect.
 *
 * No `contextDiscovery` and no context at all: the restaurant is sealed in the minted token (observed
 * 2026-11-18), so one connection is one restaurant and a branch is another connection.
 */
export const restofyManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Restofy',
  category: 'restaurant-pos',
  logoUrl: `/assets/${SLUG}.svg`,
  schemaVersion: '2026-11-19',
  providerVersion: '0.1.0',
};
