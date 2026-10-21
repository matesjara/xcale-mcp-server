import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { erbonAuth } from './auth';
import { createErbonClient } from './client';
import { erbonContext } from './context';
import { erbonManifest } from './manifest';
import { buildErbonTools } from './tools';

export interface ErbonProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Base URL override — production Erbon API by default. */
  readonly baseUrl?: string;
}

/**
 * Factory with DI. `metadataSchema: erbonContext` declares the required `hotelID` call context
 * (published as `contextSchema`). The minted JWT arrives already resolved (the `reference` path); the
 * core materializer adds `Authorization: bearer`. No `deriveOAuthScopes` — Erbon has no scope model.
 */
export function createErbonProvider(deps: ErbonProviderDeps = {}): IProvider {
  const client = createErbonClient(deps.baseUrl ? { baseUrl: deps.baseUrl } : {});
  return createProvider({
    manifest: erbonManifest,
    auth: erbonAuth,
    metadataSchema: erbonContext,
    tools: buildErbonTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const erbonProvider = createErbonProvider();
