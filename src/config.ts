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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8080),
    nodeEnv: env.NODE_ENV ?? 'development',
    logLevel: env.LOG_LEVEL ?? 'info',
    serverSecret: env.MCP_SERVER_SECRET ?? '',
    credentialResolveUrl: env.CREDENTIAL_RESOLVE_URL ?? '',
    credentialResolveSecret: env.CREDENTIAL_RESOLVE_SECRET ?? '',
  };
}
