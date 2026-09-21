import type { ProviderAuthDescriptor } from '../../core/provider-port';

/** The production SaludTools host. QA is `saludtools.qa.carecloud.com.co` (see `client.ts`). */
export const SALUDTOOLS_PRODUCTION_BASE_URL = 'https://saludtools.carecloud.com.co';

/** Path of the mint endpoint, shared by the descriptor and the QA override a deployment may set. */
export const SALUDTOOLS_TOKEN_PATH = '/integration/authenticate/apikey/v1/';

/**
 * SaludTools authenticates by CREDENTIAL EXCHANGE: a durable ApiKey — `key` (the literal prefix
 * `STAKOA` plus 24 characters) and `secret`, both minted by the clinic inside its own SaludTools
 * account — is POSTed to the token endpoint, which returns a short-lived JWT. Rail A (the Credential
 * Authority) runs this mint generically from this declarative descriptor; the durable ApiKey never
 * reaches this server, only the minted JWT does, via the `reference` resolution path.
 *
 * ## Why `reference` is not a preference
 *
 * Two independent reasons, either of which would be enough:
 * 1. **The shape demands it.** A durable credential that mints a usable one is exactly the case ADR
 *    0010 was written for. Forwarding would put a reusable token in this server's memory on every call.
 * 2. **ADR 0003's hard gate.** `forwarded` is approved only for non-financial, standard-risk providers.
 *    A provider whose every response is a patient's medical data is not standard-risk under any reading.
 *
 * ## `bodyFields`: logical keys == wire names
 *
 * `bodyFields` maps LOGICAL credential keys → the provider's WIRE field names, and they are kept
 * identical on purpose. The logical keys are a cross-repo contract: xcale-backend's connect flow
 * persists `credentialSecret` as a JSON object keyed by exactly these names, and its mint executor
 * reads them back by logical name. Keeping the two sides equal means they cannot silently diverge —
 * and a golden test across the repos pins it, because a divergence otherwise surfaces only at runtime
 * as `missing credential value for field "X"`.
 *
 * ## `responseFields.expiry` — Observed 2026-09-21
 *
 * The vendor's portal documents the mint response as `{"access_token": "<JWT>"}` and nothing else. It
 * is not. A real mint against production returns
 * `{access_token, expires_in, refresh_token, scope, token_type, jti}` — so `expires_in` is declared
 * here, and Rail A caches against a real lifetime instead of re-minting after every 401.
 *
 * Measured on that response: `exp - iat` is **518400 seconds — 6 days**, far longer than Siigo's 24h.
 * A token this long-lived is worth knowing about: it is why the expiry matters (a 401-driven re-mint
 * would have been rare enough to look like it worked) and it raises the stakes on never logging one.
 *
 * `refresh_token` is deliberately NOT used. This descriptor mints from the durable ApiKey, which Rail
 * A holds anyway, so a refresh flow would add a second credential to custody and buy nothing. It is
 * recorded here because it is undocumented and the next reader will wonder.
 *
 * ## No `staticHeaders`
 *
 * SaludTools has no institutional header (Siigo's `Partner-Id` has no counterpart here): the ApiKey
 * identifies the clinic by itself.
 */
export const saludtoolsAuth: ProviderAuthDescriptor = {
  type: 'credential_exchange',
  credentialDelivery: 'reference',
  tokenEndpoint: `${SALUDTOOLS_PRODUCTION_BASE_URL}${SALUDTOOLS_TOKEN_PATH}`,
  method: 'POST',
  bodyFields: { key: 'key', secret: 'secret' },
  responseFields: { token: 'access_token', expiry: 'expires_in' },
  tokenPlacement: 'bearer_header',
};
