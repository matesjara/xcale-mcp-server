import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { createRestofyProvider } from '../provider';
import area from '../__fixtures__/area.json';
import areas from '../__fixtures__/areas.json';
import areasNotOnline from '../__fixtures__/areasNotOnline.json';
import cancelNotAllowed from '../__fixtures__/errors/cancelNotAllowed.json';
import reservationInPast from '../__fixtures__/errors/reservationInPast.json';
import reservedAtNotUtc from '../__fixtures__/errors/reservedAtNotUtc.json';
import reservationCancelled from '../__fixtures__/reservationCancelled.json';
import reservationCreated from '../__fixtures__/reservationCreated.json';
import reservationDetail from '../__fixtures__/reservationDetail.json';
import reservationsUpcoming from '../__fixtures__/reservationsUpcoming.json';
import dinerAreas from '../__fixtures__/dinerAreas.json';
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

  it("reads the day's slots by the restaurant's public address, as Restofy computes them (observed 2026-11-20)", async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy(
        {
          'tenants/get-tenant-info': { body: tenantInfo },
          'reservation-areas/list-reservation-areas': { body: areas },
          'diner-reservation/list-reservation-areas': { body: dinerAreas },
        },
        capture,
      ),
    });

    const r = await provider.callTool('mcp_restofy_list_reservation_slots', day, ctx);

    const [area] = dinerAreas.data.areas;
    const theDay = area!.days.find((d) => d.date === '2026-11-21')!;
    expect(r).toMatchObject({ kind: 'success', data: { slots: theDay.slots } });
    expect(sentBody(capture.at(-1))).toEqual({ slug: 'xcale-test-resto', reservationToken: null });
  });

  it('a day the area does not open has no slots', async () => {
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({
        'tenants/get-tenant-info': { body: tenantInfo },
        'reservation-areas/list-reservation-areas': { body: areas },
        'diner-reservation/list-reservation-areas': { body: dinerAreas },
      }),
    });

    const r = await provider.callTool(
      'mcp_restofy_list_reservation_slots',
      { areaUuid: AREA_UUID, date: '2027-01-01' },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'success', data: { slots: [] } });
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

describe('restofy reservations — S7 create_reservation', () => {
  const booking = {
    partyId: 1,
    reservationAreaId: 1,
    guestCount: 2,
    reservedAt: '2026-11-20T01:00:00.000Z',
    notes: 'Mesa cerca de la ventana',
  };

  it('books the table for the contact as given and returns its id', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy(
        { 'reservations/create-reservation': { body: reservationCreated } },
        capture,
      ),
    });

    const r = await provider.callTool('mcp_restofy_create_reservation', booking, ctx);

    expect(r).toMatchObject({ kind: 'success', data: { reservationId: 1 } });
    expect(sentBody(capture[0])).toEqual(booking);
  });

  it("a time in the past comes back as Restofy's own sentence", async () => {
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({
        'reservations/create-reservation': { status: 400, body: reservationInPast },
      }),
    });

    const r = await provider.callTool('mcp_restofy_create_reservation', booking, ctx);

    expect(r).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.INVALID_INPUT,
      message: 'La fecha de la reserva debe ser futura',
    });
  });

  it('tells the agent Restofy does not check capacity or party size on this path', () => {
    const description = toolNamed('mcp_restofy_create_reservation')?.description ?? '';
    expect(description).toMatch(/capacity/i);
    expect(description).toMatch(/party size/i);
  });

  it('refuses a time without an offset, so the hour is never guessed', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({ fetchImpl: fakeRestofy({}, capture) });

    const r = await provider.callTool(
      'mcp_restofy_create_reservation',
      { ...booking, reservedAt: '2026-11-20 20:00' },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(0);
  });

  it.each([
    ['a day the month does not have', '2026-02-31T20:00:00-05:00'],
    ['an hour the day does not have', '2026-11-21T25:99:00Z'],
  ])('refuses %s, never booking another day nor throwing', async (_why, reservedAt) => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({ fetchImpl: fakeRestofy({}, capture) });

    const r = await provider.callTool(
      'mcp_restofy_create_reservation',
      { ...booking, reservedAt },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(0);
  });
});

describe('restofy reservations — S7 cancel_reservation', () => {
  it('cancels the reservation with its reason', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy(
        { 'reservations/cancel-reservation': { body: reservationCancelled } },
        capture,
      ),
    });

    const r = await provider.callTool(
      'mcp_restofy_cancel_reservation',
      { reservationId: 1, cancellationReason: 'El comensal no puede asistir' },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'success', data: { reservationId: 1 } });
    expect(sentBody(capture[0])).toEqual({
      reservationId: 1,
      cancellationReason: 'El comensal no puede asistir',
    });
  });

  it('a reservation already cancelled is refused with Restofy’s sentence', async () => {
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({
        'reservations/cancel-reservation': { status: 400, body: cancelNotAllowed },
      }),
    });

    const r = await provider.callTool(
      'mcp_restofy_cancel_reservation',
      { reservationId: 1, cancellationReason: 'Otra vez' },
      ctx,
    );

    expect(r).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.INVALID_INPUT,
      message: 'La reserva no se puede cancelar en su estado actual',
    });
  });

  it('publishes that it cancels a record its owner holds', () => {
    expect(toolNamed('mcp_restofy_cancel_reservation')?.identityPolicy).toEqual({
      mode: 'subject-bound',
      identityFields: [],
      recordOwnershipField: 'reservationId',
      recordOwnershipKind: 'restofy:reservation',
      recordAction: 'cancel',
    });
  });
});

describe('restofy reservations — reservedAt reaches Restofy in UTC (contract QA, 2026-11-19)', () => {
  it('a time with its Colombian offset is sent as the same instant in UTC with Z, the only form Restofy takes', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy(
        { 'reservations/create-reservation': { body: reservationCreated } },
        capture,
      ),
    });

    const r = await provider.callTool(
      'mcp_restofy_create_reservation',
      { partyId: 1, reservationAreaId: 1, guestCount: 2, reservedAt: '2026-11-22T20:00:00-05:00' },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'success' });
    expect(sentBody(capture[0])).toMatchObject({ reservedAt: '2026-11-23T01:00:00.000Z' });
  });

  it("Restofy's refusal of a non-UTC time is its own sentence (recorded live)", async () => {
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({
        'reservations/create-reservation': { status: 400, body: reservedAtNotUtc },
      }),
    });

    const r = await provider.callTool(
      'mcp_restofy_create_reservation',
      { partyId: 1, reservationAreaId: 1, guestCount: 2, reservedAt: '2026-11-23T01:00:00Z' },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
  });
});

describe('restofy reservations — an unknown area says so (contract QA note)', () => {
  it('slots for an area the restaurant does not have answer reason "unknown_area", not a silent empty list', async () => {
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({
        'tenants/get-tenant-info': { body: tenantInfo },
        'reservation-areas/list-reservation-areas': { body: areas },
      }),
    });

    const r = await provider.callTool(
      'mcp_restofy_list_reservation_slots',
      { areaUuid: '00000000-0000-4000-8000-000000000000', date: '2026-11-21' },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'success', data: { slots: [], reason: 'unknown_area' } });
  });
});

describe('restofy reservations — the diner owns what they book (CTO 2026-11-19, #2935)', () => {
  it('create_reservation publishes the kind and the id of the record it creates', () => {
    expect(toolNamed('mcp_restofy_create_reservation')?.identityPolicy).toEqual({
      mode: 'subject-bound',
      identityFields: [],
      recordOwnershipKind: 'restofy:reservation',
      createdRecordIdField: 'reservationId',
    });
  });
});
