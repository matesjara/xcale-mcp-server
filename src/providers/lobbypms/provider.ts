import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { lobbypmsAuth } from './auth';
import { createLobbypmsClient } from './client';
import { lobbypmsContext } from './context';
import { lobbypmsManifest } from './manifest';
import { buildLobbypmsTools } from './tools';

export interface LobbypmsProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Base URL override — the production LobbyPMS API by default (there is no sandbox). */
  readonly baseUrl?: string;
}

/**
 * Factory with DI. `metadataSchema` declares the required `propertyId` (account identity, published
 * as `contextSchema`). No `deriveOAuthScopes` — LobbyPMS has no scope model.
 */
export function createLobbypmsProvider(deps: LobbypmsProviderDeps = {}): IProvider {
  const client = createLobbypmsClient(deps.baseUrl ? { baseUrl: deps.baseUrl } : {});
  return createProvider({
    manifest: lobbypmsManifest,
    auth: lobbypmsAuth,
    metadataSchema: lobbypmsContext,
    tools: buildLobbypmsTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const lobbypmsProvider = createLobbypmsProvider();
