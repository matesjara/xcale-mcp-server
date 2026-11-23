import { loadConfig } from '../../config';
import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { cadenaxAuth } from './auth';
import { createCadenaxClient } from './client';
import { cadenaxContext } from './context';
import { cadenaxManifest } from './manifest';
import { buildCadenaxTools } from './tools';

export interface CadenaxProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Base URL override — production by default; staging or a local Cadenax in development. */
  readonly baseUrl?: string;
}

/**
 * Factory with DI. `metadataSchema: cadenaxContext` declares the required `office` call context
 * (published as `contextSchema`); the key arrives forwarded and the core sets `X-API-Key`.
 */
export function createCadenaxProvider(deps: CadenaxProviderDeps = {}): IProvider {
  const client = createCadenaxClient(deps.baseUrl ? { baseUrl: deps.baseUrl } : {});
  return createProvider({
    manifest: cadenaxManifest,
    auth: cadenaxAuth,
    metadataSchema: cadenaxContext,
    tools: buildCadenaxTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/**
 * Default instance registered in src/providers/index.ts: production, unless the deployment points it
 * elsewhere with `CADENAX_BASE_URL` (Cadenax pairs environments: a `cof_dev_` key belongs to its
 * development database, never to production).
 */
const { cadenaxBaseUrl } = loadConfig();
export const cadenaxProvider = createCadenaxProvider(
  cadenaxBaseUrl ? { baseUrl: cadenaxBaseUrl } : {},
);
