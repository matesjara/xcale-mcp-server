/**
 * From the hotel's calendar to Mews' UTC instants (design-notes §4).
 *
 * The agent speaks in the property's dates; Mews speaks in UTC instants (a night of a daily service
 * starts at the UTC instant of local midnight, observed `2026-10-14T22:00:00Z` for 15 October in
 * Budapest). This converts, and decides nothing: no stay length, no check-in hour, no minimum.
 * The zone comes from the enterprise itself (`configuration/get`) on the same call.
 */

export class MewsDateError extends Error {}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The local wall-clock parts of a UTC instant in an IANA zone. */
function wallClock(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
}

/**
 * The UTC instant at which a local wall-clock time happens in `timeZone`. Two passes, so the offset
 * used is the one in force at the answer, not at the first guess — right on both sides of a DST change.
 */
function localToUtc(wallMs: number, timeZone: string): number {
  let utc = wallMs - (wallClock(wallMs, timeZone) - wallMs);
  utc = wallMs - (wallClock(utc, timeZone) - utc);
  return utc;
}

function parseDate(date: string): number {
  const m = ISO_DATE.exec(date);
  if (!m) throw new MewsDateError(`expected YYYY-MM-DD, got "${date}"`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new MewsDateError(`"${date}" is not a calendar date`);
  }
  return ms;
}

/** Mews' own format: second precision, `Z`, no milliseconds. */
function toMews(utcMs: number): string {
  return new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A service offset as Mews writes it: `P0M0DT15H0M0S`, `P0M0DT-4H0M0S` (observed). */
const OFFSET = /^P(-?\d+)M(-?\d+)DT(-?\d+)H(-?\d+)M(-?\d+)S$/;

export function parseServiceOffset(offset: unknown): number {
  const m = typeof offset === 'string' ? OFFSET.exec(offset) : null;
  if (!m) throw new MewsDateError(`unrecognized Mews service offset ${JSON.stringify(offset)}`);
  if (Number(m[1]) !== 0) {
    // A month offset has never been observed and has no fixed length; refuse rather than guess.
    throw new MewsDateError(`unsupported Mews service offset ${offset}`);
  }
  return (
    Number(m[2]) * 86_400_000 +
    Number(m[3]) * 3_600_000 +
    Number(m[4]) * 60_000 +
    Number(m[5]) * 1000
  );
}

/** The UTC instant of local midnight of `date` in `timeZone`. */
export function localMidnightUtc(date: string, timeZone: string): string {
  return toMews(localToUtc(parseDate(date), timeZone));
}

/** Local `date` plus a service offset (a wall-clock shift), as a UTC instant. */
export function localOffsetUtc(date: string, offsetMs: number, timeZone: string): string {
  return toMews(localToUtc(parseDate(date) + offsetMs, timeZone));
}

/** The date one calendar day before `date`. */
export function previousDate(date: string): string {
  return new Date(parseDate(date) - 86_400_000).toISOString().slice(0, 10);
}

/** A stay needs at least one night: `checkOut` strictly after `checkIn`. */
export function assertStay(checkIn: string, checkOut: string): void {
  if (parseDate(checkOut) <= parseDate(checkIn)) {
    throw new MewsDateError(`checkOut (${checkOut}) must be after checkIn (${checkIn})`);
  }
}

/** Throws a `RangeError` for a zone the runtime does not know. */
export function assertTimeZone(timeZone: unknown): string {
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw new MewsDateError('the enterprise has no timezone');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new MewsDateError(`unknown timezone "${timeZone}"`);
  }
  return timeZone;
}
