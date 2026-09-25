import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';

import { himedAuth } from './auth';
import { createHimedClient } from './client';
import { himedManifest } from './manifest';
import { buildHimedTools } from './tools';

export interface HimedProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Base URL override — production Demográficos by default. */
  readonly baseUrl?: string;
}

/** Factory with DI. HiMed Demográficos has no OAuth scope model and no call context. */
export function createHimedProvider(deps: HimedProviderDeps = {}): IProvider {
  const client = createHimedClient(deps.baseUrl ? { baseUrl: deps.baseUrl } : {});
  return createProvider({
    manifest: himedManifest,
    auth: himedAuth,
    tools: buildHimedTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const himedProvider = createHimedProvider();
