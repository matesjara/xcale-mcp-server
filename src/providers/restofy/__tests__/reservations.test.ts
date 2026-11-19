import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { createRestofyProvider } from '../provider';
import area from '../__fixtures__/area.json';
import areas from '../__fixtures__/areas.json';
import areasNotOnline from '../__fixtures__/areasNotOnline.json';
import reservationDetail from '../__fixtures__/reservationDetail.json';
import reservationsUpcoming from '../__fixtures__/reservationsUpcoming.json';
import slots from '../__fixtures__/slots.json';
import tenantInfo from '../__fixtures__/tenantInfo.json';
import { type Captured, ctx, fakeRestofy, sentBody } from './helpers';

const AREA_UUID = 'c3778dbb-e3b0-11f1-a14a-0e75ecd64603';
const PHONE = '+573001112233';

function toolNamed(name: string) {
  return createRestofyProvider()
    .listTools()
    .find((t) => t.name === name);
}

describe('restofy reservations — S6 list_reservation_areas', () => {
  it('lists each area with the restaurant’s own booking rules, without its schedule internals', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy(
        {
          'reservation-areas/list-reservation-areas': { body: areas },
          'reservation-areas/get-reservation-area': { body: area },
        },
        capture,
      ),
    });

    const r = await provider.callTool('mcp_restofy_list_reservation_areas', {}, ctx);

    expect(r.kind).toBe('success');
    const [item] = (r as { data: { items: Record<string, unknown>[] } }).data.items;
    expect(item).toMatchObject({
      reservationAreaId: 1,
      reservationAreaUuid: AREA_UUID,
      name: 'Salón Principal',
      capacityMax: 50,
      isOnlineBookable: 1,
      minAdvanceMinutes: 120,
      maxAdvanceDays: 30,
      minPartySize: 1,
      maxPartySize: 8,
    });
    expect(item).not.toHaveProperty('schedule');
    expect(item).not.toHaveProperty('scheduleId');
    expect(sentBody(capture[1])).toEqual({ reservationAreaId: 1 });
  });
});

describe('restofy reservations — S6 list_reservation_slots', () => {
  const day = { areaUuid: AREA_UUID, date: '2026-11-21' };

  it("reads the day's slots by the restaurant's public address, as Restofy computes them", async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy(
        {
          'tenants/get-tenant-info': { body: tenantInfo },
          'reservation-areas/list-reservation-areas': { body: areas },
          'diner-reservation/list-reservation-slots': { body: slots },
        },
        capture,
      ),
    });

    const r = await provider.callTool('mcp_restofy_list_reservation_slots', day, ctx);

    expect(r).toMatchObject({ kind: 'success', data: { slots: slots.data.slots } });
    expect(sentBody(capture.at(-1))).toEqual({
      slug: 'xcale-test-resto',
      areaUuid: AREA_UUID,
      date: '2026-11-21',
    });
  });

  it('an area not bookable online has no slots, and says so as a fact', async () => {
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({
        'tenants/get-tenant-info': { body: tenantInfo },
        'reservation-areas/list-reservation-areas': { body: areasNotOnline },
      }),
    });

    const r = await provider.callTool('mcp_restofy_list_reservation_slots', day, ctx);

    expect(r).toMatchObject({
      kind: 'success',
      data: { slots: [], reason: 'not_bookable_online' },
    });
  });

  it('a restaurant with no public address has no slots, and says so as a fact', async () => {
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({
        'tenants/get-tenant-info': {
          body: { ...tenantInfo, data: { ...tenantInfo.data, slug: null } },
        },
      }),
    });

    const r = await provider.callTool('mcp_restofy_list_reservation_slots', day, ctx);

    expect(r).toMatchObject({ kind: 'success', data: { slots: [], reason: 'no_public_address' } });
  });

  it('refuses a date that is not YYYY-MM-DD before reaching Restofy', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({ fetchImpl: fakeRestofy({}, capture) });

    const r = await provider.callTool(
      'mcp_restofy_list_reservation_slots',
      { areaUuid: AREA_UUID, date: '21/11/2026' },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(0);
  });
});

describe('restofy reservations — S6 find_reservations_by_phone', () => {
  it('returns only the reservations whose contact has exactly this phone, upcoming by default', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy(
        { 'reservations/list-reservations': { body: reservationsUpcoming } },
        capture,
      ),
    });

    const r = await provider.callTool(
      'mcp_restofy_find_reservations_by_phone',
      { phone: PHONE },
      ctx,
    );

    const items = (r as { data: { items: Record<string, unknown>[] } }).data.items;
    expect(items.map((i) => i.reservationId)).toEqual([1]);
    expect(Object.keys(items[0]!).sort()).toEqual(
      [
        'durationMinutes',
        'guestCount',
        'notes',
        'occasionName',
        'partyName',
        'partyPhone',
        'reservationAreaId',
        'reservationId',
        'reservedAt',
        'status',
      ].sort(),
    );
    expect(sentBody(capture[0])).toEqual({ scope: 'upcoming', search: PHONE });
  });

  it('publishes a record lookup by phone', () => {
    expect(toolNamed('mcp_restofy_find_reservations_by_phone')?.identityPolicy).toMatchObject({
      mode: 'subject-bound',
      identityFields: ['phone'],
      identityFieldKinds: { phone: 'phone' },
      recordLookup: true,
      recordKind: 'reservation',
      resultItemsPath: 'items',
      resultIdentityFields: { partyPhone: 'phone' },
      resultRecordIdField: 'reservationId',
      resultDateField: 'reservedAt',
    });
  });
});

describe('restofy reservations — S6 get_reservation', () => {
  it('reads one reservation verbatim, bound to its owner', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy(
        { 'reservations/get-reservation-detail': { body: reservationDetail } },
        capture,
      ),
    });

    const r = await provider.callTool('mcp_restofy_get_reservation', { reservationId: 1 }, ctx);

    expect(r).toMatchObject({ kind: 'success', data: reservationDetail.data.reservation });
    expect(sentBody(capture[0])).toEqual({ reservationId: 1 });
    expect(toolNamed('mcp_restofy_get_reservation')?.identityPolicy).toEqual({
      mode: 'subject-bound',
      identityFields: [],
      recordOwnershipField: 'reservationId',
      recordOwnershipKind: 'restofy:reservation',
      recordAction: 'read',
    });
  });
});

describe('restofy reservations — S6 list_reservations (control plane)', () => {
  it("returns everyone's bookings for a scope, so it is withdrawn from the agent's menu", async () => {
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({ 'reservations/list-reservations': { body: reservationsUpcoming } }),
    });

    const r = await provider.callTool('mcp_restofy_list_reservations', { scope: 'upcoming' }, ctx);

    expect(r).toMatchObject({ kind: 'success', data: reservationsUpcoming.data });
    expect(toolNamed('mcp_restofy_list_reservations')).toBeUndefined();
    expect(provider.routableToolNames()).toContain('mcp_restofy_list_reservations');
  });
});
