import { loadConfig } from '../../config';
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
 * Default instance registered in src/providers/index.ts. The two hosts are deployment config
 * (`loadConfig`: `HIMED_BASE_URL` for Demográficos + directory, `HIMED_SCHEDULING_BASE_URL` for
 * Autoagendamiento) — the sandbox (`demo.medsas.co/...`, `demo-notificaciones.medsas.co/...`) in dev,
 * HiMed's production hosts in prd. There is no fallback: an unset host makes HiMed's tools fail closed
 * (see client.ts), and the server says so at boot instead of at a clinic's first booking. The rest of
 * the server is unaffected.
 */
const { himedBaseUrl, himedSchedulingBaseUrl, nodeEnv } = loadConfig();
const missingHosts = [
  ['HIMED_BASE_URL', himedBaseUrl],
  ['HIMED_SCHEDULING_BASE_URL', himedSchedulingBaseUrl],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missingHosts.length > 0 && nodeEnv !== 'test') {
  console.warn(
    `[himed] ${missingHosts.join(', ')} not set — HiMed tools will fail closed until configured.`,
  );
}

export const himedProvider = createHimedProvider({
  ...(himedBaseUrl ? { baseUrl: himedBaseUrl } : {}),
  ...(himedSchedulingBaseUrl ? { schedulingBaseUrl: himedSchedulingBaseUrl } : {}),
});
