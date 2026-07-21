import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'cloudbeds';

export const cloudbedsManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Cloudbeds',
  category: 'hospitality',
  schemaVersion: '2026-06-21',
  providerVersion: '0.1.0',
  logoUrl: '/assets/cloudbeds.svg',
  capabilities: { pagination: true },
};
