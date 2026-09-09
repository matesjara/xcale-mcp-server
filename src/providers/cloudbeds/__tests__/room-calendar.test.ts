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

  it('merges the rate plans of one room type — a night any rate can sell is a free night', async () => {
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

    const { roomTypes } = (result as { data: { roomTypes: unknown[] } }).data;
    expect(roomTypes).toHaveLength(1);
    expect(roomTypes[0]).toMatchObject({
      freeWindows: [{ from: '2026-09-19', to: '2026-09-21', nights: 2, roomsFree: 1 }],
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
});
