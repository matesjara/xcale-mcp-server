import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'profitroom';

/**
 * No `logoUrl` yet: no approved Profitroom asset in `assets/` (implementation plan §1.6). The field is
 * optional; add it with the asset.
 *
 * Connect support for a consumer (xcale-backend #1599, ADR `credential-less-connections` there):
 * - `connectionProbe`: there is no credential to verify, but the URL the owner pasted still has to
 *   name a real Profitroom hotel before a connection is saved. `get_hotel` answers that.
 * - `contextDiscovery`: the same call returns the hotel's `hotelKey`, so the owner is asked only for
 *   the URL. Like Cloudbeds' `propertyID`, the value comes from the provider, not from a form.
 * - `accountContextKeys`: the account is the hotel (`hotelKey`), not the URL. Without it the identity
 *   would default to every required key, and `/es/hotellapausa` and `/en/hotellapausa/home` would
 *   look like two different hotels.
 */
export const profitroomManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Profitroom',
  category: 'hospitality',
  schemaVersion: '2026-10-17',
  providerVersion: '0.2.0',
  connectionProbe: { tool: `mcp_${SLUG}_get_hotel` },
  contextDiscovery: { key: 'hotelKey', tool: `mcp_${SLUG}_get_hotel`, resultPath: 'hotelKey' },
  accountContextKeys: ['hotelKey'],
};
