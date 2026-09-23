export interface Config {
  readonly port: number;
  readonly nodeEnv: string;
  readonly logLevel: string;
  /** Hop-B shared secret. Loaded from Doppler in real envs; never committed. */
  readonly serverSecret: string;
  /**
   * Backend Credential Authority resolve endpoint (`POST …/internal/credentials/resolve`) for the
   * `reference` delivery strategy. Empty = this server does not serve `reference` providers (the
   * resolver is not wired).
   */
  readonly credentialResolveUrl: string;
  /**
   * Secret presented when calling the Credential Authority. Distinct from `serverSecret`, which
   * authenticates the OPPOSITE direction (consumer → this server): one symmetric value guarding
   * both meant a leak in either direction opened both, and the resolve endpoint hands back a
   * usable provider credential.
   *
   * Empty falls back to `serverSecret`, so this server and the backend can be rolled forward
   * independently. The fallback is a migration affordance, not the target state.
   */
  readonly credentialResolveSecret: string;
  /**
   * Siigo's `Partner-Id` header value — xcale's non-secret institutional identifier, required on every
   * Siigo DATA call (Observed B1: `/auth` accepts it optionally, but data endpoints 400 without it).
   * It is deployment config (`source: 'deployment'` in the descriptor), NOT a user credential. The
   * backend applies its own copy on the mint; this server applies its copy on data egress (the
   * materializer does not resolve `staticHeaders`, so the Siigo client attaches it). Empty = Siigo data
   * calls will fail `400 header_required` — a deployment misconfiguration caught at smoke-test.
   */
  readonly siigoPartnerId: string;
  /**
   * SaludTools host override. **OPTIONAL, and absent means production** — which is the whole reason
   * it exists.
   *
   * SaludTools has exactly one production host serving every clinic, and until this field the
   * provider hard-coded it. That meant a dev or staging deployment of this server would have called a
   * real clinic's live records: not a hypothetical, since a tenant's credential reaches us the same
   * way in every environment.
   *
   * Set it to `https://saludtools.qa.carecloud.com.co` in Doppler `dev`/`stg` and leave it unset in
   * `prd`. A DEPLOYMENT value, never per-tenant and never read from the catalog: the same host is
   * pinned in xcale-backend for the mint, and a network-sourced host is precisely the repointing
   * attack that pinning exists to stop.
   *
   * Optional on purpose (`add-provider`, known gaps): a new REQUIRED `Config` field breaks every
   * `Config` literal in the protocol tests.
   */
  readonly saludtoolsBaseUrl?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8080),
    nodeEnv: env.NODE_ENV ?? 'development',
    logLevel: env.LOG_LEVEL ?? 'info',
    serverSecret: env.MCP_SERVER_SECRET ?? '',
    credentialResolveUrl: env.CREDENTIAL_RESOLVE_URL ?? '',
    credentialResolveSecret: env.CREDENTIAL_RESOLVE_SECRET ?? '',
    siigoPartnerId: env.SIIGO_PARTNER_ID ?? '',
    ...(env.SALUDTOOLS_BASE_URL ? { saludtoolsBaseUrl: env.SALUDTOOLS_BASE_URL } : {}),
  };
}
