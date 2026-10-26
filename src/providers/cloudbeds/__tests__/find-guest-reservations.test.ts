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

function world(guestRows: unknown[], reservations: Record<string, unknown>) {
  const seen: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const u = new URL(url.toString());
    seen.push(u.pathname.split('/').pop() + '?' + u.searchParams.toString());
    if (u.pathname.endsWith('getGuestList')) {
      return new Response(JSON.stringify({ success: true, data: guestRows }), { status: 200 });
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

  it('publishes a complete record lookup (ADR 0023): result identities and a projection', () => {
    const def = createCloudbedsProvider()
      .listTools()
      .find((t) => t.name === 'mcp_cloudbeds_find_guest_reservations');
    expect(def?.identityPolicy).toMatchObject({
      mode: 'subject-bound',
      identityFields: ['guestPhone', 'guestEmail'],
      identityFieldKinds: { guestPhone: 'phone', guestEmail: 'email' },
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
