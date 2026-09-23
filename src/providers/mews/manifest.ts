import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'mews';

/**
 * Mews — a cloud hotel PMS (Connector API). Design and evidence: `docs/design/mews-provider/`.
 *
 * `mcp_mews_list_services` is both the probe and the discovery tool: it needs no context, so it
 * proves a pasted `AccessToken` and, in the same answer, lists the services the hotel can bind to.
 * It returns only active bookable services, nightly ones first and then in the hotel's own
 * `Ordering`, so the entry the consumer binds by default (`0.Id`) is never a POS, an add-on or an
 * hourly service. A hotel with several nightly ones (rooms and apartments, say) still gets the
 * consumer's ambiguity warning.
 */
export const mewsManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Mews',
  category: 'hospitality',
  schemaVersion: '2026-09-23',
  providerVersion: '0.1.0',
  connectionProbe: { tool: `mcp_${SLUG}_list_services` },
  contextDiscovery: {
    key: 'serviceId',
    tool: `mcp_${SLUG}_list_services`,
    resultPath: '0.Id',
  },
};
