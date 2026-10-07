import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'erbon';

/**
 * Erbon — a LATAM hotel PMS. The agent's menu holds the hotel catalog reads (hotel, room types, rates,
 * availability); the money, guest and booking tools — including the booking write, live since
 * 2026-09-28 — are backend-only (`controlPlane`). See `docs/design/erbon-read-only-provider/` and
 * `docs/design/erbon-booking/`.
 *
 * No `connectionProbe`: like Siigo, a `credential_exchange` provider proves its credential by MINTING
 * once at connect (a mint-200 is the fail-closed gate) — there is no cheap no-argument Erbon read to
 * act as a probe (every read needs a `hotelID`).
 *
 * No `contextDiscovery`: Erbon exposes no endpoint that lists a credential's hotels (Observed —
 * `sandbox-evidence.md` §2), so the `hotelID` is pasted at connect, not auto-resolved.
 *
 * No `accountContextKeys`: the default (every required context key) is already `hotelID`, which IS the
 * connection identity here — the credential is account-scoped and the hotel is named per call (the JWT
 * carries an account GUID, not the hotelID). Same shape as Cloudbeds `propertyID`.
 */
export const erbonManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Erbon',
  category: 'hospitality',
  logoUrl: `/assets/${SLUG}.webp`,
  schemaVersion: '2026-10-06',
  providerVersion: '0.3.0',
};
