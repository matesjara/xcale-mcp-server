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
 * The SECOND way in: an API key the property mints in its own Cloudbeds account
 * (*Account → Apps & Marketplace → API Credentials*) and pastes into xcale. Keys are prefixed
 * `cbat_`, are long-lived, and carry only the scopes the property ticked when creating them.
 *
 * **This is a connect method, not a second auth scheme.** Declared `bearer` — not `api_key` with
 * `placement: 'header'` — because that makes it materialize byte-identically to `cloudbedsAuthBase`
 * above (`Authorization: Bearer <secret>`), which is the invariant
 * `__tests__/auth-materialization-parity.test.ts` enforces and the reason nothing in `client.ts` or
 * the materializer had to change. Cloudbeds accepts the key under BOTH `Authorization: Bearer` and
 * `x-api-key` — measured against a live property key on 2026-08-20, both returned 200 — so choosing
 * the placement that preserves the invariant costs nothing.
 *
 * Why it exists: the OAuth path is gated by Cloudbeds' partner certification (*"Before
 * certification, your app can only connect to your test account"*); this one is not gated at all, so
 * it is the only route a real hotel has today. See ADR `multiple-connect-methods-per-provider` for
 * what this lane cannot do (`getAppState`/`postAppState` are refused on a property key, so there is
 * no connect/disconnect state machine and no webhook echo identity).
 */
export const cloudbedsApiKeyAuth: ProviderAuthDescriptor = {
  type: 'bearer',
  credentialDelivery: 'forwarded',
  fields: [{ key: 'apiKey', label: 'Cloudbeds API key', placement: 'header' }],
};

/**
 * The scopes the **Cloudbeds app registration** is authorized to request — the ceiling.
 *
 * Source of truth is Cloudbeds' App Details page (*Permission Scopes*), which generates the app's
 * canonical OAuth URL. It is a mirror of an external, human-edited setting, so it is NOT what we
 * request — it is what we are ALLOWED to request. What we request is derived from the tools.
 *
 * Its only job is the guard in `__tests__/scopes.test.ts`: every scope a tool declares must be in here.
 * A tool declaring an unregistered scope would put that scope into the authorize URL and can break the
 * connect flow for EVERY consumer — a whole-provider outage caused by one tool.
 *
 * **Narrowed 32 → 24 on 2026-08-05, and the reason is not tidiness.** The property's *Manage Apps*
 * page lists the app's REGISTERED scopes — so what a hotel reads and approves is this registration,
 * not the derived list we put in the authorize URL. While it held 32, every hotel was being shown a
 * request for financial adjustments and Data Insights that no tool has ever called. Eight came off:
 * `read:adjustment`, `write:adjustment`, the four `read:dataInsights*`, `read:resourceReservations`
 * and `read:resourceTypes` — the last three having no reachable endpoint at all (probed 2026-08-02).
 * Verified after saving: the App Details checkboxes and the generated OAuth URL both carry exactly
 * these 24, which is also exactly the union the tools derive.
 *
 * Cloudbeds' full vocabulary is 61 scopes. If the registration changes, update this list (and only
 * this list). See `docs/design/cloudbeds-scope-coverage/scope-endpoint-map.md`.
 */
export const REGISTERED_SCOPES: readonly string[] = [
  'read:addon',
  'read:allotmentBlock',
  'read:appPropertySettings',
  'read:communication',
  'read:currency',
  'read:customFields',
  'read:dashboard',
  'read:group',
  'read:guest',
  'read:hotel',
  'read:item',
  'read:payment',
  'read:rate',
  'read:reservation',
  'read:room',
  'read:roomblock',
  'read:taxesAndFees',
  'read:user',
  'write:allotmentBlock',
  'write:communication',
  'write:group',
  'write:guest',
  'write:reservation',
  'write:roomblock',
];
