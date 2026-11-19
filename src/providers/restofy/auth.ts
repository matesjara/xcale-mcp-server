import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * Restofy authenticates by CREDENTIAL EXCHANGE (Avirato-class): the restaurant creates an API key in its
 * panel (Administración › Sistema › API Keys, shown once) and copies its account key (`tenantKey`) from the
 * same page. Rail A (the Credential Authority) POSTs both to `/api/auth/create-api-token`, which mints a
 * Bearer JWT. The durable key never reaches this server, only the minted JWT does, via the `reference`
 * resolution path.
 *
 * Observed 2026-11-18 (`docs/design/restofy-provider/api-contract.md` §A.2):
 * - the mint answers `200 { success, message, data: { accessToken, actorUuid, name } }` — the token one
 *   level down, hence the dotted path `data.accessToken`;
 * - there is no expiry field in the body; the JWT's own `exp` is 7 days after the mint, and there is no
 *   refresh endpoint. The lifetime is DECLARED at one day, well inside the real one and independent of
 *   Restofy's clock;
 * - the restaurant is sealed in the token: no `X-Tenant-Key` on data calls, despite one docs page.
 *
 * The wire names `apiKey` and `tenantKey` are non-secret field NAMES (ADR
 * `0020-authdescriptor-field-names-are-non-secret`).
 */
export const restofyAuth: ProviderAuthDescriptor = {
  type: 'credential_exchange',
  credentialDelivery: 'reference',
  tokenEndpoint: 'https://restofy.pro/api/auth/create-api-token',
  method: 'POST',
  bodyFields: { apiKey: 'apiKey', tenantKey: 'tenantKey' },
  responseFields: { token: 'data.accessToken' },
  tokenTtlSeconds: 86_400,
  tokenPlacement: 'bearer_header',
};
