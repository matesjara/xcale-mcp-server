import { describe, expect, it } from 'vitest';

import { buildBookingEngineLink, nightsBetween, StayError } from '../stay';

describe('nightsBetween', () => {
  it('counts nights, across a month and a leap day', () => {
    expect(nightsBetween('2026-10-01', '2026-10-03')).toBe(2);
    expect(nightsBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it.each([
    ['2026-10-3', '2026-10-05'],
    ['2026-13-01', '2026-13-02'],
    ['2026-02-29', '2026-03-01'],
    ['2026-10-05', '2026-10-05'],
    ['2026-10-05', '2026-10-01'],
  ])('refuses %s → %s', (from, to) => {
    expect(() => nightsBetween(from, to)).toThrow(StayError);
  });
});

describe('buildBookingEngineLink', () => {
  const stay = {
    checkIn: '2026-10-01',
    checkOut: '2026-10-03',
    adults: 2,
    children: 0,
    infants: 0,
    rooms: 1,
  };

  it('leaves out what the guest did not give', () => {
    const url = new URL(buildBookingEngineLink('https://direct-book.com/properties/X', stay)!);
    expect([...url.searchParams.keys()].sort()).toEqual([
      'check_in_date',
      'check_out_date',
      'num_rooms',
      'number_adults',
      'number_children',
      'number_infants',
    ]);
  });

  it('overrides a stale search the engine URL already carries', () => {
    const url = new URL(
      buildBookingEngineLink(
        'https://direct-book.com/properties/X?check_in_date=2020-01-01',
        stay,
      )!,
    );
    expect(url.searchParams.getAll('check_in_date')).toEqual(['2026-10-01']);
  });

  it.each(['http://direct-book.com/properties/X', 'not a url', 'javascript:alert(1)'])(
    'returns nothing for %s',
    (engine) => {
      expect(buildBookingEngineLink(engine, stay)).toBeUndefined();
    },
  );
});
