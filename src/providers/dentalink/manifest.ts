import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'dentalink';

/**
 * Dentalink — a dental-clinic management platform (HealthAtom) used across LatAm.
 *
 * `connectionProbe` is what lets a consumer validate a pasted token without knowing anything about
 * Dentalink: it names a cheap, no-argument read (`list_branches` → `GET /sucursales`). A success means
 * the token is real and has read scope. Write scope is NOT probed — a test booking would dirty the real
 * agenda; it is covered by the consumer's connect-form permission copy and a loud error on the first
 * booking (feature-design AD-4/AD-7, api-contract §1.1).
 *
 * No `contextSchema` / `accountContextKeys`: one token authenticates the whole clinic and sees all its
 * branches, so `id_sucursal` travels as an explicit per-call tool argument, not connection context nor
 * account identity (grill AD-3). `accountKey` therefore defaults to the slug on the consumer side.
 */
export const dentalinkManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Dentalink',
  category: 'healthcare',
  schemaVersion: '2026-09-24',
  providerVersion: '0.1.0',
  connectionProbe: { tool: `mcp_${SLUG}_list_branches` },
};
