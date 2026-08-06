import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { toteatAuth } from './auth';
import { createToteatClient } from './client';
import { toteatContext } from './context';
import { toteatManifest } from './manifest';
import { buildToteatTools } from './tools';

export interface ToteatProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Base URL override — production by default; `apidev.toteat.com` for the dev environment. */
  readonly baseUrl?: string;
}

/**
 * Factory with DI. No `deriveOAuthScopes` here, unlike Cloudbeds: Toteat has no scope model at all.
 * Which endpoints a token may reach is a per-venue allow-list configured in the POS, invisible to
 * the API and discoverable only by calling and being refused — see `errors.ts`.
 */
export function createToteatProvider(deps: ToteatProviderDeps = {}): IProvider {
  const client = createToteatClient(deps.baseUrl ? { baseUrl: deps.baseUrl } : {});
  return createProvider({
    manifest: toteatManifest,
    auth: toteatAuth,
    metadataSchema: toteatContext,
    tools: buildToteatTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const toteatProvider = createToteatProvider();
