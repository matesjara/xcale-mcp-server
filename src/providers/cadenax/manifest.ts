import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'cadenax';

/**
 * Cadenax — Cofinet's coffee-trading management backend (lots, reservations, contracts, delivery
 * orders, clients), one book per office. See `docs/design/cadenax-provider/`.
 *
 * One tool, `whoami`, is both declarations below, for the reason Cloudbeds' `list_properties` is:
 * the probe runs BEFORE the connection exists, so it must be the one read that needs no context.
 *
 * - `connectionProbe`: Cadenax's own key-identity endpoint (`GET /auth/me`) — one cheap call with no
 *   side effect that proves a pasted key is live.
 * - `contextDiscovery`: the same answer names the office the key is scoped to, so the office is
 *   discovered and never pasted. A key is connected only when it reaches exactly ONE office (the
 *   tool refuses any other count — `tools.ts`), which is what makes `assignedOffices.0.code` the
 *   whole answer and not an arbitrary pick.
 *
 * No `logoUrl` yet: this server publishes a provider's own mark, and Cadenax's has not been supplied.
 */
export const cadenaxManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Cadenax',
  category: 'trading',
  schemaVersion: '2026-11-23',
  providerVersion: '0.1.0',
  capabilities: { webhooks: false, polling: true, pagination: true },
  contextDiscovery: {
    key: 'office',
    tool: `mcp_${SLUG}_whoami`,
    resultPath: 'assignedOffices.0.code',
  },
  connectionProbe: { tool: `mcp_${SLUG}_whoami` },
};
