import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { FetchLike } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import { createCloudbedsProvider } from '../provider';

const ctx = { credential: { secret: new SecretString('tok') }, metadata: { propertyID: 'PROP1' } };

function respondWith(body: unknown): { fetchImpl: FetchLike; url: () => string } {
  let calledUrl = '';
  const fetchImpl = (async (url: string | URL) => {
    calledUrl = url.toString();
    return new Response(JSON.stringify(body), { status: 200 });
  }) as FetchLike;
  return { fetchImpl, url: () => calledUrl };
}

const call = (args: Record<string, unknown>, body: unknown) => {
  const { fetchImpl, url } = respondWith(body);
  const provider = createCloudbedsProvider({ fetchImpl });
  return (
    provider
      .callTool('mcp_cloudbeds_get_room_calendar', args, ctx)
      // A rejected call never reaches fetch, so there is no URL to read — that is a pass, not a crash.
      .then((result) => ({ result, qs: new URLSearchParams(url() ? new URL(url()).search : '') }))
  );
};

const plan = (nights: unknown[], over: Record<string, unknown> = {}) => ({
  success: true,
  data: [
    {
      rateID: '1',
      roomTypeID: '679065',
      roomTypeName: 'Ecohab',
      roomRateDetailed: nights,
      ...over,
    },
  ],
});

describe('get_room_calendar', () => {
  it('asks getRatePlans for the nightly detail of one room type', async () => {
    const { qs } = await call(
      { startDate: '2026-09-17', endDate: '2026-09-21', roomTypeID: '679065' },
      plan([]),
    );

    expect(qs.get('propertyID')).toBe('PROP1');
    expect(qs.get('startDate')).toBe('2026-09-17');
    expect(qs.get('endDate')).toBe('2026-09-21');
    expect(qs.get('roomTypeID')).toBe('679065');
    // Without this the response carries no per-night rows at all, and there is no calendar to build.
    expect(qs.get('detailedRates')).toBe('true');
  });

  it('looks 30 nights ahead when no end date is given', async () => {
    const { qs } = await call({ startDate: '2026-09-17' }, plan([]));

    expect(qs.get('endDate')).toBe('2026-10-17');
  });

  it('caps the horizon at 90 nights so one question cannot pull a year of rates', async () => {
    const { qs } = await call({ startDate: '2026-09-17', endDate: '2027-09-17' }, plan([]));

    expect(qs.get('endDate')).toBe('2026-12-16');
  });

  it('answers with free windows and unavailable dates per room type', async () => {
    const { result } = await call(
      { startDate: '2026-09-17', endDate: '2026-09-21' },
      plan([
        { date: '2026-09-17', roomsAvailable: 0 },
        { date: '2026-09-18', roomsAvailable: 0 },
        { date: '2026-09-19', roomsAvailable: 1 },
        { date: '2026-09-20', roomsAvailable: 1 },
      ]),
    );

    expect(result).toMatchObject({ kind: 'success' });
    expect((result as { data: unknown }).data).toEqual({
      from: '2026-09-17',
      to: '2026-09-21',
      roomTypes: [
        {
          roomTypeID: '679065',
          roomTypeName: 'Ecohab',
          freeWindows: [{ from: '2026-09-19', to: '2026-09-21', nights: 2, roomsFree: 1 }],
          unavailable: ['2026-09-17', '2026-09-18'],
        },
      ],
    });
  });

  it('dates the nights from the start of the range when Cloudbeds omits the date field', async () => {
    const { result } = await call(
      { startDate: '2026-09-19', endDate: '2026-09-21' },
      plan([{ roomsAvailable: 1 }, { roomsAvailable: 1 }]),
    );

    expect((result as { data: { roomTypes: unknown[] } }).data.roomTypes[0]).toMatchObject({
      freeWindows: [{ from: '2026-09-19', to: '2026-09-21', nights: 2, roomsFree: 1 }],
    });
  });

  it('never builds a stay no single rate plan can sell', async () => {
    const { result } = await call(
      { startDate: '2026-09-19', endDate: '2026-09-21' },
      {
        success: true,
        data: [
          {
            rateID: '1',
            roomTypeID: '679065',
            roomTypeName: 'Ecohab',
            roomRateDetailed: [
              { date: '2026-09-19', roomsAvailable: 0 },
              { date: '2026-09-20', roomsAvailable: 1 },
            ],
          },
          {
            rateID: '2',
            roomTypeID: '679065',
            roomTypeName: 'Ecohab',
            roomRateDetailed: [
              { date: '2026-09-19', roomsAvailable: 2 },
              { date: '2026-09-20', roomsAvailable: 0 },
            ],
          },
        ],
      },
    );

    // Rate 1 can only sell the 20th, rate 2 only the 19th. Taking the max across plans per night
    // produced one two-night window that NEITHER rate could honour — the guest books 19→21 and the
    // Gate refuses (review 2026-09-09). A stay rides one plan, so the answer is two one-night stays.
    const { roomTypes } = (result as { data: { roomTypes: unknown[] } }).data;
    expect(roomTypes).toHaveLength(1);
    expect(roomTypes[0]).toMatchObject({
      freeWindows: [
        { from: '2026-09-19', to: '2026-09-20', nights: 1, roomsFree: 2 },
        { from: '2026-09-20', to: '2026-09-21', nights: 1, roomsFree: 1 },
      ],
    });
  });

  it('counts a night free only when it holds every room asked for', async () => {
    const { result } = await call(
      { startDate: '2026-09-19', endDate: '2026-09-21', quantity: 2 },
      plan([
        { date: '2026-09-19', roomsAvailable: 2 },
        { date: '2026-09-20', roomsAvailable: 1 },
      ]),
    );

    expect(
      (result as { data: { roomTypes: { unavailable: string[] }[] } }).data.roomTypes[0],
    ).toMatchObject({
      freeWindows: [{ from: '2026-09-19', to: '2026-09-20', nights: 1, roomsFree: 2 }],
      unavailable: ['2026-09-20'],
    });
  });

  it('rejects a date that is not YYYY-MM-DD instead of doing arithmetic on it', async () => {
    const { result } = await call({ startDate: '17/09/2026' }, plan([]));

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
  });

  // The failure this tool must never have. `roomRateDetailed` is documented with per-night rates and
  // restrictions; per-night AVAILABILITY is what the calendar is made of, and it is not in the field
  // list observed live on 2026-07-15. If a property answers without it, every night reads as zero and
  // the honest-looking answer "nothing is free, ever" would be a lie the agent repeats to a guest.
  it('refuses to answer when the property sends no per-night availability', async () => {
    const { result } = await call(
      { startDate: '2026-09-19', endDate: '2026-09-21' },
      plan([
        { date: '2026-09-19', rate: 350, minLos: 1 },
        { date: '2026-09-20', rate: 350, minLos: 1 },
      ]),
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
    expect((result as { message: string }).message).toMatch(/per-night availability/i);
  });

  it('refuses the same way when no nightly rows arrive at all', async () => {
    // `plan([])` is the filler four request-shape tests above use, and nothing asserted what the
    // tool ANSWERS for it — so the empty-rows path was exercised and silently blessed. It used to
    // come back a well-formed success naming the room type with zero windows AND zero unavailable
    // dates, which reads as "checked, nothing blocked" (review 2026-09-09).
    const { result } = await call({ startDate: '2026-09-19', endDate: '2026-09-21' }, plan([]));

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
  });

  it('marks an unreadable room type instead of publishing it as sold out', async () => {
    const { result } = await call(
      { startDate: '2026-09-19', endDate: '2026-09-21' },
      {
        success: true,
        data: [
          {
            rateID: '1',
            roomTypeID: 'A',
            roomTypeName: 'Ecohab',
            roomRateDetailed: [
              { date: '2026-09-19', roomsAvailable: 2 },
              { date: '2026-09-20', roomsAvailable: 2 },
            ],
          },
          {
            rateID: '2',
            roomTypeID: 'B',
            roomTypeName: 'Suite',
            roomRateDetailed: [
              { date: '2026-09-19', rate: 350 },
              { date: '2026-09-20', rate: 350 },
            ],
          },
        ],
      },
    );

    // One readable type used to suppress the refusal for every other one, and the unreadable type
    // went out looking exactly like a full one.
    const { roomTypes } = (result as { data: { roomTypes: Record<string, unknown>[] } }).data;
    expect(roomTypes[0]).toMatchObject({ roomTypeID: 'A', unavailable: [] });
    expect(roomTypes[0]?.freeWindows).toHaveLength(1);
    expect(roomTypes[1]).toMatchObject({
      roomTypeID: 'B',
      availabilityUnknown: true,
      freeWindows: [],
      unavailable: [],
    });
  });

  it('fails loudly when getRatePlans answers with a shape that is not a list', async () => {
    // `Array.isArray(u.data) ? u.data : []` turned this into `roomTypes: []` with `ok: true` —
    // "this property has no room types" (soul #2: no silent failures).
    const { result } = await call(
      { startDate: '2026-09-19', endDate: '2026-09-21' },
      { success: true, data: { unexpected: 'object' } },
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
    expect((result as { message: string }).message).toMatch(/unexpected shape/i);
  });

  it('refuses a checkout date that lands on or before the arrival', async () => {
    const { result } = await call(
      { startDate: '2026-09-21', endDate: '2026-09-19' },
      plan([{ date: '2026-09-21', roomsAvailable: 1 }]),
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
  });

  it('refuses a date that matches the shape but is not on any calendar', async () => {
    // `2026-13-45` passes the regex and UTC math rolls it into a plausible 2027 horizon.
    const { result } = await call(
      { startDate: '2026-13-45' },
      plan([{ date: '2026-09-19', roomsAvailable: 1 }]),
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
  });
});
