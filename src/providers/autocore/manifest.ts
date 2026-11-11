import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'autocore';

/**
 * Autocore Hotels — a payment platform for hotels in Colombia and Costa Rica.
 *
 * A consumer uses this provider to create hosted payment links, cancel them and read what paid them.
 * None of its tools is for an agent (all are `controlPlane`): an agent asks for a payment through the
 * consumer's own guarded tools, which apply its limits.
 *
 * `connectionProbe` proves the keys and that they reach the connection's hotel, creating nothing (see
 * `tools.ts`). `accountContextKeys` are the hotel and the environment: Autocore issues keys per
 * environment, so hotel 5 in Staging and in Production are two accounts.
 */
export const autocoreManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Autocore Hotels',
  category: 'payment-gateway',
  schemaVersion: '2026-11-09',
  providerVersion: '0.1.0',
  // No `logoUrl` yet: Autocore publishes only a PNG, and assets here are .svg or .webp.
  connectionProbe: { tool: `mcp_${SLUG}_check_credentials` },
  accountContextKeys: ['hotelId', 'environment'],
};
