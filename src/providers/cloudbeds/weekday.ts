import { addDays, isRealDate, nightsBetween } from './availability-calendar';

/**
 * The weekday of a calendar date, computed here so the agent never works one out (xcale-mcp-server#111).
 *
 * WHY THIS EXISTS. Live on 2026-09-11 a guest asked for "el sábado 5 de octubre"; October 5 2026 is a
 * Monday. The availability answer carried bare `YYYY-MM-DD`, the agent computed the weekday from
 * memory, wrote "¡Tenemos disponibilidad para el sábado 5 de octubre!" and a reservation was made for
 * the wrong night (xcale-backend#1206). The backend's booking tools now return the weekday of every
 * stay date (#1215); these are the first dates the agent sees, so they carry it too.
 *
 * A calendar date has no time zone: `YYYY-MM-DD` is read at noon UTC and indexed with `getUTCDay()`,
 * so neither the process `TZ` nor the property's can move the day. Names come from a fixed table —
 * the same shape and spelling as the backend's `stay-calendar.ts` — never from ICU, which may be partial.
 */
export interface Weekday {
  readonly en: string;
  readonly es: string;
}

/** Indexed by `getUTCDay()`: 0 = Sunday. */
const WEEKDAYS: readonly Weekday[] = [
  { en: 'Sunday', es: 'domingo' },
  { en: 'Monday', es: 'lunes' },
  { en: 'Tuesday', es: 'martes' },
  { en: 'Wednesday', es: 'miércoles' },
  { en: 'Thursday', es: 'jueves' },
  { en: 'Friday', es: 'viernes' },
  { en: 'Saturday', es: 'sábado' },
];

/** The weekday of `date`, or `undefined` when it is not a real `YYYY-MM-DD` date — never a guess. */
export function weekdayOf(date: string): Weekday | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isRealDate(date)) return undefined;
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay()];
}

/** Every date from `from` through `to`, both included, mapped to its weekday. */
export function weekdaysFrom(from: string, to: string): Record<string, Weekday> {
  const days: Record<string, Weekday> = {};
  for (const date of nightsBetween(from, addDays(to, 1))) {
    const weekday = weekdayOf(date);
    if (weekday) days[date] = weekday;
  }
  return days;
}

const USE_THESE =
  'These weekdays are computed by the system: use them as given and never work a weekday out yourself.';

/**
 * The text line that hands the model the weekday of each named date, e.g.
 * `startDate 2026-10-03 is Saturday (sábado); endDate 2026-10-05 is Monday (lunes). These weekdays …`.
 * Dates that are not real are left out rather than labelled.
 */
export function weekdayNote(dates: Readonly<Record<string, string>>): string | undefined {
  const parts = Object.entries(dates).flatMap(([label, date]) => {
    const weekday = weekdayOf(date);
    return weekday ? [`${label} ${date} is ${weekday.en} (${weekday.es})`] : [];
  });
  return parts.length === 0 ? undefined : `${parts.join('; ')}. ${USE_THESE}`;
}

/** The instruction alone, for an answer whose weekdays travel in its data. */
export const WEEKDAYS_IN_DATA_NOTE = `Every date in \`weekdays\` carries its weekday. ${USE_THESE}`;
