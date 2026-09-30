import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'mews';

/**
 * Mews — a cloud hotel PMS (Connector API). Design and evidence: `docs/design/mews-provider/`.
 *
 * `mcp_mews_list_services` is both the probe and the discovery tool: it needs no context, so it
 * proves a pasted `AccessToken` and, in the same answer, lists the services the hotel can bind to.
 * It returns only active bookable services sold by the night, in the hotel's own `Ordering`, so the
 * entry the consumer binds by default (`0.Id`) is never a POS, an add-on or an hourly service, and
 * the list's length is the honest count of candidates. A hotel with several nightly ones (rooms and
 * apartments, say) gets the consumer's ambiguity warning.
 */
export const mewsManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Mews',
  category: 'hospitality',
  // 2026-09-29: three read tools publish the `identityPolicy` every provider tool that reaches a
  // person's records now carries (ADR 0019) — a change to `tools/list`, so the version steps.
  // 2026-09-30: list_products, list_reservation_notes and add_reservation_note join the menu (E29).
  // And the owner's back office (E30): list_rooms, list_availability_blocks, update_customer,
  // change_reservation_dates and assign_room.
  schemaVersion: '2026-09-30',
  providerVersion: '0.4.0',
  connectionProbe: { tool: `mcp_${SLUG}_list_services` },
  contextDiscovery: {
    key: 'serviceId',
    tool: `mcp_${SLUG}_list_services`,
    resultPath: '0.Id',
    // The service name, so the owner is told WHICH service was bound, not its GUID.
    labelPath: '0.Name',
  },
};
