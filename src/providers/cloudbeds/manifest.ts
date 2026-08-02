import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'cloudbeds';

export const cloudbedsManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Cloudbeds',
  category: 'hospitality',
  // Bumped: pay-by-link tools (Payments v2) added — create_payment_link + get_payment_link_status.
  // Additive, but the consumer caches tools/list keyed on schemaVersion, so without a bump a warm
  // cache would never surface the new tools. tools/list changed, so bump (same precedent as 0.3.0).
  // Bumped for the checkedOut* filters on `list_reservations`: the tool's published input schema changed, and a
  // consumer with a warm cache would keep publishing the old one — the agent would never learn it can
  // ask for departures. NOT bumped by the control-plane tools in the same change (app state + webhook
  // subscriptions): those are withdrawn from tools/list, so they move nothing this key caches.
  schemaVersion: '2026-08-02',
  providerVersion: '0.5.0',
  logoUrl: '/assets/cloudbeds.svg',
  capabilities: { pagination: true },
  // A Cloudbeds token is scoped to its property; discover the propertyID via getHotels instead of
  // asking the user to paste it (the old flow let the OAuth client_id be pasted here by mistake).
  contextDiscovery: {
    key: 'propertyID',
    tool: `mcp_${SLUG}_list_properties`,
    resultPath: '0.propertyID',
  },
};
