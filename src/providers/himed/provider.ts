import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';

import { himedAuth } from './auth';
import { createHimedClient } from './client';
import { himedContext } from './context';
import { himedManifest } from './manifest';
import { buildHimedTools } from './tools';

export interface HimedProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Demográficos + directory base URL (`m.medsas.co/.../Controllers`) override. */
  readonly baseUrl?: string;
  /** Autoagendamiento endpoint URL override. */
  readonly schedulingBaseUrl?: string;
}

/** Factory with DI. Multi-credential provider; `codigo_servicio` is its call context. */
export function createHimedProvider(deps: HimedProviderDeps = {}): IProvider {
  const client = createHimedClient({
    ...(deps.baseUrl ? { baseUrl: deps.baseUrl } : {}),
    ...(deps.schedulingBaseUrl ? { schedulingBaseUrl: deps.schedulingBaseUrl } : {}),
  });
  return createProvider({
    manifest: himedManifest,
    auth: himedAuth,
    metadataSchema: himedContext,
    tools: buildHimedTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/**
 * Default instance registered in src/providers/index.ts. `HIMED_BASE_URL` (Demográficos + directory) and
 * `HIMED_SCHEDULING_BASE_URL` (Autoagendamiento) let a deployment point at the sandbox
 * (`demo.medsas.co/...` and `demo-notificaciones.medsas.co/...`) without a code change; absent, the
 * production defaults stand.
 */
export const himedProvider = createHimedProvider({
  ...(process.env.HIMED_BASE_URL ? { baseUrl: process.env.HIMED_BASE_URL } : {}),
  ...(process.env.HIMED_SCHEDULING_BASE_URL
    ? { schedulingBaseUrl: process.env.HIMED_SCHEDULING_BASE_URL }
    : {}),
});
