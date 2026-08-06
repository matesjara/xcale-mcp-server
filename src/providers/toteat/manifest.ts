import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'toteat';

/**
 * Toteat — a restaurant POS used across LatAm.
 *
 * `connectionProbe` is what lets a consumer validate a pasted credential without knowing anything
 * about Toteat: it names a cheap, no-argument tool to call. It is also the primitive the consumer's
 * re-auth policy leans on, because this provider's "Not Authorized" is ambiguous (see `errors.ts`) —
 * a second call is the only way to tell a dead token from a route the venue has not enabled, and a
 * stateless adapter cannot make that call itself.
 *
 * Strictly declarative — a tool name, never a hook or an expression. Same discipline as
 * `contextDiscovery`, which Toteat does not use: its context is pasted by the owner, not discovered
 * (there is no endpoint that lists a token's restaurants and venues).
 */
export const toteatManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Toteat',
  category: 'restaurant-pos',
  schemaVersion: '2026-08-05',
  providerVersion: '0.1.0',
  logoUrl: '/assets/toteat.svg',
  capabilities: { webhooks: true },
  connectionProbe: { tool: `mcp_${SLUG}_get_shift_status` },
};
