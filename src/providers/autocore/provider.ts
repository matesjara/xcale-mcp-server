import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { autocoreAuth } from './auth';
import { createAutocoreClient, type AutocoreClientDeps } from './client';
import { autocoreContext } from './context';
import { autocoreManifest } from './manifest';
import { buildAutocoreTools } from './tools';

export interface AutocoreProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Tests only: point both environments somewhere else. */
  readonly baseUrls?: AutocoreClientDeps['baseUrls'];
  /** Tests only: a fixed clock, so the `Auth-Token` the core builds is deterministic. */
  readonly clock?: () => number;
}

/**
 * Factory with DI. No deployment-level base URL: one deployment serves Staging and Production
 * tenants, so the client picks the host per call from the connection's `environment`.
 */
export function createAutocoreProvider(deps: AutocoreProviderDeps = {}): IProvider {
  const client = createAutocoreClient(deps.baseUrls ? { baseUrls: deps.baseUrls } : {});
  return createProvider({
    manifest: autocoreManifest,
    auth: autocoreAuth,
    metadataSchema: autocoreContext,
    tools: buildAutocoreTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const autocoreProvider = createAutocoreProvider();
