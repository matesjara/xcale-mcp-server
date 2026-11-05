import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Avirato authenticates by CREDENTIAL EXCHANGE (Siigo/Erbon-class): the hotel's API user — a user with
 * "Usuario API" on, created in its Avirato back-office — POSTs `{ email, password }` to `/v3/token/login`,
 * which mints a Bearer JWT. Rail A (the Credential Authority) runs this mint generically from this
 * declarative descriptor; the durable secret never reaches this server, only the minted JWT does, via the
 * `reference` resolution path.
 *
 * Observed against production on 2026-10-30 (`docs/design/avirato-provider/api-contract.md` §A.2):
 * - the login answers `201 { status, data: { token, web_codes } }` — the token one level down, hence the
 *   dotted path `data.token` (ADR `credential-exchange-response-path-and-token-ttl`);
 * - there is NO expiry in the body (although Avirato's OpenAPI marks one required) and the JWT carries no
 *   `exp`, so the lifetime is DECLARED: `tokenTtlSeconds: 900`, reused 15 minutes, then minted again;
 * - a second login invalidates the first token, so the consumer mints single-flight per connection, and a
 *   connection's API user is never shared with a person testing or another environment.
 *
 * The wire name `password` is a non-secret field NAME (ADR `0020-authdescriptor-field-names-are-non-secret`).
 */
export const aviratoAuth: ProviderAuthDescriptor = {
  type: 'credential_exchange',
  credentialDelivery: 'reference',
  tokenEndpoint: 'https://apiv3.avirato.com/v3/token/login',
  method: 'POST',
  bodyFields: { email: 'email', password: 'password' },
  responseFields: { token: 'data.token' },
  tokenTtlSeconds: 900,
  tokenPlacement: 'bearer_header',
};
