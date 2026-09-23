import { loadConfig } from '../../config';
import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { mewsAuth } from './auth';
import { createMewsClient } from './client';
import { mewsContext } from './context';
import { mewsManifest } from './manifest';
import { buildMewsTools } from './tools';

export interface MewsProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** API host. Defaults to deployment config (`MEWS_BASE_URL`, production by default). */
  readonly baseUrl?: string;
  /** xcale's partner `ClientToken`. Defaults to deployment config (`MEWS_CLIENT_TOKEN`). */
  readonly clientToken?: string;
  /** The `Client` name sent on every call. Defaults to deployment config (`MEWS_CLIENT_NAME`). */
  readonly clientName?: string;
}

/**
 * Factory with DI. Mews has no scope model (one `AccessToken` = one enterprise, with whatever the
 * hotel's Mews grants the integration), so the descriptor is published as is.
 */
export function createMewsProvider(deps: MewsProviderDeps = {}): IProvider {
  const config = loadConfig();
  const client = createMewsClient({
    baseUrl: deps.baseUrl ?? config.mewsBaseUrl ?? 'https://api.mews.com',
    clientToken: deps.clientToken ?? config.mewsClientToken ?? '',
    clientName: deps.clientName ?? config.mewsClientName ?? 'xcale 1.0.0',
  });
  return createProvider({
    manifest: mewsManifest,
    auth: mewsAuth,
    metadataSchema: mewsContext,
    tools: buildMewsTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const mewsProvider = createMewsProvider();
