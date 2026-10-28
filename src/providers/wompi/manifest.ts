import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'wompi';

/**
 * Wompi — Bancolombia's payment gateway (Colombia, COP).
 *
 * A consumer uses this provider to create single-use payment links, deactivate them, and read the
 * transactions that paid them. None of its tools is for an agent (all are `controlPlane`): an agent
 * asks for a payment through the consumer's own guarded tools, which apply its limits.
 *
 * `connectionProbe` validates a pasted private key with a lookup that creates nothing and returns
 * nothing personal (see `tools.ts`). `accountContextKeys` is the public key: it names the merchant
 * account in one environment, so a sandbox and a production key pair are two accounts — which they
 * are, on Wompi's side too.
 */
export const wompiManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Wompi',
  category: 'payment-gateway',
  schemaVersion: '2026-10-22',
  providerVersion: '0.1.0',
  logoUrl: '/assets/wompi.svg',
  connectionProbe: { tool: `mcp_${SLUG}_check_credentials` },
  accountContextKeys: ['publicKey'],
};
