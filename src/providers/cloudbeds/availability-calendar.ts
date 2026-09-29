/**
 * A night as Cloudbeds reports it inside `getRatePlans`' `roomRateDetailed[]`. Every numeric and
 * boolean field is typed loosely on purpose: this API is form-encoded and has been observed to
 * answer numbers as strings, so coercion happens once here rather than at each reader.
 *
 * The full observed row (live, Bio Habitat, 2026-09-10) is:
 * `blocked, closedToArrival, closedToDeparture, cutOff, date, lastMinuteBooking, maxLos, minLos,
 * rate, roomsAvailable, totalRate`. `cutOff` and `lastMinuteBooking` are deliberately absent from
 * this type — see `MAX_LOS_UNLIMITED` for why an unread field is safer than a guessed one.
 */
export interface CalendarNight {
  readonly date: string;
  readonly roomsAvailable?: number | string;
  readonly blocked?: boolean | number | string;
  readonly minLos?: number | string;
  readonly maxLos?: number | string;
  readonly closedToArrival?: boolean | number | string;
  readonly closedToDeparture?: boolean | number | string;
}

/**
 * A stretch of nights that can actually be BOOKED — not merely one with inventory left.
 *
 * `to` is the CHECKOUT date, the morning after the last night, which is how a guest and a PMS both
 * read a stay. A window of `from: 19, to: 22` is three nights: 19, 20 and 21.
 *
 * **What a window guarantees is the WHOLE span, and only that.** It says this exact stay — arrive on
 * `from`, leave on `to` — is sellable. It does NOT promise that every shorter stay inside it is: a
 * night in the middle can be closed to arrival, or carry a minimum stay that a sub-range fails.
 * Saying otherwise is what the first version of this module got wrong, and the guest hears the
 * difference (review, 2026-09-09).
 */
export interface FreeWindow {
  readonly from: string;
  readonly to: string;
  readonly nights: number;
  readonly roomsFree: number;
}

export interface RoomCalendar {
  readonly freeWindows: readonly FreeWindow[];
  /** Dates in the queried range that no window covers. Not necessarily sold out — see below. */
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
 * `maxLos: 0` means NO MAXIMUM, not "a stay of zero nights".
 *
 * Observed live on every row of every rate plan (Bio Habitat, 2026-09-10) — the property sets no
 * maximum and Cloudbeds spells that as zero. Read as a cap it would collapse every window to
 * nothing and this tool would answer "nothing is free" for a property that is wide open: the exact
 * shape of failure the calendar exists to prevent, arrived at by trusting a field name.
 *
 * The same reading applies to `cutOff` and `lastMinuteBooking`, which ride the same rows and are
 * also `0` everywhere observed. They are NOT read here: a booking cut-off decides whether a date can
 * still be booked TODAY, and inventing its unit from a field that has only ever been zero would put
 * a guessed rule between a guest and a real date. Left unread and recorded in the design doc, which
 * is honest; guessed, it would be a silent wrong answer.
 */
const MAX_LOS_UNLIMITED = 0;

/**
 * `roomsAvailable` missing is UNKNOWN, and unknown resolves to zero — never to "free". The whole
 * point of this tool is that the agent stops guessing; a night we cannot read is a night we do not
 * offer. Whether a room type could be read at all is decided one level up, per room type, so an
 * unreadable one is never published as sold out.
 */
function roomsFreeOn(night: CalendarNight): number {
  return toNumber(night.roomsAvailable, 0);
}

function isSellable(night: CalendarNight, quantity: number): boolean {
  return !isSet(night.blocked) && roomsFreeOn(night) >= quantity;
}

/**
 * Is this a real calendar date, and not merely a string shaped like one?
 *
 * `2026-13-45` passes a `\d{4}-\d{2}-\d{2}` regex, and `Date.UTC` rolls it forward into
 * `2027-03-17` — a plausible-looking answer to a question nobody asked. Callers refuse instead.
 */
export function isRealDate(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return false;
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.toISOString().slice(0, 10) === date;
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

/** Every night from `startDate` up to, but not including, the checkout date `endDate`. */
export function nightsBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let date = startDate; date < endDate; date = checkoutAfter(date)) {
    dates.push(date);
    if (dates.length > 400) break; // a malformed range must not spin
  }
  return dates;
}

/**
 * Is the property refusing departures on the morning this stay would end?
 *
 * `closedToDeparture` belongs to the CHECKOUT DATE, not to the last night. Reading it off the last
 * night — as the first version did, and as the booking Gate still does — fails in both directions at
 * once: it proposes checkout on exactly the flagged date, and it throws away a last night that is
 * perfectly sellable with checkout the morning after (review, 2026-09-09).
 *
 * A checkout date with no row is a date we never asked about — the morning after the horizon. Not
 * asking is not evidence of a restriction, and treating it as one would delete the closing window of
 * every answer this tool gives. A date INSIDE the range always has its row here, sellable or not,
 * because the lookup is built from every night the plan reported.
 */
function departureRefused(byDate: ReadonlyMap<string, CalendarNight>, lastNight: string): boolean {
  const checkout = byDate.get(checkoutAfter(lastNight));
  return checkout !== undefined && isSet(checkout.closedToDeparture);
}

/**
 * Narrow a run of nights that all have inventory down to the part that is actually SELLABLE, or
 * nothing.
 *
 * The restrictions bite at the EDGES of the stay, and that is not a simplification — it is what they
 * mean. `closedToArrival` refuses an arrival, so it only matters on the night the stay starts;
 * `closedToDeparture` refuses a departure, so it only matters on the morning it ends; `minLos` and
 * `maxLos` are rules about the stay that BEGINS on a given night, so they are read from the arrival.
 * An interior night carrying any of them does not touch a stay that merely passes through it.
 *
 * What that leaves open is the sub-range: a guest asking for three nights inside a listed window may
 * be refused on all three counts. This module does not pretend otherwise — see `FreeWindow`, and the
 * tool description says it to the agent in the same words.
 */
function sellableSpan(
  run: readonly CalendarNight[],
  byDate: ReadonlyMap<string, CalendarNight>,
): { readonly start: number; readonly end: number } | null {
  let start = 0;
  while (start < run.length && isSet(run[start]?.closedToArrival)) start++;
  if (start >= run.length) return null;

  const minLos = toNumber(run[start]?.minLos, 1);
  const maxLosRaw = toNumber(run[start]?.maxLos, MAX_LOS_UNLIMITED);
  const maxLos = maxLosRaw > 0 ? maxLosRaw : Number.POSITIVE_INFINITY;

  let end = Math.min(run.length - 1, start + maxLos - 1);
  while (end >= start && departureRefused(byDate, run[end]!.date)) end--;
  if (end < start) return null;

  if (end - start + 1 < minLos) return null;

  return { start, end };
}

/**
 * The windows ONE rate plan can sell.
 *
 * Per plan, deliberately. A room type carries several plans over the same physical rooms, and each
 * publishes its own inventory AND its own restrictions. Merging the fields first and judging after
 * crosses one plan's rooms with another plan's rules — plan A with no rooms and no restriction plus
 * plan B blocked with two rooms became a night selling B's two rooms while ignoring B's block
 * (review, 2026-09-09). A stay is booked on one plan, so a window is computed on one plan.
 */
export function windowsForPlan(nights: readonly CalendarNight[], quantity: number): FreeWindow[] {
  const wanted = Math.max(1, Math.trunc(toNumber(quantity, 1)) || 1);
  const byDate = new Map(nights.map((night) => [night.date, night]));

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

  const windows: FreeWindow[] = [];
  for (const run of runs) {
    const span = sellableSpan(run, byDate);
    if (!span) continue;
    const stay = run.slice(span.start, span.end + 1);
    windows.push({
      from: stay[0]!.date,
      to: checkoutAfter(stay[stay.length - 1]!.date),
      nights: stay.length,
      roomsFree: Math.min(...stay.map(roomsFreeOn)),
    });
  }
  return windows;
}

/**
 * Fold the windows of a room type's several plans into one list.
 *
 * Windows are NOT unioned into longer spans: two plans covering 19→21 and 21→23 do not add up to a
 * bookable 19→23, because a stay rides one plan. A window is dropped only when another window
 * genuinely dominates it — same or wider span AND at least as many rooms — so a shorter stay that
 * happens to have more rooms free survives, since that is a different answer to a guest.
 */
function foldWindows(all: readonly FreeWindow[]): FreeWindow[] {
  const sorted = [...all].sort(
    (a, b) => a.from.localeCompare(b.from) || b.nights - a.nights || b.roomsFree - a.roomsFree,
  );
  const kept: FreeWindow[] = [];
  for (const window of sorted) {
    const dominated = kept.some(
      (other) =>
        other.from <= window.from && other.to >= window.to && other.roomsFree >= window.roomsFree,
    );
    if (!dominated) kept.push(window);
  }
  return kept;
}

/**
 * Turn a room type's rate plans into the two things a guest actually asks for: when the room is
 * free, and which dates it is not.
 *
 * `unavailable` is every date OF THE QUERIED RANGE that no window covers — not merely the dates a
 * row arrived for. A night Cloudbeds sent no row for used to vanish from both lists while the
 * published `from`/`to` still spanned it, so the agent concluded nothing was blocked there
 * (review, 2026-09-09). A night we could not read is a night we do not offer, and saying so is the
 * whole contract.
 *
 * It is deliberately broader than "sold out": a night with rooms left still lands there when a
 * minimum stay or a closed arrival makes it unsellable. Calling those dates sold out would be false,
 * and the agent repeats what it is given.
 *
 * This is a SHOPPING view, never an authorization. The booking Gate re-reads availability at the
 * moment of reserving, because a calendar the guest saw ten minutes ago is already old.
 */
export function buildRoomCalendar(
  plans: readonly (readonly CalendarNight[])[],
  quantity: number,
  rangeDates: readonly string[],
): RoomCalendar {
  const freeWindows = foldWindows(plans.flatMap((nights) => windowsForPlan(nights, quantity)));

  const covered = new Set<string>();
  for (const window of freeWindows) {
    for (let date = window.from; date < window.to; date = checkoutAfter(date)) covered.add(date);
  }

  return {
    freeWindows,
    unavailable: rangeDates.filter((date) => !covered.has(date)),
  };
}

/** How far ahead one question may look, and how far it looks when the guest names no end. */
export const DEFAULT_HORIZON_NIGHTS = 30;
export const MAX_HORIZON_NIGHTS = 90;

/**
 * Resolve the checkout date the call will actually ask for. An open-ended question ("when is the
 * Ecohab free?") becomes a 30-night look-ahead, and no question may pull more than 90 nights of
 * rates out of the property in one round trip.
 *
 * A range that ends before it starts is NOT repaired here — the tool refuses it at the boundary
 * rather than silently answering a different question than the one asked.
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
  /**
   * Set when not one of this room type's nights carried `roomsAvailable`. Its `freeWindows` and
   * `unavailable` are then both empty ON PURPOSE — "we could not read this" and "this is full" are
   * different answers, and only one of them is safe to repeat to a guest.
   */
  readonly availabilityUnknown?: true;
}

export type CalendarShaping =
  | { readonly ok: true; readonly roomTypes: readonly RoomTypeCalendar[] }
  | { readonly ok: false; readonly reason: 'no-nightly-availability' | 'no-identified-room-type' };

/** Date every row of a plan, using its own `date` when present and its position when it is not. */
function datedNights(plan: RatePlanRow, startDate: string): CalendarNight[] {
  return (plan.roomRateDetailed ?? []).map((row, index) => ({
    ...row,
    // Cloudbeds' observed nightly rows carry `date`, but it is not guaranteed by the spec. The rows
    // are the range in order, so position dates them when the field is absent.
    date: row.date ?? addDays(startDate, index),
  }));
}

/**
 * Turn a `getRatePlans` response into one calendar per room type.
 *
 * **The refusal is decided per room type, not once for the whole property.** It used to be an OR
 * across every room type, so one type carrying `roomsAvailable` suppressed the refusal for all of
 * them and a room type whose rows lacked the field was published with `freeWindows: []` —
 * indistinguishable from genuinely sold out, which is the precise lie the refusal exists to prevent
 * (review, 2026-09-09). Now such a type is marked `availabilityUnknown` and carries neither windows
 * nor unavailable dates; only when NO room type could be read does the whole answer refuse.
 *
 * Settled live on 2026-09-10 (Bio Habitat, three rate plans): `roomsAvailable` IS present on every
 * nightly row. The refusal is therefore not the expected outcome any more — but it stays, because it
 * costs nothing and the alternative failure is a sold-out lie.
 */
export function shapeRoomCalendars(
  plans: readonly RatePlanRow[],
  startDate: string,
  endDate: string,
  quantity: number,
): CalendarShaping {
  const rangeDates = nightsBetween(startDate, endDate);

  const byRoomType = new Map<string, RatePlanRow[]>();
  let dropped = 0;
  for (const plan of plans) {
    const id = String(plan.roomTypeID ?? '').trim();
    // A room type we cannot name is a room type the agent cannot pass on to `get_availability`.
    // Publishing it as `roomTypeID: ''` hands the model an id that addresses nothing.
    if (id === '') {
      dropped++;
      continue;
    }
    byRoomType.set(id, [...(byRoomType.get(id) ?? []), plan]);
  }

  if (byRoomType.size === 0 && dropped > 0) {
    return { ok: false, reason: 'no-identified-room-type' };
  }

  const roomTypes: RoomTypeCalendar[] = [];
  for (const [roomTypeID, group] of byRoomType) {
    const perPlan = group.map((plan) => datedNights(plan, startDate));
    const readable = perPlan.some((nights) =>
      nights.some((night) => night.roomsAvailable !== undefined && night.roomsAvailable !== null),
    );
    const name = group.find((plan) => plan.roomTypeName !== undefined)?.roomTypeName;
    const named = name === undefined ? {} : { roomTypeName: name };

    roomTypes.push(
      readable
        ? { roomTypeID, ...named, ...buildRoomCalendar(perPlan, quantity, rangeDates) }
        : { roomTypeID, ...named, availabilityUnknown: true, freeWindows: [], unavailable: [] },
    );
  }

  if (roomTypes.length > 0 && roomTypes.every((room) => room.availabilityUnknown === true)) {
    return { ok: false, reason: 'no-nightly-availability' };
  }
  return { ok: true, roomTypes };
}
