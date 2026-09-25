import { createProvider } from '../../core/provider-factory';
import type { FetchLike } from '../../core/http';
import type { IProvider } from '../../core/provider-port';
import { woocommerceAuth } from './auth';
import { createWoocommerceClient } from './client';
import { woocommerceContext } from './context';
import { woocommerceManifest } from './manifest';
import { createSafeFetch } from './safe-egress';
import { buildWoocommerceTools } from './tools';

export interface WoocommerceProviderDeps {
  /** Injectable transport for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
}

/**
 * Factory with DI. No scope model (api_key/basic providers have none): which endpoints a key may
 * reach is a per-store permission on the WooCommerce key itself (Read vs Read/Write), invisible to
 * the API and surfaced only by a refusal (mapped to `PROVIDER_AUTH_EXPIRED`).
 */
export function createWoocommerceProvider(deps: WoocommerceProviderDeps = {}): IProvider {
  const client = createWoocommerceClient();
  // The tenant supplies `storeUrl`, so the gateway must not fetch it blindly. Default to an
  // SSRF-safe transport (https-only + DNS/blocklist per call); tests inject their own fetch.
  const fetchImpl = deps.fetchImpl ?? createSafeFetch();
  return createProvider({
    manifest: woocommerceManifest,
    auth: woocommerceAuth,
    metadataSchema: woocommerceContext,
    tools: buildWoocommerceTools(client),
    fetchImpl,
  });
}

/** Default instance registered in src/providers/index.ts. */
export const woocommerceProvider = createWoocommerceProvider();
