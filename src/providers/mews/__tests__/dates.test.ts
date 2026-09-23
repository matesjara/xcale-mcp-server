import { describe, expect, it } from 'vitest';

import { localMidnightUtc, localOffsetUtc, parseServiceOffset } from '../dates';

describe('mews dates — local calendar to UTC instants', () => {
  it('is local midnight on an ordinary day', () => {
    expect(localMidnightUtc('2026-10-15', 'Europe/Budapest')).toBe('2026-10-14T22:00:00Z');
    expect(localMidnightUtc('2026-10-15', 'America/Bogota')).toBe('2026-10-15T05:00:00Z');
  });

  it('is the first instant of the day when the clocks skip midnight (Santiago, 2026-09-06)', () => {
    // 00:00 does not exist that day in Chile: 23:59:59 (UTC-4) is followed by 01:00 (UTC-3).
    // The first instant of 6 September is 01:00 local, 04:00Z — not 5 September at 23:00.
    expect(localMidnightUtc('2026-09-06', 'America/Santiago')).toBe('2026-09-06T04:00:00Z');
    expect(localMidnightUtc('2026-09-05', 'America/Santiago')).toBe('2026-09-05T04:00:00Z');
  });

  it('is the first instant of the day when the clocks skip midnight (Havana, 2027-03-14)', () => {
    expect(localMidnightUtc('2027-03-14', 'America/Havana')).toBe('2027-03-14T05:00:00Z');
  });

  it('reads negative service offsets as a time on the previous day', () => {
    // `P0M0DT-4H0M0S`, observed: the unit ends at 20:00 the day before.
    const offset = parseServiceOffset('P0M0DT-4H0M0S');
    expect(localOffsetUtc('2026-10-17', offset, 'America/Bogota')).toBe('2026-10-17T01:00:00Z');
  });

  it('refuses an offset with months, which has no fixed length', () => {
    expect(() => parseServiceOffset('P1M0DT0H0M0S')).toThrow(/unsupported/);
    expect(() => parseServiceOffset('PT15H')).toThrow(/unrecognized/);
  });
});
