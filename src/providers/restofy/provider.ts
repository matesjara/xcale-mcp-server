import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { restofyAuth } from './auth';
import { createRestofyClient } from './client';
import { restofyManifest } from './manifest';
import { buildRestofyTools } from './tools';

export interface RestofyProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Base URL override; Restofy has one production API, so only tests use it. */
  readonly baseUrl?: string;
}

/**
 * Factory with DI. No `metadataSchema`: the restaurant is sealed in the token. The minted JWT arrives
 * already resolved (the `reference` path); the core materializer adds `Authorization: Bearer`.
 */
export function createRestofyProvider(deps: RestofyProviderDeps = {}): IProvider {
  const client = createRestofyClient(deps.baseUrl ? { baseUrl: deps.baseUrl } : {});
  return createProvider({
    manifest: restofyManifest,
    auth: restofyAuth,
    tools: buildRestofyTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const restofyProvider = createRestofyProvider();
