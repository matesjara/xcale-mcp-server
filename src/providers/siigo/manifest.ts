import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'siigo';

/**
 * Siigo — Colombian accounting / electronic-invoicing platform. The FIRST `reference`-strategy
 * provider (a durable `username`+`access_key` mints a 24h JWT; see `auth.ts`).
 *
 * No `connectionProbe`: a `credential_exchange` provider proves its credential by MINTING once at
 * connect (a mint-200 is the fail-closed gate — Observed B1: `POST /auth` returns a usable token or a
 * 401). There is no cheap no-argument Siigo read tool acting as a probe, and none is needed — routing
 * Siigo through the generic `connectionProbe`/`buildCredentialConfig` path would forward the pasted
 * secret as a bearer token (which Siigo rejects) instead of minting.
 *
 * No `contextSchema` / `accountContextKeys` / `contextDiscovery`: Observed B1 — one Siigo credential
 * authenticates to exactly one company/NIT (the `/auth` token carries no company list; no data
 * endpoint accepts a `companyId`/NIT selector). Multiple companies = multiple connections in Rail A,
 * never per-call context. If Siigo ever exposes a company dimension, the fix stays inside this module.
 */
export const siigoManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Siigo',
  category: 'accounting',
  schemaVersion: '2026-08-13.2',
  providerVersion: '0.3.0',
  capabilities: { pagination: true },
};
