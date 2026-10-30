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
  // Bumped 2026-10-24: six published tools now carry an `identityPolicy` in `tools/list`, and the four
  // that name one record say which id space it lives in (`recordOwnershipKind`). No tool was added or
  // removed and no input schema moved; a consumer that reads the field can now tell an order or
  // customer read from a catalog read.
  // Bumped 2026-10-27 (xcale-backend#1859): `find_customer_orders` is a new published tool, a record
  // lookup in the vocabulary of ADR 0023 (Own Records).
  schemaVersion: '2026-10-27',
  providerVersion: '0.5.0',
  connectionProbe: { tool: `mcp_${SLUG}_list_products` },
  accountContextKeys: ['storeUrl'],
};
