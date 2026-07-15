import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Non-secret OAuth2 blueprint published via the catalog. Rail A (the consumer) runs the flow with
 * its own clientId/secret (Doppler) — those NEVER appear here.
 * API v1.3 — matches the registered Cloudbeds app (the authorize URL the app generates is
 * `https://hotels.cloudbeds.com/api/v1.3/oauth`). Scopes confirmed against the app's OAuth URL.
 * `write:reservation` + `write:guest` enable the E-08 write-path (booking creation). The app is
 * authorized for both; `write:rate` is intentionally NOT requested (not granted at the app level,
 * and rate setup stays in Cloudbeds admin).
 */
export const cloudbedsAuth: ProviderAuthDescriptor = {
  type: 'oauth2',
  authorizationUrl: 'https://hotels.cloudbeds.com/api/v1.3/oauth',
  tokenUrl: 'https://hotels.cloudbeds.com/api/v1.3/access_token',
  scopes: [
    'read:reservation',
    'read:guest',
    'read:room',
    'read:hotel',
    'read:rate',
    'write:reservation',
    'write:guest',
  ],
  tokenPlacement: 'bearer_header',
  supportsRefresh: true,
};
