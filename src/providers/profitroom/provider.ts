import type { FetchLike } from '../../core/http';
import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { profitroomAuth } from './auth';
import { createProfitroomClient } from './client';
import { profitroomContext } from './context';
import { profitroomManifest } from './manifest';
import { buildProfitroomTools } from './tools';

export interface ProfitroomProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
  /** Injectable clock for the static-resource cache and "today" checks (default: `Date.now`). */
  readonly now?: () => number;
}

/** Factory with DI. Credential-less: `auth: none`; the hotel rides the `bookingEngineUrl` context. */
export function createProfitroomProvider(deps: ProfitroomProviderDeps = {}): IProvider {
  const now = deps.now ?? Date.now;
  const client = createProfitroomClient({ now });
  return createProvider({
    manifest: profitroomManifest,
    auth: profitroomAuth,
    metadataSchema: profitroomContext,
    tools: buildProfitroomTools(client, now),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Default instance registered in src/providers/index.ts. */
export const profitroomProvider = createProfitroomProvider();
