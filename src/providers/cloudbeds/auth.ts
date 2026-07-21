import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Non-secret OAuth2 blueprint published via the catalog. Rail A (the consumer) runs the flow with
 * its own clientId/secret (Doppler) — those NEVER appear here.
 * API v1.3 — matches the registered Cloudbeds app (the authorize URL the app generates is
 * `https://hotels.cloudbeds.com/api/v1.3/oauth`). Scopes confirmed against the app's OAuth URL:
 * `read:guest read:hotel read:rate read:reservation read:room` (read-first pilot).
 */
export const cloudbedsAuth: ProviderAuthDescriptor = {
  type: 'oauth2',
  authorizationUrl: 'https://hotels.cloudbeds.com/api/v1.3/oauth',
  tokenUrl: 'https://hotels.cloudbeds.com/api/v1.3/access_token',
  scopes: ['read:reservation', 'read:guest', 'read:room', 'read:hotel', 'read:rate'],
  tokenPlacement: 'bearer_header',
  supportsRefresh: true,
};
