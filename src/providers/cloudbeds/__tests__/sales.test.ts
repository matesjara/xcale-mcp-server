import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import { createCloudbedsProvider } from '../provider';

const ctx = (metadata: Record<string, unknown> = { propertyID: 'PROP1' }) => ({
  credential: { secret: new SecretString('tok') },
  metadata,
});

const okBody = (data: unknown, total?: number) =>
  total === undefined ? { success: true, data } : { success: true, data, total };

/** Capture the outgoing request so we can assert what actually went on the wire. */
function capture() {
  const seen: { url: string; method: string; body: string }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    seen.push({
      url: url.toString(),
      method: init?.method ?? 'GET',
      body: init?.body ? String(init.body) : '',
    });
    return new Response(JSON.stringify(okBody([])), { status: 200 });
  }) as FetchLike;
  return { seen, fetchImpl };
}

describe('cloudbeds sales tools', () => {
  it('adds no new scope — the consent screen must not move for pure coverage', () => {
    // read/write guest and reservation were already requested by the booking tools. If this ever
    // fails, a sales tool started asking hotels for something new, which is a decision, not a detail.
    const auth = createCloudbedsProvider().auth;
    if (auth.type !== 'oauth2') throw new Error('expected oauth2');
    for (const s of ['read:guest', 'write:guest', 'read:reservation', 'write:reservation']) {
      expect(auth.scopes).toContain(s);
    }
  });

  describe('search_guests', () => {
    it('sends `propertyIDs` — plural — and the uniform page/pageSize contract', async () => {
      // Two traps pinned at once: the plural param (every neighbouring method uses `propertyID`), and
      // paging. `getGuestList` is used precisely because it pages; an unpaged guest search would dump
      // the whole book into the agent's context — the `resultsPerPage` bug all over again.
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_search_guests',
        { page: 3, pageSize: 20, guestLastName: 'Escobar' },
        ctx(),
      );
      const qs = new URL(seen[0]!.url).searchParams;
      expect(seen[0]!.url).toContain('getGuestList');
      expect(qs.get('propertyIDs')).toBe('PROP1');
      expect(qs.get('propertyID')).toBeNull();
      expect(qs.get('pageNumber')).toBe('3');
      expect(qs.get('pageSize')).toBe('20');
      expect(qs.get('guestLastName')).toBe('Escobar');
    });

    it('returns the uniform PaginatedResult envelope', async () => {
      const fetchImpl = (async () =>
        new Response(JSON.stringify(okBody([{ guestID: '1' }], 7)), {
          status: 200,
        })) as FetchLike;
      const provider = createCloudbedsProvider({ fetchImpl });
      const res = await provider.callTool(
        'mcp_cloudbeds_search_guests',
        { page: 1, pageSize: 25 },
        ctx(),
      );
      expect(res.kind).toBe('success');
      if (res.kind !== 'success') return;
      expect(res.data).toMatchObject({
        items: [{ guestID: '1' }],
        page: 1,
        pageSize: 25,
        totalResults: 7,
      });
    });
  });

  describe('update_guest', () => {
    it('is sent as PUT — a `put*` method sent as POST is a router-level 404', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_update_guest',
        { guestID: 'G1', guestEmail: 'a@b.com' },
        ctx(),
      );
      expect(seen[0]!.method).toBe('PUT');
      expect(seen[0]!.url).toContain('putGuest');
      expect(seen[0]!.body).toContain('guestID=G1');
      expect(seen[0]!.body).toContain('propertyID=PROP1');
    });

    it('sends only the fields given — an unset field must not be blanked', async () => {
      // `formEncode` drops undefined, so an omitted optional never reaches the wire as "undefined".
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool('mcp_cloudbeds_update_guest', { guestID: 'G1' }, ctx());
      expect(seen[0]!.body).not.toContain('guestFirstName');
      expect(seen[0]!.body).not.toContain('undefined');
    });
  });

  describe('notes', () => {
    it('add_guest_note posts the note and does NOT invent a userID', async () => {
      // The method accepts `userID` ("the actual user posting"). A connection is an app, not a staff
      // member — attributing the note to a person who did not write it would be a small forgery.
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_add_guest_note',
        { guestID: 'G1', guestNote: 'allergic to nuts' },
        ctx(),
      );
      expect(seen[0]!.method).toBe('POST');
      expect(seen[0]!.body).toContain('guestNote=allergic');
      expect(seen[0]!.body).not.toContain('userID');
    });

    it('add_reservation_note posts against the reservation', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_add_reservation_note',
        { reservationID: 'R1', reservationNote: 'late arrival' },
        ctx(),
      );
      expect(seen[0]!.url).toContain('postReservationNote');
      expect(seen[0]!.body).toContain('reservationID=R1');
    });

    it('list_guest_notes reads by guestID', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool('mcp_cloudbeds_list_guest_notes', { guestID: 'G9' }, ctx());
      const qs = new URL(seen[0]!.url).searchParams;
      expect(qs.get('guestID')).toBe('G9');
      expect(qs.get('propertyID')).toBe('PROP1');
    });
  });

  describe('assign_guest_to_room', () => {
    it('assigns and can promote a main guest', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_assign_guest_to_room',
        { reservationID: 'R1', roomID: 42, guestIDs: 'G1,G2', mainGuestId: 'G1' },
        ctx(),
      );
      expect(seen[0]!.body).toContain('roomID=42');
      expect(seen[0]!.body).toContain('mainGuestId=G1');
    });

    it('exposes no removal option — this tool adds, it does not evict', async () => {
      // `postGuestsToRoom` also supports removeGuestIDs / removeAll / removeGuestIDsFromRoom. Leaving
      // them off the schema is the point: removing guests from a room is its own decision, not a flag
      // an agent can reach for mid-sentence. `.strict()` makes the schema reject them outright.
      const provider = createCloudbedsProvider({ fetchImpl: capture().fetchImpl });
      const res = await provider.callTool(
        'mcp_cloudbeds_assign_guest_to_room',
        { reservationID: 'R1', roomID: 1, guestIDs: 'G1', removeAll: true },
        ctx(),
      );
      expect(res.kind).toBe('error'); // rejected by the input schema, never sent
    });
  });
});
