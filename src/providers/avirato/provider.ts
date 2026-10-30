import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { aviratoAuth } from './auth';
import { createAviratoClient } from './client';
import { aviratoContext } from './context';
import { aviratoManifest } from './manifest';
import { buildAviratoTools } from './tools';

export interface AviratoProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Base URL override — the production API v3 by default; the sandbox for contract QA. */
  readonly baseUrl?: string;
}

/**
 * Factory with DI. `metadataSchema: aviratoContext` declares the required `web_code` call context
 * (published as `contextSchema`). The minted JWT arrives already resolved (the `reference` path); the core
 * materializer adds `Authorization: Bearer`.
 */
export function createAviratoProvider(deps: AviratoProviderDeps = {}): IProvider {
  const client = createAviratoClient(deps.baseUrl ? { baseUrl: deps.baseUrl } : {});
  return createProvider({
    manifest: aviratoManifest,
    auth: aviratoAuth,
    metadataSchema: aviratoContext,
    tools: buildAviratoTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const aviratoProvider = createAviratoProvider();
