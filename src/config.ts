export interface Config {
  readonly port: number;
  readonly nodeEnv: string;
  readonly logLevel: string;
  /** Hop-B shared secret. Loaded from Doppler in real envs; never committed. */
  readonly serverSecret: string;
  /**
   * Backend Credential Authority resolve endpoint (`POST …/internal/credentials/resolve`) for the
   * `reference` delivery strategy. Empty = this server does not serve `reference` providers (the
   * resolver is not wired). The Hop-B outbound secret reuses `serverSecret` (symmetric shared secret).
   */
  readonly credentialResolveUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8080),
    nodeEnv: env.NODE_ENV ?? 'development',
    logLevel: env.LOG_LEVEL ?? 'info',
    serverSecret: env.MCP_SERVER_SECRET ?? '',
    credentialResolveUrl: env.CREDENTIAL_RESOLVE_URL ?? '',
  };
}
