import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'cloudbeds';

export const cloudbedsManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Cloudbeds',
  category: 'hospitality',
  // Bumped: write-path + scope-driven toolset; `success:false` scope denials now map to
  // AUTH_EXPIRED (reconnect) instead of PROVIDER_ERROR; webhook subscription tools withdrawn from
  // the published toolset (unsafe as agent surface — see tools.ts). tools/list changed, so bump.
  schemaVersion: '2026-07-22',
  providerVersion: '0.3.0',
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
