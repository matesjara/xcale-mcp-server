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
  // The house tile (black, rx 6, the mark in white), traced from Erbon's own chevron.
  logoUrl: `/assets/${SLUG}.svg`,
  // `providerVersion` 0.3.1 (2026-10-26, for traceability): `list_currencies` (#137) is a backend-only read,
  // withdrawn from `tools/list`, so the published contract did not move and `schemaVersion` stays.
  // 0.4.0 (xcale-backend#1859): `find_guest_bookings` is a new published tool, a record lookup in the
  // vocabulary of ADR 0023 (Own Records), so the published contract moves.
  schemaVersion: '2026-10-27',
  providerVersion: '0.4.0',
};
