import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';

import { himedDirectoryAuth } from './auth';
import { createHimedDirectoryClient } from './client';
import { himedDirectoryManifest } from './manifest';
import { buildHimedDirectoryTools } from './tools';

export interface HimedDirectoryProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Base URL override — production directory by default. */
  readonly baseUrl?: string;
}

/** Factory with DI. HiMed Directory is read-only, no OAuth scope model and no call context. */
export function createHimedDirectoryProvider(
  deps: HimedDirectoryProviderDeps = {},
): IProvider {
  const client = createHimedDirectoryClient(deps.baseUrl ? { baseUrl: deps.baseUrl } : {});
  return createProvider({
    manifest: himedDirectoryManifest,
    auth: himedDirectoryAuth,
    tools: buildHimedDirectoryTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/**
 * Default instance registered in src/providers/index.ts. `HIMED_DIRECTORY_BASE_URL` lets a deployment
 * point at a non-production directory (the sandbox is
 * `https://demo.medsas.co/interoperabilidad/Api/Controllers`) without a code change; absent, the
 * production default stands.
 */
export const himedDirectoryProvider = createHimedDirectoryProvider(
  process.env.HIMED_DIRECTORY_BASE_URL
    ? { baseUrl: process.env.HIMED_DIRECTORY_BASE_URL }
    : {},
);
