import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'hotelsync';

/**
 * HotelSync — a hotel PMS and channel manager (resold white-label, e.g. by Kunas in Colombia). The agent's
 * menu holds the property's money-free reads (property, room types, rate plans, availability,
 * restrictions); prices, reservations and webhooks are backend-only (`controlPlane`). See
 * `docs/design/hotelsync-provider/`.
 *
 * `connectionProbe`: unlike Erbon, the login alone proves only the USER; HotelSync answers a data call
 * for a property the user cannot reach with 403 "No access to property". So connect proves the property
 * with a no-argument property read (CTO decision on #187).
 *
 * No `contextDiscovery`: the only list of a user's properties is the login response, which only the
 * Credential Authority sees — `id_properties` is entered at connect.
 *
 * Every wire fact below the auth layer is read from HotelSync's OpenAPI (`info.version` 2026-10-28), not
 * yet observed against a live property — `docs/design/hotelsync-provider/api-contract.md` › Evidence.
 */
export const hotelsyncManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'HotelSync',
  category: 'hospitality',
  logoUrl: `/assets/${SLUG}.svg`,
  connectionProbe: { tool: `mcp_${SLUG}_get_property` },
  schemaVersion: '2026-10-30',
  providerVersion: '0.1.0',
};
