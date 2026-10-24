import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { wompiAuth } from './auth';
import { createWompiClient, type WompiClientDeps } from './client';
import { wompiContext } from './context';
import { wompiManifest } from './manifest';
import { buildWompiTools } from './tools';

export interface WompiProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Tests only: point both environments somewhere else. */
  readonly baseUrls?: WompiClientDeps['baseUrls'];
}

/**
 * Factory with DI. No deployment-level base URL: one deployment serves sandbox and production
 * tenants, so the client picks the host per call from the public key's prefix (`context.ts`).
 */
export function createWompiProvider(deps: WompiProviderDeps = {}): IProvider {
  const client = createWompiClient(deps.baseUrls ? { baseUrls: deps.baseUrls } : {});
  return createProvider({
    manifest: wompiManifest,
    auth: wompiAuth,
    metadataSchema: wompiContext,
    tools: buildWompiTools(client),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const wompiProvider = createWompiProvider();
