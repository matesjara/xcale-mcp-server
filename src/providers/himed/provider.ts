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
  /** Injectable clock for deterministic tests (default: the real time). */
  readonly now?: () => Date;
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
    tools: buildHimedTools(client, deps.now),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/**
 * Default instance registered in src/providers/index.ts. `HIMED_BASE_URL` (Demográficos + directory) and
 * `HIMED_SCHEDULING_BASE_URL` (Autoagendamiento) come from each environment's Doppler config — the
 * sandbox (`demo.medsas.co/...`, `demo-notificaciones.medsas.co/...`) in dev, HiMed's production hosts in
 * prd. There is no fallback: an unset host makes HiMed's tools fail closed (see client.ts), and the
 * server says so at boot instead of at a clinic's first booking. The rest of the server is unaffected.
 */
const missingHosts = ['HIMED_BASE_URL', 'HIMED_SCHEDULING_BASE_URL'].filter((k) => !process.env[k]);
if (missingHosts.length > 0 && process.env.NODE_ENV !== 'test') {
  console.warn(
    `[himed] ${missingHosts.join(', ')} not set — HiMed tools will fail closed until configured.`,
  );
}

export const himedProvider = createHimedProvider({
  ...(process.env.HIMED_BASE_URL ? { baseUrl: process.env.HIMED_BASE_URL } : {}),
  ...(process.env.HIMED_SCHEDULING_BASE_URL
    ? { schedulingBaseUrl: process.env.HIMED_SCHEDULING_BASE_URL }
    : {}),
});
