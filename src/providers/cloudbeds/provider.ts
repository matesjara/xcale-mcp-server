import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { cloudbedsAuth } from './auth';
import { type CloudbedsClientDeps, createCloudbedsClient } from './client';
import { cloudbedsContext } from './context';
import { cloudbedsManifest } from './manifest';
import { buildCloudbedsTools } from './tools';

/** Factory with DI (inject `fetchImpl` in tests; default = real Cloudbeds API). */
export function createCloudbedsProvider(deps: CloudbedsClientDeps = {}): IProvider {
  const client = createCloudbedsClient(deps);
  return createProvider({
    manifest: cloudbedsManifest,
    auth: cloudbedsAuth,
    metadataSchema: cloudbedsContext,
    tools: buildCloudbedsTools(client),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const cloudbedsProvider = createCloudbedsProvider();
