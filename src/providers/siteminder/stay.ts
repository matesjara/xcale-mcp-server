/**
 * Stay dates and the booking-engine link — the two pieces of SiteMinder knowledge that are not an
 * HTTP call. Pure functions, so the tools stay thin and the rules are tested on their own.
 */

/** SiteMinder: "Availability queries via `/quotes` must not exceed 31 days per request." */
export const MAX_QUOTE_NIGHTS = 31;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export class StayError extends Error {}

/**
 * Nights between two ISO calendar dates, or a `StayError` naming what is wrong. Checked before a
 * request is spent: a rejected call still counts against the key's 100 calls per minute.
 */
export function nightsBetween(checkIn: string, checkOut: string): number {
  if (!ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) {
    throw new StayError('Dates must be ISO calendar dates (YYYY-MM-DD).');
  }
  const from = Date.parse(`${checkIn}T00:00:00Z`);
  const to = Date.parse(`${checkOut}T00:00:00Z`);
  // `Date.parse` rolls 2026-02-30 over to March; a date that does not survive the round trip is not real.
  if (
    Number.isNaN(from) ||
    Number.isNaN(to) ||
    new Date(from).toISOString().slice(0, 10) !== checkIn ||
    new Date(to).toISOString().slice(0, 10) !== checkOut
  ) {
    throw new StayError('Dates must be real calendar dates (YYYY-MM-DD).');
  }
  const nights = Math.round((to - from) / DAY_MS);
  if (nights < 1) {
    throw new StayError('The check-out date must be after the check-in date.');
  }
  return nights;
}

export interface BookingLinkStay {
  readonly checkIn: string;
  readonly checkOut: string;
  readonly adults: number;
  readonly children: number;
  readonly infants: number;
  readonly rooms: number;
  readonly promoCode?: string | undefined;
  readonly locale?: string | undefined;
  readonly currency?: string | undefined;
}

/**
 * The property's booking-engine URL with the guest's search already filled in.
 *
 * Parameter names are the booking engine's, from Little Hotelier's *Website Integration Guide* §3
 * (`design-notes.md` §4). Two of them are not settled, and the choices are written down rather than
 * hidden:
 *
 * - **Dates as `YYYY-MM-DD`.** The guide's table says `dd-mm-yyyy`, but every worked example in the
 *   same guide — and every help-centre link — uses `YYYY-MM-DD` (Q3).
 * - **The promo code under both names.** The guide says `promotion_code`, the newer help centre says
 *   `promocode`. A web app ignores a query parameter it does not know, so sending both costs nothing,
 *   while picking the wrong one silently drops a guest's discount. Drop the loser once one generated
 *   link has been opened (Q3).
 *
 * The rate is NOT pre-selected: the engine's `ratePlanId` and `room_type` are numeric ids the API
 * never returns (it speaks UUIDs), so the guest picks the rate on the engine (Q4).
 *
 * Returns `undefined` when `bookingEngineUrl` is not an https URL — nothing else is safe to hand a guest.
 */
export function buildBookingEngineLink(
  bookingEngineUrl: string,
  stay: BookingLinkStay,
): string | undefined {
  let url: URL;
  try {
    url = new URL(bookingEngineUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;

  const params = url.searchParams;
  params.set('check_in_date', stay.checkIn);
  params.set('check_out_date', stay.checkOut);
  params.set('number_adults', String(stay.adults));
  params.set('number_children', String(stay.children));
  params.set('number_infants', String(stay.infants));
  params.set('num_rooms', String(stay.rooms));
  if (stay.promoCode) {
    params.set('promotion_code', stay.promoCode);
    params.set('promocode', stay.promoCode);
  }
  if (stay.locale) params.set('locale', stay.locale);
  if (stay.currency) params.set('currency', stay.currency);
  return url.toString();
}
