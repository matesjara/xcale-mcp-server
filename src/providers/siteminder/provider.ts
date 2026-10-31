import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { siteminderAuth } from './auth';
import { createSiteminderClient } from './client';
import { siteminderContext } from './context';
import { siteminderManifest } from './manifest';
import { buildSiteminderTools } from './tools';

export interface SiteminderProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Base URL override — production by default; SiteMinder documents no sandbox for this API. */
  readonly baseUrl?: string;
}

/** Factory with DI. No scopes: an api_key provider, and the key's reach is set by the property. */
export function createSiteminderProvider(deps: SiteminderProviderDeps = {}): IProvider {
  const client = createSiteminderClient(deps.baseUrl ? { baseUrl: deps.baseUrl } : {});
  return createProvider({
    manifest: siteminderManifest,
    auth: siteminderAuth,
    metadataSchema: siteminderContext,
    tools: buildSiteminderTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const siteminderProvider = createSiteminderProvider();
