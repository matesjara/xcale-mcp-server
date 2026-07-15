import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { deriveOAuthScopes } from '../../core/scopes';
import { cloudbedsAuthBase } from './auth';
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
  const tools = buildCloudbedsTools(client);
  return createProvider({
    manifest: cloudbedsManifest,
    // The published scopes are DERIVED from the tools, never hand-written: a tool is the only thing
    // that can need a scope, so the tools are the only honest source. See `core/scopes.ts`.
    auth: deriveOAuthScopes(cloudbedsAuthBase, tools),
    metadataSchema: cloudbedsContext,
    tools,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const cloudbedsProvider = createCloudbedsProvider();
