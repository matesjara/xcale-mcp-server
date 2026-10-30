import { loadConfig } from '../../config';
import { ProviderErrorCode } from '../../core/errors';
import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { hotelsyncAuth } from './auth';
import { createHotelSyncClient, type HotelSyncClient } from './client';
import { hotelsyncContext } from './context';
import { hotelsyncManifest } from './manifest';
import { buildHotelSyncTools } from './tools';

export interface HotelSyncProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** `https://app.hotelsync.com` (default) or `https://beta.hotelsync.com` — nothing else. */
  readonly baseUrl?: string;
}

/**
 * A client whose every call fails closed: what the provider runs on when the configured host is not an
 * allowed HotelSync host. The session never leaves this server; the agent gets a typed error.
 */
const failClosedClient: HotelSyncClient = {
  post: async () => ({
    ok: false,
    status: 0,
    errorCode: ProviderErrorCode.PROVIDER_ERROR,
    body: 'HotelSync host is not configured to an allowed host',
  }),
};

/**
 * Factory with DI. `metadataSchema: hotelsyncContext` declares the required `id_properties` call context.
 * The session key and the partner token arrive already resolved (the `reference` path); the core places
 * them in the body. A base URL outside the allowlist throws here, at construction.
 */
export function createHotelSyncProvider(deps: HotelSyncProviderDeps = {}): IProvider {
  const client = createHotelSyncClient(deps.baseUrl ? { baseUrl: deps.baseUrl } : {});
  return buildProvider(client, deps.fetchImpl);
}

function buildProvider(client: HotelSyncClient, fetchImpl?: FetchLike): IProvider {
  return createProvider({
    manifest: hotelsyncManifest,
    auth: hotelsyncAuth,
    metadataSchema: hotelsyncContext,
    tools: buildHotelSyncTools(client),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

/**
 * The deployment's HotelSync host (`HOTELSYNC_BASE_URL`): staging in dev, production in prd; production when
 * unset. A host outside the allowlist does not stop the server: HotelSync's tools fail closed and the server
 * says so at boot.
 */
function defaultProvider(): IProvider {
  const { hotelsyncBaseUrl, nodeEnv } = loadConfig();
  try {
    return createHotelSyncProvider(hotelsyncBaseUrl ? { baseUrl: hotelsyncBaseUrl } : {});
  } catch {
    if (nodeEnv !== 'test') {
      console.warn(
        '[hotelsync] HOTELSYNC_BASE_URL is not an allowed HotelSync host — HotelSync tools will fail closed.',
      );
    }
    return buildProvider(failClosedClient);
  }
}

/** Default instance registered in src/providers/index.ts. */
export const hotelsyncProvider = defaultProvider();
