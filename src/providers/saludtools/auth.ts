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
 * ## `responseFields.expiry` is ABSENT, and that is a decision — not an omission
 *
 * The documented mint response is `{"access_token": "<JWT>"}` and nothing else. The portal says the
 * token expires; the JWT's own `exp` claim carries when. But this descriptor is **strictly
 * declarative** by ADR 0010 — it reads a named JSON field, it does not parse a token — so there is no
 * honest value to put here until a real mint response is seen (Q2).
 *
 * The consequence is bounded and safe: with no declared expiry, Rail A has no lifetime to cache
 * against, so a stale token surfaces as a 401 on the next data call, which `errors.ts` maps to
 * `PROVIDER_AUTH_EXPIRED` and the consumer answers by re-resolving. One wasted call per expiry
 * window. The alternative — teaching the descriptor to read a token's `exp` — widens a shared
 * contract and would need its own ADR; it is not worth it to save that one call.
 *
 * **If the real response turns out to carry an `expires_in`, add it here and nowhere else.**
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
  responseFields: { token: 'access_token' },
  tokenPlacement: 'bearer_header',
};
