import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';

import { himedSchedulingAuth } from './auth';
import { createHimedSchedulingClient } from './client';
import { himedSchedulingContext } from './context';
import { himedSchedulingManifest } from './manifest';
import { buildHimedSchedulingTools } from './tools';

export interface HimedSchedulingProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Base URL override — the Autoagendamiento sandbox by default (production URL set at deploy). */
  readonly baseUrl?: string;
}

export function createHimedSchedulingProvider(deps: HimedSchedulingProviderDeps = {}): IProvider {
  const client = createHimedSchedulingClient(deps.baseUrl ? { baseUrl: deps.baseUrl } : {});
  return createProvider({
    manifest: himedSchedulingManifest,
    auth: himedSchedulingAuth,
    metadataSchema: himedSchedulingContext,
    tools: buildHimedSchedulingTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/**
 * Default instance registered in src/providers/index.ts. `HIMED_SCHEDULING_BASE_URL` lets a deployment
 * point at a non-production Autoagendamiento (the sandbox is
 * `https://demo-notificaciones.medsas.co/notificaciones/envioConsumoAutoagendamiento`) without a code
 * change; absent, the default stands.
 */
export const himedSchedulingProvider = createHimedSchedulingProvider(
  process.env.HIMED_SCHEDULING_BASE_URL
    ? { baseUrl: process.env.HIMED_SCHEDULING_BASE_URL }
    : {}
);
