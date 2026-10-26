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
  // The house tile (black, rx 6, the mark in white), traced from WooCommerce's own wordmark.
  logoUrl: `/assets/${SLUG}.svg`,
  // Bumped 2026-10-26 for #166, #167 and #168 together: `get_product` returns `shortDescription`,
  // `create_order` takes the amount each line charges, and `price_cart` is a new tool. All additive: no
  // tool removed, no existing input or result field changed.
  schemaVersion: '2026-10-26',
  providerVersion: '0.5.0',
  connectionProbe: { tool: `mcp_${SLUG}_list_products` },
  accountContextKeys: ['storeUrl'],
};
