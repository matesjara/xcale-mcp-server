/**
 * A night as Cloudbeds reports it inside `getRatePlans`' `roomRateDetailed[]`. Every numeric and
 * boolean field is typed loosely on purpose: this API is form-encoded and has been observed to
 * answer numbers as strings, so coercion happens once here rather than at each reader.
 */
export interface CalendarNight {
  readonly date: string;
  readonly roomsAvailable?: number | string;
  readonly blocked?: boolean | number | string;
  readonly minLos?: number | string;
  readonly closedToArrival?: boolean | number | string;
  readonly closedToDeparture?: boolean | number | string;
}

/**
 * A stretch of nights that can actually be BOOKED — not merely one with inventory left.
 *
 * `to` is the CHECKOUT date, the morning after the last night, which is how a guest and a PMS both
 * read a stay. A window of `from: 19, to: 22` is three nights: 19, 20 and 21.
 */
export interface FreeWindow {
  readonly from: string;
  readonly to: string;
  readonly nights: number;
  readonly roomsFree: number;
}

export interface RoomCalendar {
  readonly freeWindows: readonly FreeWindow[];
  /** Dates in the range that no window covers. Not necessarily sold out — see `buildRoomCalendar`. */
  readonly unavailable: readonly string[];
}

/**
 * Cloudbeds flags arrive as `true`, `1`, `"1"`, `false`, `0`, `"0"` or absent, depending on the
 * endpoint and the day. Anything that is not one of the recognized falsy spellings counts as set:
 * for restrictions, reading an unknown value as "restricted" is the safe direction — it costs an
 * offer, whereas the opposite sells a night the property closed.
 */
function isSet(value: boolean | number | string | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'no';
}

function toNumber(value: number | string | undefined, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * `roomsAvailable` missing is UNKNOWN, and unknown resolves to zero — never to "free". The whole
 * point of this tool is that the agent stops guessing; a night we cannot read is a night we do not
 * offer.
 */
function roomsFreeOn(night: CalendarNight): number {
  return toNumber(night.roomsAvailable, 0);
}

function isSellable(night: CalendarNight, quantity: number): boolean {
  return !isSet(night.blocked) && roomsFreeOn(night) >= quantity;
}

/** `date` shifted by `days`, as YYYY-MM-DD. Month and year boundaries come free from UTC math. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return next.toISOString().slice(0, 10);
}

/** The morning after `date` — the checkout that closes a stay whose last night is `date`. */
function checkoutAfter(date: string): string {
  return addDays(date, 1);
}

/**
 * Narrow a run of nights that all have inventory down to the part that is actually SELLABLE, or
 * nothing.
 *
 * Two restrictions bite at the edges rather than in the middle: the property can refuse arrivals on
 * a date (`closedToArrival`) and departures on another (`closedToDeparture`), so the run is trimmed
 * from both ends before its length is judged. `minLos` is read from the ARRIVAL night — it is a rule
 * about the stay that starts there — and a run too short to satisfy it yields no window at all:
 * trimming further only makes it shorter.
 *
 * `closedToDeparture` is evaluated on the run's LAST NIGHT, not on the checkout date. That is the
 * convention the booking Gate already applies (`cloudbeds-stay-truth.adapter.ts`), and matching it
 * matters more than the stricter reading: this calendar exists so the agent never offers a date the
 * Gate then refuses. If the live contract settles it the other way, both places change together.
 */
function sellableSpan(
  run: readonly CalendarNight[],
): { readonly start: number; readonly end: number } | null {
  let start = 0;
  while (start < run.length && isSet(run[start]?.closedToArrival)) start++;
  if (start >= run.length) return null;

  let end = run.length - 1;
  while (end >= start && isSet(run[end]?.closedToDeparture)) end--;
  if (end < start) return null;

  const minLos = toNumber(run[start]?.minLos, 1);
  if (end - start + 1 < minLos) return null;

  return { start, end };
}

/**
 * Turn Cloudbeds' per-night detail into the two things a guest actually asks for: when the room is
 * free, and which dates it is not.
 *
 * `unavailable` is every date the answer does NOT cover, which is deliberately broader than "sold
 * out": a night with rooms left still lands there when a minimum stay or a closed arrival makes it
 * unsellable. Calling those dates sold out would be false, and the agent repeats what it is given.
 *
 * This is a SHOPPING view, never an authorization. The booking Gate re-reads availability at the
 * moment of reserving, because a calendar the guest saw ten minutes ago is already old.
 */
export function buildRoomCalendar(
  nights: readonly CalendarNight[],
  quantity: number,
): RoomCalendar {
  const wanted = Math.max(1, Math.trunc(toNumber(quantity, 1)) || 1);

  const runs: CalendarNight[][] = [];
  let current: CalendarNight[] = [];
  for (const night of nights) {
    // A gap in the dates ends the run. Cloudbeds is not obliged to send a row for every night, and a
    // window that spanned a night we never read would be selling an unknown.
    const previous = current[current.length - 1];
    const contiguous = previous === undefined || checkoutAfter(previous.date) === night.date;
    if (isSellable(night, wanted) && contiguous) {
      current.push(night);
      continue;
    }
    if (current.length > 0) runs.push(current);
    current = isSellable(night, wanted) ? [night] : [];
  }
  if (current.length > 0) runs.push(current);

  const freeWindows: FreeWindow[] = [];
  const covered = new Set<string>();
  for (const run of runs) {
    const span = sellableSpan(run);
    if (!span) continue;
    const stay = run.slice(span.start, span.end + 1);
    for (const night of stay) covered.add(night.date);
    freeWindows.push({
      from: stay[0]!.date,
      to: checkoutAfter(stay[stay.length - 1]!.date),
      nights: stay.length,
      roomsFree: Math.min(...stay.map(roomsFreeOn)),
    });
  }

  return {
    freeWindows,
    unavailable: nights.map((night) => night.date).filter((date) => !covered.has(date)),
  };
}

/** How far ahead one question may look, and how far it looks when the guest names no end. */
export const DEFAULT_HORIZON_NIGHTS = 30;
export const MAX_HORIZON_NIGHTS = 90;

/**
 * Resolve the checkout date the call will actually ask for. An open-ended question ("when is the
 * Ecohab free?") becomes a 30-night look-ahead, and no question may pull more than 90 nights of
 * rates out of the property in one round trip.
 */
export function resolveHorizon(startDate: string, endDate: string | undefined): string {
  const latest = addDays(startDate, MAX_HORIZON_NIGHTS);
  if (endDate === undefined) return addDays(startDate, DEFAULT_HORIZON_NIGHTS);
  return endDate > latest ? latest : endDate;
}

/** One entry of `getRatePlans`' response, as much of it as a calendar needs. */
export interface RatePlanRow {
  readonly roomTypeID?: string | number;
  readonly roomTypeName?: string;
  readonly roomRateDetailed?: readonly CalendarNight[];
}

export interface RoomTypeCalendar extends RoomCalendar {
  readonly roomTypeID: string;
  readonly roomTypeName?: string;
}

export type CalendarShaping =
  | { readonly ok: true; readonly roomTypes: readonly RoomTypeCalendar[] }
  | { readonly ok: false; readonly reason: 'no-nightly-availability' };

/**
 * Merge the nights a room type's rate plans report into ONE night per date.
 *
 * A room type usually carries several rate plans (flexible, non-refundable, a promo), and each
 * reports the same physical inventory through its own restrictions. The guest is asking about the
 * ROOM, not about a rate, so a night any plan can sell is a free night: availability merges as the
 * maximum, and a restriction survives only when EVERY plan applies it.
 */
function mergeNights(
  plans: readonly RatePlanRow[],
  startDate: string,
): { readonly nights: readonly CalendarNight[]; readonly sawAvailability: boolean } {
  const byDate = new Map<
    string,
    CalendarNight & { plansSeen: number; restricted: Record<string, number> }
  >();
  let sawAvailability = false;

  for (const plan of plans) {
    const rows = plan.roomRateDetailed ?? [];
    rows.forEach((row, index) => {
      // Cloudbeds' observed nightly rows carry rate and restrictions; `date` is not guaranteed. The
      // rows are the range in order, so position dates them when the field is absent.
      const date = row.date ?? addDays(startDate, index);
      if (row.roomsAvailable !== undefined && row.roomsAvailable !== null) sawAvailability = true;

      const current = byDate.get(date);
      const merged = {
        date,
        roomsAvailable: Math.max(
          toNumber(current?.roomsAvailable, 0),
          toNumber(row.roomsAvailable, 0),
        ),
        minLos: Math.min(
          toNumber(current?.minLos, Number.POSITIVE_INFINITY),
          toNumber(row.minLos, 1),
        ),
        plansSeen: (current?.plansSeen ?? 0) + 1,
        restricted: {
          blocked: (current?.restricted.blocked ?? 0) + (isSet(row.blocked) ? 1 : 0),
          closedToArrival:
            (current?.restricted.closedToArrival ?? 0) + (isSet(row.closedToArrival) ? 1 : 0),
          closedToDeparture:
            (current?.restricted.closedToDeparture ?? 0) + (isSet(row.closedToDeparture) ? 1 : 0),
        },
      };
      byDate.set(date, merged);
    });
  }

  const nights = [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((night) => ({
      date: night.date,
      roomsAvailable: night.roomsAvailable,
      minLos: night.minLos,
      blocked: night.restricted.blocked === night.plansSeen,
      closedToArrival: night.restricted.closedToArrival === night.plansSeen,
      closedToDeparture: night.restricted.closedToDeparture === night.plansSeen,
    }));

  return { nights, sawAvailability };
}

/**
 * Turn a `getRatePlans` response into one calendar per room type.
 *
 * Refuses rather than answers when not a single night carries `roomsAvailable`: every night would
 * then read as zero and the tool would report "nothing is free" — an answer indistinguishable from
 * a real sold-out property, and one the agent would repeat to a guest as fact. The field list
 * observed live on 2026-07-15 does not include per-night availability, so this is a live
 * possibility, not a theoretical one.
 */
export function shapeRoomCalendars(
  plans: readonly RatePlanRow[],
  startDate: string,
  quantity: number,
): CalendarShaping {
  const byRoomType = new Map<string, RatePlanRow[]>();
  for (const plan of plans) {
    const id = String(plan.roomTypeID ?? '');
    byRoomType.set(id, [...(byRoomType.get(id) ?? []), plan]);
  }

  const roomTypes: RoomTypeCalendar[] = [];
  let sawAnyNight = false;
  let sawAnyAvailability = false;

  for (const [roomTypeID, group] of byRoomType) {
    const { nights, sawAvailability } = mergeNights(group, startDate);
    if (nights.length > 0) sawAnyNight = true;
    if (sawAvailability) sawAnyAvailability = true;

    const name = group.find((plan) => plan.roomTypeName !== undefined)?.roomTypeName;
    roomTypes.push({
      roomTypeID,
      ...(name === undefined ? {} : { roomTypeName: name }),
      ...buildRoomCalendar(nights, quantity),
    });
  }

  if (sawAnyNight && !sawAnyAvailability) return { ok: false, reason: 'no-nightly-availability' };
  return { ok: true, roomTypes };
}
