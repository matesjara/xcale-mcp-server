import type { Details } from './schemas';

export interface BookingLinkArgs {
  readonly locale: string;
  readonly hotelKey: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly childrenAges: readonly number[];
  readonly currency: string;
  readonly RoomID: number;
  readonly details: Details;
}

/**
 * The booking-engine page for the quoted room with the stay already filled in (contract §A.8, Observed
 * in the browser 2026-10-14): `/pricelist/rooms/{RoomID}` opens that room with its rates expanded and
 * its "book now" button, for the dates and party in the query. The guest pays there. Built from a fixed
 * origin — never from the connection's URL.
 *
 * Observed dead ends, so nobody re-adds them: `room-id`/`offer-id` query params are accepted but
 * pre-select nothing, and there is no way to pre-select a rate — the room page lists them all.
 *
 * Children depend on the hotel's picker: the classic one (`enabledNewChildrenOccupancyPicker: false`,
 * La Pausa) takes `r1_child{minAge}-{maxAge}={count}` per child age band (verified: "2 adultos • 1
 * niño"); the new one takes `r1_children_age={a},{b}` (Inferred from the engine bundle).
 */
export function buildBookingUrl(a: BookingLinkArgs): string {
  const params: [string, string][] = [
    ['check-in', a.checkIn],
    ['check-out', a.checkOut],
    ['r1_adults', String(a.adults)],
    ...childrenParams(a.details, a.childrenAges),
    ['currency', a.currency],
  ];
  const qs = new URLSearchParams(params).toString();
  return `https://booking.profitroom.com/${a.locale}/${encodeURIComponent(a.hotelKey)}/pricelist/rooms/${a.RoomID}?${qs}`;
}

function childrenParams(details: Details, ages: readonly number[]): [string, string][] {
  if (ages.length === 0) return [];
  if (details.enabledNewChildrenOccupancyPicker) {
    return [['r1_children_age', ages.join(',')]];
  }
  // Ages were already checked to sit inside the hotel's child band (`personTypes` C) — one band.
  const band = details.personTypes.find((p) => p.type === 'C');
  if (band === undefined || band.maxAge === null) {
    // Never a link for a party the hotel cannot encode: fail rather than invent a band.
    throw new Error('buildBookingUrl: children given but the hotel prices no child band');
  }
  return [[`r1_child${band.minAge ?? 0}-${band.maxAge}`, String(ages.length)]];
}
