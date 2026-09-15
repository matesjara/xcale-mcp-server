import { describe, expect, it } from 'vitest';

import {
  addDays,
  buildRoomCalendar,
  isRealDate,
  nightsBetween,
  resolveHorizon,
  shapeRoomCalendars,
  type CalendarNight,
} from '../availability-calendar';

const free = (date: string, roomsAvailable = 1) => ({ date, roomsAvailable });

/**
 * One rate plan, over the range its own rows span. `unavailable` is measured against the QUERIED
 * range, so the helper derives it from the rows unless a test names the range itself — the tests
 * that care about unread nights pass it explicitly.
 */
function calendar(nights: readonly CalendarNight[], quantity = 1, range?: readonly string[]) {
  const dates = nights.map((n) => n.date).sort();
  const derived =
    dates.length === 0 ? [] : nightsBetween(dates[0]!, addDays(dates[dates.length - 1]!, 1));
  return buildRoomCalendar([nights], quantity, range ?? derived);
}

describe('buildRoomCalendar', () => {
  it('turns a run of free nights into one window whose `to` is the CHECKOUT date', () => {
    const result = calendar([free('2026-09-19'), free('2026-09-20'), free('2026-09-21')]);

    // Three nights (19, 20, 21) — the guest checks out on the 22nd.
    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-22', nights: 3, roomsFree: 1 },
    ]);
    expect(result.unavailable).toEqual([]);
  });

  it('crosses a month boundary when deriving the checkout date', () => {
    const result = calendar([free('2026-09-30')]);

    expect(result.freeWindows).toEqual([
      { from: '2026-09-30', to: '2026-10-01', nights: 1, roomsFree: 1 },
    ]);
  });

  it('splits the run on a sold-out night', () => {
    const result = calendar([
      free('2026-09-19'),
      free('2026-09-20', 0),
      free('2026-09-21'),
      free('2026-09-22'),
    ]);

    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-20', nights: 1, roomsFree: 1 },
      { from: '2026-09-21', to: '2026-09-23', nights: 2, roomsFree: 1 },
    ]);
    expect(result.unavailable).toEqual(['2026-09-20']);
  });

  it('splits the run on a blocked night even when inventory says the room is free', () => {
    const result = calendar([
      free('2026-09-19'),
      { date: '2026-09-20', roomsAvailable: 3, blocked: true },
      free('2026-09-21'),
    ]);

    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-20', nights: 1, roomsFree: 1 },
      { from: '2026-09-21', to: '2026-09-22', nights: 1, roomsFree: 1 },
    ]);
    expect(result.unavailable).toEqual(['2026-09-20']);
  });

  it('drops a run shorter than the minimum stay of its arrival night', () => {
    const result = calendar([
      { date: '2026-09-19', roomsAvailable: 1, minLos: 3 },
      free('2026-09-20'),
    ]);

    // Two free nights, but the property will not sell fewer than three — offering it would be a lie.
    expect(result.freeWindows).toEqual([]);
    expect(result.unavailable).toEqual(['2026-09-19', '2026-09-20']);
  });

  it('moves the arrival forward when the first night is closed to arrival', () => {
    const result = calendar([
      { date: '2026-09-19', roomsAvailable: 1, closedToArrival: true },
      free('2026-09-20'),
      free('2026-09-21'),
    ]);

    expect(result.freeWindows).toEqual([
      { from: '2026-09-20', to: '2026-09-22', nights: 2, roomsFree: 1 },
    ]);
    expect(result.unavailable).toEqual(['2026-09-19']);
  });

  it('counts a night as free only when it holds the whole quantity asked for', () => {
    const result = calendar(
      [free('2026-09-19', 2), free('2026-09-20', 1), free('2026-09-21', 2)],
      2,
    );

    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-20', nights: 1, roomsFree: 2 },
      { from: '2026-09-21', to: '2026-09-22', nights: 1, roomsFree: 2 },
    ]);
  });

  it('reports the window`s roomsFree as the scarcest night in it', () => {
    const result = calendar([free('2026-09-19', 3), free('2026-09-20', 1), free('2026-09-21', 2)]);

    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-22', nights: 3, roomsFree: 1 },
    ]);
  });

  it('reads Cloudbeds` stringified numbers and flags', () => {
    const result = calendar(
      [
        { date: '2026-09-19', roomsAvailable: '2', blocked: '0', minLos: '1' },
        { date: '2026-09-20', roomsAvailable: '2', blocked: '0', closedToArrival: '0' },
      ],
      2,
    );

    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-21', nights: 2, roomsFree: 2 },
    ]);
  });

  it('returns no windows and every date as unavailable when nothing is free', () => {
    const result = calendar([free('2026-09-19', 0), free('2026-09-20', 0)]);

    expect(result.freeWindows).toEqual([]);
    expect(result.unavailable).toEqual(['2026-09-19', '2026-09-20']);
  });

  it('breaks the run on a missing night rather than stitching a gap into one window', () => {
    // Cloudbeds is not contractually obliged to send a row per night. A gap is a night we know
    // nothing about, so a window may not span it — that would sell an unread date.
    const result = calendar([free('2026-09-19'), free('2026-09-21')]);

    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-20', nights: 1, roomsFree: 1 },
      { from: '2026-09-21', to: '2026-09-22', nights: 1, roomsFree: 1 },
    ]);
  });

  it('treats a night with no availability field as unknown, never as free', () => {
    const result = calendar([{ date: '2026-09-19' }, free('2026-09-20')]);

    expect(result.freeWindows).toEqual([
      { from: '2026-09-20', to: '2026-09-21', nights: 1, roomsFree: 1 },
    ]);
    expect(result.unavailable).toEqual(['2026-09-19']);
  });

  it('lists a night Cloudbeds sent no row for as unavailable, instead of losing it', () => {
    // The gap correctly ends the run, but the dates used to vanish from BOTH lists while the
    // published from/to still spanned them — so the agent concluded nothing was blocked there.
    const result = calendar([free('2026-09-19'), free('2026-09-22')], 1, [
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
    ]);

    expect(result.unavailable).toEqual(['2026-09-20', '2026-09-21']);
  });
});

describe('closedToDeparture belongs to the checkout date, not the last night', () => {
  it('keeps the last night when the flag sits on that night and the morning after is open', () => {
    // The inverted reading threw this night away AND proposed checkout on the flagged date itself.
    const result = calendar([
      free('2026-09-19'),
      free('2026-09-20'),
      { date: '2026-09-21', roomsAvailable: 1, closedToDeparture: true },
      free('2026-09-22'),
    ]);

    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-23', nights: 4, roomsFree: 1 },
    ]);
  });

  it('shortens the stay when the morning after is the date that refuses departures', () => {
    const result = calendar([
      free('2026-09-19'),
      free('2026-09-20'),
      free('2026-09-21'),
      { date: '2026-09-22', roomsAvailable: 0, closedToDeparture: true },
    ]);

    // Checkout on the 22nd is refused, so the stay ends the night before: 19 and 20, out on the 21st.
    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-21', nights: 2, roomsFree: 1 },
    ]);
    expect(result.unavailable).toEqual(['2026-09-21', '2026-09-22']);
  });

  it('does not invent a restriction for the morning after the range', () => {
    // The checkout that closes the last night of the horizon was never asked about. Refusing it
    // would delete the closing window of every answer this tool gives.
    const result = calendar([free('2026-09-19'), free('2026-09-20')]);

    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-21', nights: 2, roomsFree: 1 },
    ]);
  });
});

describe('maxLos', () => {
  it('reads 0 as NO maximum, which is how every observed row spells it', () => {
    // Live, Bio Habitat, 2026-09-10: `maxLos: 0` on every night of every plan. Read as a cap it
    // collapses every window to nothing and the tool answers "nothing is free" for an open property.
    const result = calendar(
      [free('2026-09-19'), free('2026-09-20'), free('2026-09-21')].map((n) => ({
        ...n,
        maxLos: 0,
      })),
    );

    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-22', nights: 3, roomsFree: 1 },
    ]);
  });

  it('caps the stay at the arrival night`s maximum when the property sets one', () => {
    const result = calendar([
      { date: '2026-09-19', roomsAvailable: 1, maxLos: 2 },
      free('2026-09-20'),
      free('2026-09-21'),
      free('2026-09-22'),
    ]);

    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-21', nights: 2, roomsFree: 1 },
    ]);
    expect(result.unavailable).toEqual(['2026-09-21', '2026-09-22']);
  });
});

describe('rate plans are calculated apart, never merged into one night', () => {
  const range = ['2026-09-19', '2026-09-20'];

  it('never sells one plan`s inventory under another plan`s open restrictions', () => {
    // Plan A has no rooms and no restriction; plan B has two rooms and is blocked. Merging the
    // fields made the night sell B's two rooms while ignoring B's own block.
    const planA: CalendarNight[] = [
      { date: '2026-09-19', roomsAvailable: 0 },
      { date: '2026-09-20', roomsAvailable: 0 },
    ];
    const planB: CalendarNight[] = [
      { date: '2026-09-19', roomsAvailable: 2, blocked: true },
      { date: '2026-09-20', roomsAvailable: 2, blocked: true },
    ];

    const result = buildRoomCalendar([planA, planB], 1, range);

    expect(result.freeWindows).toEqual([]);
    expect(result.unavailable).toEqual(range);
  });

  it('offers a window as soon as ONE plan can sell the whole stay', () => {
    const sold: CalendarNight[] = [
      { date: '2026-09-19', roomsAvailable: 0 },
      { date: '2026-09-20', roomsAvailable: 0 },
    ];
    const open: CalendarNight[] = [free('2026-09-19', 2), free('2026-09-20', 2)];

    const result = buildRoomCalendar([sold, open], 1, range);

    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-21', nights: 2, roomsFree: 2 },
    ]);
  });

  it('does not stitch two plans` windows into one longer stay', () => {
    // A stay rides ONE plan. 19→21 on A and 21→23 on B do not add up to a bookable 19→23.
    const planA: CalendarNight[] = [
      free('2026-09-19'),
      free('2026-09-20'),
      { date: '2026-09-21', roomsAvailable: 0 },
      { date: '2026-09-22', roomsAvailable: 0 },
    ];
    const planB: CalendarNight[] = [
      { date: '2026-09-19', roomsAvailable: 0 },
      { date: '2026-09-20', roomsAvailable: 0 },
      free('2026-09-21'),
      free('2026-09-22'),
    ];

    const result = buildRoomCalendar([planA, planB], 1, [
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
    ]);

    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-21', nights: 2, roomsFree: 1 },
      { from: '2026-09-21', to: '2026-09-23', nights: 2, roomsFree: 1 },
    ]);
  });

  it('keeps a shorter window that offers more rooms than the longer one', () => {
    const long: CalendarNight[] = [free('2026-09-19', 1), free('2026-09-20', 1)];
    const roomy: CalendarNight[] = [
      free('2026-09-19', 4),
      { date: '2026-09-20', roomsAvailable: 0 },
    ];

    const result = buildRoomCalendar([long, roomy], 1, range);

    expect(result.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-21', nights: 2, roomsFree: 1 },
      { from: '2026-09-19', to: '2026-09-20', nights: 1, roomsFree: 4 },
    ]);
  });
});

describe('shapeRoomCalendars', () => {
  const nights = (roomsAvailable: number | undefined) =>
    ['2026-09-19', '2026-09-20'].map((date) =>
      roomsAvailable === undefined ? { date } : { date, roomsAvailable },
    );

  it('refuses only when NOT ONE room type could be read', () => {
    const shaped = shapeRoomCalendars(
      [
        { roomTypeID: 'A', roomRateDetailed: nights(undefined) },
        { roomTypeID: 'B', roomRateDetailed: nights(undefined) },
      ],
      '2026-09-19',
      '2026-09-21',
      1,
    );

    expect(shaped).toEqual({ ok: false, reason: 'no-nightly-availability' });
  });

  it('marks the unreadable room type instead of publishing it as sold out', () => {
    // The OR across room types let one readable type suppress the refusal for all of them, and the
    // unreadable one went out with `freeWindows: []` — indistinguishable from genuinely full.
    const shaped = shapeRoomCalendars(
      [
        { roomTypeID: 'A', roomTypeName: 'Ecohab', roomRateDetailed: nights(2) },
        { roomTypeID: 'B', roomTypeName: 'Suite', roomRateDetailed: nights(undefined) },
      ],
      '2026-09-19',
      '2026-09-21',
      1,
    );

    expect(shaped.ok).toBe(true);
    if (!shaped.ok) return;

    expect(shaped.roomTypes[0]).toEqual({
      roomTypeID: 'A',
      roomTypeName: 'Ecohab',
      freeWindows: [{ from: '2026-09-19', to: '2026-09-21', nights: 2, roomsFree: 2 }],
      unavailable: [],
    });
    expect(shaped.roomTypes[1]).toEqual({
      roomTypeID: 'B',
      roomTypeName: 'Suite',
      availabilityUnknown: true,
      freeWindows: [],
      // NOT the two dates: "we could not check this" is not "these dates are taken".
      unavailable: [],
    });
  });

  it('refuses rather than publishing a room type the agent cannot name', () => {
    // `roomTypeID: ''` is an id that addresses nothing, and the agent would pass it to
    // get_availability.
    const shaped = shapeRoomCalendars(
      [{ roomRateDetailed: nights(2) }],
      '2026-09-19',
      '2026-09-21',
      1,
    );

    expect(shaped).toEqual({ ok: false, reason: 'no-identified-room-type' });
  });

  it('measures unavailable against the queried range, not against the rows that arrived', () => {
    const shaped = shapeRoomCalendars(
      [{ roomTypeID: 'A', roomRateDetailed: [{ date: '2026-09-19', roomsAvailable: 1 }] }],
      '2026-09-19',
      '2026-09-22',
      1,
    );

    expect(shaped.ok).toBe(true);
    if (!shaped.ok) return;
    expect(shaped.roomTypes[0]?.unavailable).toEqual(['2026-09-20', '2026-09-21']);
  });

  it('dates rows by position when Cloudbeds omits the date field', () => {
    const shaped = shapeRoomCalendars(
      [
        {
          roomTypeID: 'A',
          roomRateDetailed: [{ roomsAvailable: 1 }, { roomsAvailable: 1 }] as CalendarNight[],
        },
      ],
      '2026-09-19',
      '2026-09-21',
      1,
    );

    expect(shaped.ok).toBe(true);
    if (!shaped.ok) return;
    expect(shaped.roomTypes[0]?.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-21', nights: 2, roomsFree: 1 },
    ]);
  });
});

describe('resolveHorizon and date validation', () => {
  it('looks 30 nights ahead when the guest names no end', () => {
    expect(resolveHorizon('2026-09-19', undefined)).toBe('2026-10-19');
  });

  it('cuts anything past 90 nights', () => {
    expect(resolveHorizon('2026-09-19', '2027-06-01')).toBe('2026-12-18');
  });

  it('keeps an end date inside the ceiling', () => {
    expect(resolveHorizon('2026-09-19', '2026-09-25')).toBe('2026-09-25');
  });

  it('refuses a string that is shaped like a date but is not one', () => {
    // `2026-13-45` passes the input regex, and UTC math rolls it into a plausible 2027 horizon.
    expect(isRealDate('2026-13-45')).toBe(false);
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('2026-09-19')).toBe(true);
  });
});
