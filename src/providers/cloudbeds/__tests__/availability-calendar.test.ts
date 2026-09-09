import { describe, expect, it } from 'vitest';

import { buildRoomCalendar } from '../availability-calendar';

const free = (date: string, roomsAvailable = 1) => ({ date, roomsAvailable });

describe('buildRoomCalendar', () => {
  it('turns a run of free nights into one window whose `to` is the CHECKOUT date', () => {
    const calendar = buildRoomCalendar(
      [free('2026-09-19'), free('2026-09-20'), free('2026-09-21')],
      1,
    );

    // Three nights (19, 20, 21) — the guest checks out on the 22nd.
    expect(calendar.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-22', nights: 3, roomsFree: 1 },
    ]);
    expect(calendar.unavailable).toEqual([]);
  });

  it('crosses a month boundary when deriving the checkout date', () => {
    const calendar = buildRoomCalendar([free('2026-09-30')], 1);

    expect(calendar.freeWindows).toEqual([
      { from: '2026-09-30', to: '2026-10-01', nights: 1, roomsFree: 1 },
    ]);
  });

  it('splits the run on a sold-out night', () => {
    const calendar = buildRoomCalendar(
      [free('2026-09-19'), free('2026-09-20', 0), free('2026-09-21'), free('2026-09-22')],
      1,
    );

    expect(calendar.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-20', nights: 1, roomsFree: 1 },
      { from: '2026-09-21', to: '2026-09-23', nights: 2, roomsFree: 1 },
    ]);
    expect(calendar.unavailable).toEqual(['2026-09-20']);
  });

  it('splits the run on a blocked night even when inventory says the room is free', () => {
    const calendar = buildRoomCalendar(
      [
        free('2026-09-19'),
        { date: '2026-09-20', roomsAvailable: 3, blocked: true },
        free('2026-09-21'),
      ],
      1,
    );

    expect(calendar.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-20', nights: 1, roomsFree: 1 },
      { from: '2026-09-21', to: '2026-09-22', nights: 1, roomsFree: 1 },
    ]);
    expect(calendar.unavailable).toEqual(['2026-09-20']);
  });

  it('drops a run shorter than the minimum stay of its arrival night', () => {
    const calendar = buildRoomCalendar(
      [{ date: '2026-09-19', roomsAvailable: 1, minLos: 3 }, free('2026-09-20')],
      1,
    );

    // Two free nights, but the property will not sell fewer than three — offering it would be a lie.
    expect(calendar.freeWindows).toEqual([]);
    expect(calendar.unavailable).toEqual(['2026-09-19', '2026-09-20']);
  });

  it('moves the arrival forward when the first night is closed to arrival', () => {
    const calendar = buildRoomCalendar(
      [
        { date: '2026-09-19', roomsAvailable: 1, closedToArrival: true },
        free('2026-09-20'),
        free('2026-09-21'),
      ],
      1,
    );

    expect(calendar.freeWindows).toEqual([
      { from: '2026-09-20', to: '2026-09-22', nights: 2, roomsFree: 1 },
    ]);
    expect(calendar.unavailable).toEqual(['2026-09-19']);
  });

  it('shortens the window when its last night is closed to departure', () => {
    const calendar = buildRoomCalendar(
      [
        free('2026-09-19'),
        free('2026-09-20'),
        { date: '2026-09-21', roomsAvailable: 1, closedToDeparture: true },
      ],
      1,
    );

    expect(calendar.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-21', nights: 2, roomsFree: 1 },
    ]);
    expect(calendar.unavailable).toEqual(['2026-09-21']);
  });

  it('counts a night as free only when it holds the whole quantity asked for', () => {
    const calendar = buildRoomCalendar(
      [free('2026-09-19', 2), free('2026-09-20', 1), free('2026-09-21', 2)],
      2,
    );

    expect(calendar.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-20', nights: 1, roomsFree: 2 },
      { from: '2026-09-21', to: '2026-09-22', nights: 1, roomsFree: 2 },
    ]);
  });

  it('reports the window`s roomsFree as the scarcest night in it', () => {
    const calendar = buildRoomCalendar(
      [free('2026-09-19', 3), free('2026-09-20', 1), free('2026-09-21', 2)],
      1,
    );

    expect(calendar.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-22', nights: 3, roomsFree: 1 },
    ]);
  });

  it('reads Cloudbeds` stringified numbers and flags', () => {
    const calendar = buildRoomCalendar(
      [
        { date: '2026-09-19', roomsAvailable: '2', blocked: '0', minLos: '1' },
        { date: '2026-09-20', roomsAvailable: '2', blocked: '0', closedToArrival: '0' },
      ],
      2,
    );

    expect(calendar.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-21', nights: 2, roomsFree: 2 },
    ]);
  });

  it('returns no windows and every date as unavailable when nothing is free', () => {
    const calendar = buildRoomCalendar([free('2026-09-19', 0), free('2026-09-20', 0)], 1);

    expect(calendar.freeWindows).toEqual([]);
    expect(calendar.unavailable).toEqual(['2026-09-19', '2026-09-20']);
  });

  it('breaks the run on a missing night rather than stitching a gap into one window', () => {
    // Cloudbeds is not contractually obliged to send a row per night. A gap is a night we know
    // nothing about, so a window may not span it — that would sell an unread date.
    const calendar = buildRoomCalendar([free('2026-09-19'), free('2026-09-21')], 1);

    expect(calendar.freeWindows).toEqual([
      { from: '2026-09-19', to: '2026-09-20', nights: 1, roomsFree: 1 },
      { from: '2026-09-21', to: '2026-09-22', nights: 1, roomsFree: 1 },
    ]);
  });

  it('treats a night with no availability field as unknown, never as free', () => {
    const calendar = buildRoomCalendar([{ date: '2026-09-19' }, free('2026-09-20')], 1);

    expect(calendar.freeWindows).toEqual([
      { from: '2026-09-20', to: '2026-09-21', nights: 1, roomsFree: 1 },
    ]);
    expect(calendar.unavailable).toEqual(['2026-09-19']);
  });
});
