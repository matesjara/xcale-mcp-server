import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import { createCloudbedsProvider } from '../provider';

/**
 * `find_guest_reservations` — the record lookup of ADR 0023 (xcale-backend#1852). `getGuestList` finds
 * the rows by the exact phone or email; its rows carry no phone and no stay, so each is read with
 * `getReservation`. The shapes below are the ones sandbox 320754 returned on 2026-10-26.
 */

const ctx = () => ({
  credential: { secret: new SecretString('tok') },
  metadata: { propertyID: '320754' },
});

const reservation = (id: string, guestID: string, phone: string) => ({
  propertyID: '320754',
  reservationID: id,
  status: 'confirmed',
  startDate: '2026-12-08',
  endDate: '2026-12-12',
  guestList: {
    [guestID]: {
      guestID,
      guestEmail: 'ana@example.com',
      guestPhone: phone,
      guestCellPhone: '',
      roomTypeName: 'Master Suite',
    },
  },
  assigned: [],
  unassigned: [{ roomTypeName: 'Master Suite', adults: '2', children: '1' }],
  cardsOnFile: [{ cardNumber: '1111' }],
});

function world(guestRows: unknown[], reservations: Record<string, unknown>, total?: number) {
  const seen: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const u = new URL(url.toString());
    seen.push(u.pathname.split('/').pop() + '?' + u.searchParams.toString());
    if (u.pathname.endsWith('getGuestList')) {
      const body =
        total === undefined
          ? { success: true, data: guestRows }
          : { success: true, data: guestRows, total };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    const r = reservations[u.searchParams.get('reservationID') ?? ''];
    return new Response(
      JSON.stringify(r ? { success: true, data: r } : { success: false, message: 'not found' }),
      { status: 200 },
    );
  }) as FetchLike;
  return { seen, provider: createCloudbedsProvider({ fetchImpl }) };
}

/**
 * A Cloudbeds whose `getGuestList` matches a filter only on the exact stored string, as the real one does
 * (sandbox 320754, 2026-10-22). `stored` maps a field value (phone, cell phone or email) to the rows it holds.
 */
function exactWorld(
  stored: Record<string, { reservationID: string; guestID: string }[]>,
  reservations: Record<string, unknown>,
  opts: { failListOn?: string; total?: number } = {},
) {
  const seen: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const u = new URL(url.toString());
    seen.push(u.pathname.split('/').pop() + '?' + u.searchParams.toString());
    if (u.pathname.endsWith('getGuestList')) {
      const value =
        u.searchParams.get('guestPhone') ??
        u.searchParams.get('guestCellPhone') ??
        u.searchParams.get('guestEmail') ??
        '';
      if (opts.failListOn !== undefined && value === opts.failListOn) {
        return new Response(JSON.stringify({ success: false, message: 'boom' }), { status: 200 });
      }
      const data = stored[value] ?? [];
      const body =
        opts.total === undefined
          ? { success: true, data }
          : { success: true, data, total: opts.total };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    const r = reservations[u.searchParams.get('reservationID') ?? ''];
    return new Response(
      JSON.stringify(r ? { success: true, data: r } : { success: false, message: 'not found' }),
      { status: 200 },
    );
  }) as FetchLike;
  const lists = () => seen.filter((s) => s.startsWith('getGuestList'));
  return { seen, lists, provider: createCloudbedsProvider({ fetchImpl }) };
}

const filtersOf = (call: string) => {
  const q = new URLSearchParams(call.split('?')[1]);
  return ['guestPhone', 'guestCellPhone', 'guestEmail'].filter((k) => q.get(k) !== null);
};

const R1 = { reservationID: 'R1', guestID: 'G1' };

describe('cloudbeds find_guest_reservations', () => {
  it('searches by the exact phone, then reads each reservation for its stay and its guest', async () => {
    const { seen, provider } = world(
      [
        { reservationID: 'R1', guestID: 'G1' },
        { reservationID: 'R1', guestID: 'G1' },
      ],
      { R1: reservation('R1', 'G1', '+573001112233') },
    );
    const res = await provider.callTool(
      'mcp_cloudbeds_find_guest_reservations',
      { guestPhone: '+573001112233' },
      ctx(),
    );
    expect(res.kind).toBe('success');
    if (res.kind !== 'success') return;
    expect(res.data).toEqual({
      items: [
        {
          reservationID: 'R1',
          propertyID: '320754',
          status: 'confirmed',
          startDate: '2026-12-08',
          endDate: '2026-12-12',
          roomTypeName: 'Master Suite',
          adults: 2,
          children: 1,
          guestPhone: '+573001112233',
          guestCellPhone: '',
          guestEmail: 'ana@example.com',
        },
      ],
      hasMore: false,
    });
    const list = new URLSearchParams(seen[0]!.split('?')[1]);
    expect(seen[0]).toMatch(/^getGuestList/);
    expect(list.get('guestPhone')).toBe('+573001112233');
    expect(list.get('propertyIDs')).toBe('320754');
    // The same reservation twice in the guest list is read once.
    expect(seen.filter((s) => s.startsWith('getReservation'))).toHaveLength(1);
  });

  it('never asks for the whole guest list: no phone and no email is refused before any call', async () => {
    const { seen, provider } = world([], {});
    const res = await provider.callTool('mcp_cloudbeds_find_guest_reservations', {}, ctx());
    expect(res.kind).toBe('error');
    expect(seen).toHaveLength(0);
  });

  it('a reservation that cannot be read fails the lookup — never a partial list', async () => {
    const { provider } = world(
      [
        { reservationID: 'R1', guestID: 'G1' },
        { reservationID: 'R2', guestID: 'G1' },
      ],
      { R1: reservation('R1', 'G1', '+573001112233') },
    );
    const res = await provider.callTool(
      'mcp_cloudbeds_find_guest_reservations',
      { guestPhone: '+573001112233' },
      ctx(),
    );
    expect(res.kind).toBe('error');
  });

  it('says when Cloudbeds holds more rows than it read: totalResults and hasMore', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ reservationID: `R${i}`, guestID: 'G1' }));
    const reservations = Object.fromEntries(
      rows.map((r) => [r.reservationID, reservation(r.reservationID, 'G1', '+573001112233')]),
    );
    const { provider } = world(rows, reservations, 14);
    const res = await provider.callTool(
      'mcp_cloudbeds_find_guest_reservations',
      { guestEmail: 'ana@example.com' },
      ctx(),
    );
    expect(res.kind).toBe('success');
    if (res.kind !== 'success') return;
    const data = res.data as { items: unknown[]; totalResults?: number; hasMore?: boolean };
    expect(data.items).toHaveLength(10);
    expect(data.totalResults).toBe(14);
    expect(data.hasMore).toBe(true);
  });

  it('says the list is complete when Cloudbeds holds no more than it read', async () => {
    const { provider } = world(
      [{ reservationID: 'R1', guestID: 'G1' }],
      { R1: reservation('R1', 'G1', '+573001112233') },
      1,
    );
    const res = await provider.callTool(
      'mcp_cloudbeds_find_guest_reservations',
      { guestEmail: 'ana@example.com' },
      ctx(),
    );
    if (res.kind !== 'success') throw new Error('expected success');
    expect(res.data).toMatchObject({ totalResults: 1, hasMore: false });
  });

  it('reads at most 10 reservations, and says there are more, even if Cloudbeds ignores the page size', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ reservationID: `R${i}`, guestID: 'G1' }));
    const reservations = Object.fromEntries(
      rows.map((r) => [r.reservationID, reservation(r.reservationID, 'G1', '+573001112233')]),
    );
    const { seen, provider } = world(rows, reservations);
    const res = await provider.callTool(
      'mcp_cloudbeds_find_guest_reservations',
      { guestPhone: '+573001112233' },
      ctx(),
    );
    if (res.kind !== 'success') throw new Error('expected success');
    expect(seen.filter((s) => s.startsWith('getReservation'))).toHaveLength(10);
    expect(res.data).toMatchObject({ hasMore: true });
  });

  it('searches by the exact email too', async () => {
    const { seen, provider } = world([{ reservationID: 'R1', guestID: 'G1' }], {
      R1: reservation('R1', 'G1', '+573001112233'),
    });
    const res = await provider.callTool(
      'mcp_cloudbeds_find_guest_reservations',
      { guestEmail: 'ana@example.com' },
      ctx(),
    );
    expect(res.kind).toBe('success');
    const list = new URLSearchParams(seen[0]!.split('?')[1]);
    expect(list.get('guestEmail')).toBe('ana@example.com');
    expect(list.get('guestPhone')).toBeNull();
  });

  it('searches by the cell phone the front desk typed, alone', async () => {
    const { seen, provider } = world([], {});
    const res = await provider.callTool(
      'mcp_cloudbeds_find_guest_reservations',
      { guestCellPhone: '+573009998877' },
      ctx(),
    );
    expect(res.kind).toBe('success');
    const list = new URLSearchParams(seen[0]!.split('?')[1]);
    expect(seen[0]).toMatch(/^getGuestList/);
    expect(list.get('guestCellPhone')).toBe('+573009998877');
  });

  it('trims a filter, and refuses one that is only blanks before any call', async () => {
    // Cloudbeds reads a blank filter as no filter, and answers with the whole guest list (2026-10-22).
    const blank = world([], {});
    const refused = await blank.provider.callTool(
      'mcp_cloudbeds_find_guest_reservations',
      { guestPhone: '   ', guestEmail: ' ' },
      ctx(),
    );
    expect(refused.kind).toBe('error');
    expect(blank.seen).toHaveLength(0);

    const padded = world([], {});
    await padded.provider.callTool(
      'mcp_cloudbeds_find_guest_reservations',
      { guestPhone: ' +573001112233 ' },
      ctx(),
    );
    expect(new URLSearchParams(padded.seen[0]!.split('?')[1]).get('guestPhone')).toBe(
      '+573001112233',
    );
  });

  it('leaves out a reservation the matched guest is not on', async () => {
    const { provider } = world([{ reservationID: 'R1', guestID: 'G9' }], {
      R1: reservation('R1', 'G1', '+573001112233'),
    });
    const res = await provider.callTool(
      'mcp_cloudbeds_find_guest_reservations',
      { guestPhone: '+573001112233' },
      ctx(),
    );
    if (res.kind !== 'success') throw new Error('expected success');
    expect((res.data as { items: unknown[] }).items).toEqual([]);
  });

  describe('phone variants (OTAs store the phone in other forms)', () => {
    const call = (
      provider: ReturnType<typeof exactWorld>['provider'],
      args: Record<string, unknown>,
    ) => provider.callTool('mcp_cloudbeds_find_guest_reservations', args, ctx());

    it('finds stored 3001234567 from +573001234567', async () => {
      const { provider } = exactWorld(
        { '3001234567': [R1] },
        { R1: reservation('R1', 'G1', '3001234567') },
      );
      const res = await call(provider, { guestPhone: '+573001234567' });
      if (res.kind !== 'success') throw new Error('expected success');
      expect(
        (res.data as { items: { reservationID: string }[] }).items.map((i) => i.reservationID),
      ).toEqual(['R1']);
    });

    it('finds stored 573001234567 from +573001234567', async () => {
      const { provider } = exactWorld(
        { '573001234567': [R1] },
        { R1: reservation('R1', 'G1', '573001234567') },
      );
      const res = await call(provider, { guestPhone: '+573001234567' });
      if (res.kind !== 'success') throw new Error('expected success');
      expect((res.data as { items: unknown[] }).items).toHaveLength(1);
    });

    it('finds stored +573001234567 from 573001234567', async () => {
      const { provider } = exactWorld(
        { '+573001234567': [R1] },
        { R1: reservation('R1', 'G1', '+573001234567') },
      );
      const res = await call(provider, { guestPhone: '573001234567' });
      if (res.kind !== 'success') throw new Error('expected success');
      expect((res.data as { items: unknown[] }).items).toHaveLength(1);
    });

    it('with fewer than 7 digits asks once, with the value as given', async () => {
      const { lists, provider } = exactWorld({}, {});
      await call(provider, { guestPhone: '12-34' });
      expect(lists()).toHaveLength(1);
      expect(new URLSearchParams(lists()[0]!.split('?')[1]).get('guestPhone')).toBe('12-34');
    });

    it('returns a reservation found by two variants once', async () => {
      const { seen, provider } = exactWorld(
        { '573001234567': [R1], '3001234567': [R1] },
        { R1: reservation('R1', 'G1', '3001234567') },
      );
      const res = await call(provider, { guestPhone: '+573001234567' });
      if (res.kind !== 'success') throw new Error('expected success');
      expect((res.data as { items: unknown[] }).items).toHaveLength(1);
      expect(seen.filter((s) => s.startsWith('getReservation'))).toHaveLength(1);
    });

    it('a failed getGuestList fails the lookup, never a list missing a variant', async () => {
      const { provider } = exactWorld(
        { '3001234567': [R1] },
        { R1: reservation('R1', 'G1', '3001234567') },
        {
          failListOn: '573001234567',
        },
      );
      const res = await call(provider, { guestPhone: '+573001234567' });
      expect(res.kind).toBe('error');
    });

    it('a failed getReservation fails the lookup', async () => {
      const { provider } = exactWorld({ '3001234567': [R1] }, {});
      const res = await call(provider, { guestPhone: '+573001234567' });
      expect(res.kind).toBe('error');
    });

    it('keeps the ceiling and hasMore across variants', async () => {
      const rows = Array.from({ length: 6 }, (_, i) => ({ reservationID: `A${i}`, guestID: 'G1' }));
      const rows2 = Array.from({ length: 6 }, (_, i) => ({
        reservationID: `B${i}`,
        guestID: 'G1',
      }));
      const reservations = Object.fromEntries(
        [...rows, ...rows2].map((r) => [
          r.reservationID,
          reservation(r.reservationID, 'G1', '3001234567'),
        ]),
      );
      const { seen, provider } = exactWorld(
        { '573001234567': rows, '3001234567': rows2 },
        reservations,
      );
      const res = await call(provider, { guestPhone: '+573001234567' });
      if (res.kind !== 'success') throw new Error('expected success');
      expect(seen.filter((s) => s.startsWith('getReservation'))).toHaveLength(10);
      expect(res.data).toMatchObject({ hasMore: true });
      expect((res.data as { items: unknown[] }).items).toHaveLength(10);
    });

    it('says hasMore when one variant holds more than it returned, and omits totalResults for several queries', async () => {
      const { provider } = exactWorld(
        { '3001234567': [R1] },
        { R1: reservation('R1', 'G1', '3001234567') },
        {
          total: 25,
        },
      );
      const res = await call(provider, { guestPhone: '+573001234567' });
      if (res.kind !== 'success') throw new Error('expected success');
      expect(res.data).toMatchObject({ hasMore: true });
      expect(res.data).not.toHaveProperty('totalResults');
    });

    it('never makes more than 13 getGuestList calls, each with a single filter', async () => {
      const { lists, provider } = exactWorld({}, {});
      await call(provider, {
        guestPhone: '+57 300 123 4567',
        guestCellPhone: '+1 (415) 555-0132',
        guestEmail: 'ana@example.com',
      });
      expect(lists().length).toBeLessThanOrEqual(13);
      expect(lists().length).toBeGreaterThan(3);
      for (const l of lists()) expect(filtersOf(l)).toHaveLength(1);
      expect(lists().filter((l) => filtersOf(l)[0] === 'guestEmail')).toHaveLength(1);
    });
  });

  it('publishes a complete record lookup (ADR 0023): result identities and a projection', () => {
    const def = createCloudbedsProvider()
      .listTools()
      .find((t) => t.name === 'mcp_cloudbeds_find_guest_reservations');
    expect(def?.identityPolicy).toMatchObject({
      mode: 'subject-bound',
      identityFields: ['guestPhone', 'guestCellPhone', 'guestEmail'],
      identityFieldKinds: { guestPhone: 'phone', guestCellPhone: 'phone', guestEmail: 'email' },
      recordLookup: true,
      recordKind: 'reservation',
      resultItemsPath: 'items',
      resultIdentityFields: { guestPhone: 'phone', guestCellPhone: 'phone', guestEmail: 'email' },
      resultRecordIdField: 'reservationID',
      recordOwnershipKind: 'cloudbeds:reservation',
      resultDateField: 'endDate',
    });
    // The projection is an allowlist: no contact field, no card, no record number.
    const projection = (def?.identityPolicy as { projection?: string[] }).projection ?? [];
    expect(projection).toEqual(
      expect.arrayContaining(['roomTypeName', 'startDate', 'endDate', 'status']),
    );
    for (const f of ['guestPhone', 'guestEmail', 'reservationID', 'cardsOnFile']) {
      expect(projection).not.toContain(f);
    }
  });
});
