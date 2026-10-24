import { afterEach, describe, expect, it, vi } from 'vitest';

import { SecretString } from '../../../core/secret-string';
import { createCloudbedsProvider } from '../provider';
import { weekdayNote, weekdayOf, weekdaysFrom } from '../weekday';

/**
 * xcale-mcp-server#111 — the first dates the agent sees in a booking conversation carry their
 * weekday, so it never computes one. The incident: October 5 2026 (a Monday) sold as "sábado 5".
 */
describe('weekdayOf', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it.each(['UTC', 'America/Bogota', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'])(
    'reads a pure calendar date under TZ=%s',
    (tz) => {
      process.env.TZ = tz;
      expect(weekdayOf('2026-10-03')).toEqual({ en: 'Saturday', es: 'sábado' });
      expect(weekdayOf('2026-10-05')).toEqual({ en: 'Monday', es: 'lunes' });
    },
  );

  it('labels nothing that is not a real date', () => {
    expect(weekdayOf('2026-13-45')).toBeUndefined();
    expect(weekdayOf('2026-02-29')).toBeUndefined();
    expect(weekdayOf('tomorrow')).toBeUndefined();
  });
});

describe('weekdaysFrom', () => {
  it('maps every date through the checkout, across a month boundary', () => {
    expect(weekdaysFrom('2026-10-30', '2026-11-02')).toEqual({
      '2026-10-30': { en: 'Friday', es: 'viernes' },
      '2026-10-31': { en: 'Saturday', es: 'sábado' },
      '2026-11-01': { en: 'Sunday', es: 'domingo' },
      '2026-11-02': { en: 'Monday', es: 'lunes' },
    });
  });
});

describe('weekdayNote', () => {
  it('names each date with its weekday and tells the model not to compute one', () => {
    const note = weekdayNote({ startDate: '2026-10-03', endDate: '2026-10-05' });
    expect(note).toContain('startDate 2026-10-03 is Saturday (sábado)');
    expect(note).toContain('endDate 2026-10-05 is Monday (lunes)');
    expect(note).toContain('never work a weekday out yourself');
  });

  it('leaves out a date it cannot read, and says nothing when none is readable', () => {
    expect(weekdayNote({ startDate: '2026-10-03', endDate: 'soon' })).not.toContain('soon');
    expect(weekdayNote({ startDate: 'soon' })).toBeUndefined();
  });
});

describe('the tools carry the weekdays, additively', () => {
  const ctx = {
    credential: { secret: new SecretString('cbat_test0000000000000000000000000') },
    metadata: { propertyID: '20064' },
    request: {},
  } as never;

  function providerAnswering(data: unknown) {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ success: true, data }), { status: 200 }),
    );
    return createCloudbedsProvider({ fetchImpl: fetchImpl as never });
  }

  it("get_availability keeps Cloudbeds' array as the data and puts the weekdays in the message", async () => {
    const rooms = [{ propertyID: '20064', propertyRooms: [{ roomTypeID: '1' }] }];
    const res = (await providerAnswering(rooms).callTool(
      'mcp_cloudbeds_get_availability',
      { startDate: '2026-10-03', endDate: '2026-10-05' },
      ctx,
    )) as { kind: string; data: unknown; message?: string };

    expect(res.kind).toBe('success');
    expect(res.data).toEqual(rooms);
    expect(res.message).toContain('startDate 2026-10-03 is Saturday (sábado)');
    expect(res.message).toContain('endDate 2026-10-05 is Monday (lunes)');
  });

  it('get_room_calendar adds `weekdays` for every date of the range, checkout included', async () => {
    const plans = [
      {
        roomTypeID: '1',
        roomRateDetailed: [
          { date: '2026-10-03', roomsAvailable: 1 },
          { date: '2026-10-04', roomsAvailable: 1 },
        ],
      },
    ];
    const res = (await providerAnswering(plans).callTool(
      'mcp_cloudbeds_get_room_calendar',
      { startDate: '2026-10-03', endDate: '2026-10-05' },
      ctx,
    )) as {
      kind: string;
      data: { from: string; to: string; roomTypes: unknown[]; weekdays: Record<string, unknown> };
      message?: string;
    };

    expect(res.kind).toBe('success');
    expect(res.data.from).toBe('2026-10-03');
    expect(res.data.to).toBe('2026-10-05');
    expect(res.data.roomTypes).toHaveLength(1);
    expect(res.data.weekdays).toEqual({
      '2026-10-03': { en: 'Saturday', es: 'sábado' },
      '2026-10-04': { en: 'Sunday', es: 'domingo' },
      '2026-10-05': { en: 'Monday', es: 'lunes' },
    });
    expect(res.message).toContain('never work a weekday out yourself');
  });
});
