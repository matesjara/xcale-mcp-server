import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'cloudbeds';

export const cloudbedsManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Cloudbeds',
  category: 'hospitality',
  // Bumped: `list_addons` (read:addon, PMS v2.0) is a new tool in tools/list. Additive, but the
  // consumer caches tools/list keyed on schemaVersion, so without a bump a warm cache would never
  // surface it (same precedent as 0.3.0/0.4.0). NOT bumped by `create_email_template` /
  // `schedule_email` in the same change: both are control-plane, withdrawn from tools/list, so
  // they move nothing this key caches.
  schemaVersion: '2026-08-06',
  providerVersion: '0.6.0',
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
