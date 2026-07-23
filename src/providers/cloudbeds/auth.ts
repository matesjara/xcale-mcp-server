import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Non-secret OAuth2 blueprint published via the catalog. Rail A (the consumer) runs the flow with
 * its own clientId/secret (Doppler) — those NEVER appear here.
 *
 * API v1.3 — matches the registered Cloudbeds app (the authorize URL the app generates is
 * `https://hotels.cloudbeds.com/api/v1.3/oauth`).
 *
 * NOTE: there is deliberately no `scopes` list here. It is DERIVED from the tools' `requiredScopes`
 * (`deriveOAuthScopes` in `provider.ts`) — see `REGISTERED_SCOPES` below for why a hand-written list
 * is a trap.
 */
export const cloudbedsAuthBase = {
  type: 'oauth2',
  authorizationUrl: 'https://hotels.cloudbeds.com/api/v1.3/oauth',
  tokenUrl: 'https://hotels.cloudbeds.com/api/v1.3/access_token',
  tokenPlacement: 'bearer_header',
  supportsRefresh: true,
} as const satisfies Omit<Extract<ProviderAuthDescriptor, { type: 'oauth2' }>, 'scopes'>;

/**
 * The scopes the **Cloudbeds app registration** is authorized to request — the ceiling.
 *
 * Source of truth is Cloudbeds' App Details page (*Permission Scopes*), which generates the app's
 * canonical OAuth URL; this list was read from that URL verbatim on 2026-07-15. It is a mirror of an
 * external, human-edited setting, so it is NOT what we request — it is what we are ALLOWED to request.
 * What we request is derived from the tools.
 *
 * Its only job is the guard in `__tests__/scopes.test.ts`: every scope a tool declares must be in here.
 * A tool declaring an unregistered scope would put that scope into the authorize URL and can break the
 * connect flow for EVERY consumer — a whole-provider outage caused by one tool.
 *
 * Cloudbeds' full vocabulary is 61 scopes; these 32 are the subset this app is registered for. If the
 * registration changes, update this list (and only this list).
 * See `docs/design/cloudbeds-scope-coverage/scope-endpoint-map.md`.
 */
export const REGISTERED_SCOPES: readonly string[] = [
  'read:addon',
  'read:adjustment',
  'read:allotmentBlock',
  'read:appPropertySettings',
  'read:communication',
  'read:currency',
  'read:customFields',
  'read:dashboard',
  'read:dataInsightsGuests',
  'read:dataInsightsOccupancy',
  'read:dataInsightsPayments',
  'read:dataInsightsReservations',
  'read:group',
  'read:guest',
  'read:hotel',
  'read:item',
  'read:payment',
  'read:rate',
  'read:reservation',
  'read:resourceReservations',
  'read:resourceTypes',
  'read:room',
  'read:roomblock',
  'read:taxesAndFees',
  'read:user',
  'write:adjustment',
  'write:allotmentBlock',
  'write:communication',
  'write:group',
  'write:guest',
  'write:reservation',
  'write:roomblock',
];
