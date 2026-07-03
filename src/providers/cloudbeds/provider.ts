import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { cloudbedsAuth } from './auth';
import { createCloudbedsClient } from './client';
import { cloudbedsContext } from './context';
import { cloudbedsManifest } from './manifest';
import { buildCloudbedsTools } from './tools';

export interface CloudbedsProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  readonly baseUrl?: string;
}

/** Factory with DI (inject `fetchImpl` in tests; default = real Cloudbeds API). */
export function createCloudbedsProvider(deps: CloudbedsProviderDeps = {}): IProvider {
  const client = createCloudbedsClient(deps.baseUrl ? { baseUrl: deps.baseUrl } : {});
  return createProvider({
    manifest: cloudbedsManifest,
    auth: cloudbedsAuth,
    metadataSchema: cloudbedsContext,
    tools: buildCloudbedsTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const cloudbedsProvider = createCloudbedsProvider();
