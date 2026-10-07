import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Erbon authenticates by CREDENTIAL EXCHANGE (Siigo-class): a durable `username`+`password` is POSTed
 * to `/auth/login`, which mints a short-lived Bearer JWT. Rail A (the Credential Authority) runs this
 * mint generically from this declarative descriptor; the durable secret never reaches this server —
 * only the minted JWT does, via the `reference` resolution path (AD-3, `grill-notes.md`).
 *
 * Every value is Observed against the Erbon sandbox (2026-09-26/28 — see `sandbox-evidence.md` §1).
 *
 * `bodyFields` maps LOGICAL credential keys → Erbon's WIRE field names (used verbatim). The wire name
 * for the secret is literally `password` — dictated by Erbon's API (`{"username","password"}`) — which
 * is a non-secret field NAME, not the credential value. That the published catalog contains this name
 * is intentional and safe; see ADR `0020-authdescriptor-field-names-are-non-secret.md`.
 *
 * `responseFields.expiry` is `expirationUTCDate`, an ABSOLUTE UTC datetime (not `expires_in` seconds).
 * Parsing it is Rail A's concern (deferred to the backend grill); this server, on the `reference` path,
 * only receives the already-minted JWT.
 */
export const erbonAuth: ProviderAuthDescriptor = {
  type: 'credential_exchange',
  credentialDelivery: 'reference',
  tokenEndpoint: 'https://api.erbonsoftware.com/auth/login',
  method: 'POST',
  bodyFields: { username: 'username', password: 'password' },
  responseFields: { token: 'bearerToken', expiry: 'expirationUTCDate' },
  tokenPlacement: 'bearer_header',
};
