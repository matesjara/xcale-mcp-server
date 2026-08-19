import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Siigo authenticates by CREDENTIAL EXCHANGE: a durable `username`+`access_key` is POSTed to a token
 * endpoint that mints a short-lived (24h) Bearer JWT. Rail A (the Credential Authority) runs this mint
 * generically from this declarative descriptor; the durable secret never reaches this server — only the
 * minted JWT does, via the `reference` resolution path.
 *
 * Every value here is Observed against the Siigo public sandbox (B1, 2026-08-13 — see
 * `docs/design/siigo-read-only-provider/b1-sandbox-evidence.md`). It is **Flavor A (public API)**:
 * `POST https://api.siigo.com/auth` with a snake_case body, NOT the alliance flavor.
 *
 * `bodyFields` maps LOGICAL credential keys → the provider's WIRE field names. The LOGICAL keys are a
 * cross-repo contract: the backend `connect` flow persists `credentialSecret` as a JSON object with
 * exactly these keys, and the mint executor reads them by logical name. Keep logical == wire here so the
 * two cannot silently diverge (a B3.3 golden test pins this).
 *
 * `staticHeaders` declares `Partner-Id` (a non-secret institutional identifier; VALUE from deployment
 * config, never this descriptor). The backend applies it on the mint; this server applies its own copy
 * on data calls (see `client.ts`) — the materializer does not resolve `staticHeaders`.
 */
export const siigoAuth: ProviderAuthDescriptor = {
  type: 'credential_exchange',
  credentialDelivery: 'reference',
  tokenEndpoint: 'https://api.siigo.com/auth',
  method: 'POST',
  bodyFields: { username: 'username', access_key: 'access_key' },
  responseFields: { token: 'access_token', expiry: 'expires_in' },
  staticHeaders: [{ name: 'Partner-Id', source: 'deployment' }],
  tokenPlacement: 'bearer_header',
};
