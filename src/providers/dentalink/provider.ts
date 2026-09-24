import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { dentalinkAuth } from './auth';
import { createDentalinkClient } from './client';
import { dentalinkManifest } from './manifest';
import { buildDentalinkTools } from './tools';

export interface DentalinkProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Base URL override — production Dentalink public API by default. */
  readonly baseUrl?: string;
}

/**
 * Factory with DI. No `metadataSchema`: one Dentalink token authenticates the whole clinic and sees
 * all its branches, so there is no per-call connection context — `id_sucursal` is an explicit tool
 * argument (grill AD-3). The core materializer adds `Authorization: Token <token>` (ADR
 * `api-key-header-scheme-prefix`).
 */
export function createDentalinkProvider(deps: DentalinkProviderDeps = {}): IProvider {
  const client = createDentalinkClient({
    ...(deps.baseUrl ? { baseUrl: deps.baseUrl } : {}),
  });
  return createProvider({
    manifest: dentalinkManifest,
    auth: dentalinkAuth,
    tools: buildDentalinkTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const dentalinkProvider = createDentalinkProvider();
