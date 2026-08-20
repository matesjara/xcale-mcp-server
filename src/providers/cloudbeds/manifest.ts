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
  // NOT bumped by the API-key connect method: `schemaVersion` keys the consumer's `tools/list`
  // cache, and that change adds a way IN, not a tool. `providerVersion` carries it instead — the
  // catalog entry (auth descriptors, connectionProbe) is read fresh at consumer bootstrap.
  schemaVersion: '2026-08-06',
  providerVersion: '0.7.0',
  logoUrl: '/assets/cloudbeds.svg',
  capabilities: { pagination: true },
  // A Cloudbeds token is scoped to its property; discover the propertyID via getHotels instead of
  // asking the user to paste it (the old flow let the OAuth client_id be pasted here by mistake).
  contextDiscovery: {
    key: 'propertyID',
    tool: `mcp_${SLUG}_list_properties`,
    resultPath: '0.propertyID',
  },
  // Required by the API-key connect method (ADR `multiple-connect-methods-per-provider`): an OAuth
  // callback proves itself, a pasted `cbat_…` key does not, and the consumer's
  // `buildCredentialConfig()` refuses to register a method it cannot verify.
  //
  // `list_properties` and not `get_hotel_details`: the probe runs BEFORE the connection exists, so
  // the propertyID that every other read needs has not been discovered yet. This is the one read
  // that takes no context — which is exactly why `contextDiscovery` above already leans on it.
  // Verified against a real property key (20064, 2026-08-20): `getHotels` → 200, `success:true`.
  connectionProbe: { tool: `mcp_${SLUG}_list_properties` },
};
