import { createProvider } from '../../core/provider-factory';
import type { IProvider } from '../../core/provider-port';
import { echoAuth } from './auth';
import { echoManifest } from './manifest';
import { echoTools } from './tools';

/** Factory (DI-ready: future deps like clock/ids/retry/logger inject here). */
export function createEchoProvider(): IProvider {
  return createProvider({
    manifest: echoManifest,
    auth: echoAuth,
    tools: echoTools,
  });
}

/** Default instance registered in src/providers/index.ts. */
export const echoProvider = createEchoProvider();
