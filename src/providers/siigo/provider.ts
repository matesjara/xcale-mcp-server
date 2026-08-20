import { loadConfig } from '../../config';
import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { siigoAuth } from './auth';
import { createSiigoClient } from './client';
import { siigoManifest } from './manifest';
import { buildSiigoTools } from './tools';

export interface SiigoProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Base URL override — production Siigo public API by default. */
  readonly baseUrl?: string;
  /**
   * The `Partner-Id` header value. Defaults to deployment config (`SIIGO_PARTNER_ID` via `loadConfig`).
   * Tests inject it directly. No `contextSchema` — Siigo takes no per-call context.
   */
  readonly partnerId?: string;
}

/**
 * Factory with DI. No `metadataSchema`: one Siigo credential = one company (Observed B1), so there is
 * no per-call context to declare. The minted JWT arrives already resolved (the `reference` path); the
 * client attaches only the non-secret `Partner-Id`, and the core materializer adds `Bearer`.
 */
export function createSiigoProvider(deps: SiigoProviderDeps = {}): IProvider {
  const partnerId = deps.partnerId ?? loadConfig().siigoPartnerId;
  const client = createSiigoClient({
    partnerId,
    ...(deps.baseUrl ? { baseUrl: deps.baseUrl } : {}),
  });
  return createProvider({
    manifest: siigoManifest,
    auth: siigoAuth,
    tools: buildSiigoTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const siigoProvider = createSiigoProvider();
