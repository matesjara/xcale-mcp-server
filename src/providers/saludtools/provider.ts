import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { saludtoolsAuth } from './auth';
import { createSaludtoolsClient } from './client';
import { saludtoolsManifest } from './manifest';
import { buildSaludtoolsTools } from './tools';

export interface SaludtoolsProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /**
   * Base host override — production SaludTools by default. A non-production deployment points this at
   * `https://saludtools.qa.carecloud.com.co`, and the tests point it at a local double.
   */
  readonly baseUrl?: string;
}

/**
 * Factory with DI. No `metadataSchema`: SaludTools takes no per-call routing context — a site travels
 * as an explicit `clinic` argument on the tools that need one (`manifest.ts`, Q7).
 *
 * The minted JWT arrives already resolved (the `reference` path) and the core materializer adds the
 * `Bearer` header; this client only shapes the request. No credential passes through this file.
 */
export function createSaludtoolsProvider(deps: SaludtoolsProviderDeps = {}): IProvider {
  const client = createSaludtoolsClient({
    ...(deps.baseUrl ? { baseUrl: deps.baseUrl } : {}),
  });
  return createProvider({
    manifest: saludtoolsManifest,
    auth: saludtoolsAuth,
    tools: buildSaludtoolsTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const saludtoolsProvider = createSaludtoolsProvider();
