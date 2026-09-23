import { loadConfig } from '../../config';
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
   * Base host override. Defaults to deployment config (`SALUDTOOLS_BASE_URL`), and to production when
   * that is unset. A non-production deployment points it at `https://saludtools.qa.carecloud.com.co`;
   * the tests point it at a local double.
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
  // Deployment config decides the host, so a dev or staging deployment does not call a live clinic.
  // Absent everywhere = production, which is the only host that serves real tenants.
  const baseUrl = deps.baseUrl ?? loadConfig().saludtoolsBaseUrl;
  const client = createSaludtoolsClient({
    ...(baseUrl ? { baseUrl } : {}),
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
