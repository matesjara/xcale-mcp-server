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
      { guestPhone: '+573001112233' },
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
      { guestPhone: '+573001112233' },
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
