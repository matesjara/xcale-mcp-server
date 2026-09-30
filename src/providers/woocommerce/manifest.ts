import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'woocommerce';

/**
 * WooCommerce — the WordPress e-commerce platform. Self-hosted, so each store is its own domain
 * (see `context.ts`: `storeUrl` is both the account identity and the base URL).
 *
 * `connectionProbe` names a cheap, no-argument tool a consumer can call to validate a pasted
 * credential generically. `accountContextKeys: ['storeUrl']` lets a consumer key its connection on
 * the store, so one owner can connect several stores as distinct accounts.
 */
export const woocommerceManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'WooCommerce',
  category: 'ecommerce',
  logoUrl: `/assets/${SLUG}.webp`,
  schemaVersion: '2026-09-18',
  providerVersion: '0.2.0',
  connectionProbe: { tool: `mcp_${SLUG}_list_products` },
  accountContextKeys: ['storeUrl'],
};
