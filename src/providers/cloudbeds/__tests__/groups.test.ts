import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import { createCloudbedsProvider } from '../provider';

const ctx = (metadata: Record<string, unknown> = { propertyID: 'PROP1' }) => ({
  credential: { secret: new SecretString('tok') },
  metadata,
});

function capture() {
  const seen: { url: string; method: string; body: string }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    seen.push({
      url: url.toString(),
      method: init?.method ?? 'GET',
      body: init?.body ? String(init.body) : '',
    });
    return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
  }) as FetchLike;
  return { seen, fetchImpl };
}

describe('cloudbeds group tools', () => {
  describe('the HTTP verb is NOT derivable from the method name', () => {
    /**
     * The trap this pins. `client.ts` used to assert, as a rule: "Cloudbeds maps the method-name prefix
     * to the HTTP verb — a `put*` method sent as POST is a router-level 404". The 404 was real, observed
     * on `putReservation`; the RULE was a generalisation from that single case, and the published spec
     * refutes it:
     *
     *   putReservation · putGuest · putRoomBlock · putGuestNote · putReservationNote → PUT
     *   putGroup · putRate · putAppPropertySettings · patchGroup · patchRate         → POST
     *
     * So following our own documented rule would 404 five methods. These two tests are the fence.
     */
    it('update_group goes out as POST — patchGroup is a POST endpoint despite the name', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_update_group',
        { groupCode: 'G1', name: 'Boda Perez' },
        ctx(),
      );
      expect(seen[0]!.url).toContain('patchGroup');
      expect(seen[0]!.method).toBe('POST');
      expect(seen[0]!.method).not.toBe('PUT');
      expect(seen[0]!.body).toContain('groupCode=G1');
      expect(seen[0]!.body).toContain('propertyID=PROP1');
    });

    it('…while modify_reservation still goes out as PUT', async () => {
      // The counterexample, kept next to it: the two really do differ, so neither is a typo.
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_modify_reservation',
        { reservationID: 'R1', status: 'canceled' },
        ctx(),
      );
      expect(seen[0]!.url).toContain('putReservation');
      expect(seen[0]!.method).toBe('PUT');
    });
  });

  describe('list_groups', () => {
    it('paginates and forwards the filters', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_list_groups',
        { page: 2, pageSize: 10, status: 'active' },
        ctx(),
      );
      const qs = new URL(seen[0]!.url).searchParams;
      expect(seen[0]!.url).toContain('getGroups');
      expect(qs.get('propertyID')).toBe('PROP1');
      expect(qs.get('pageNumber')).toBe('2');
      expect(qs.get('pageSize')).toBe('10');
      expect(qs.get('status')).toBe('active');
    });
  });

  describe('list_group_notes', () => {
    it('always sends pageSize/pageNumber — the spec makes them REQUIRED here', async () => {
      // Unlike every other list, getGroupNotes rejects a call without paging. The uniform contract
      // supplies both by default, so the tool cannot omit them even if the caller says nothing.
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool('mcp_cloudbeds_list_group_notes', { groupCode: 'G1' }, ctx());
      const qs = new URL(seen[0]!.url).searchParams;
      expect(qs.get('groupCode')).toBe('G1');
      expect(qs.get('pageNumber')).toBe('1');
      expect(qs.get('pageSize')).toBe('25');
    });
  });

  describe('add_group_note', () => {
    it('posts the note against the group', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_add_group_note',
        { groupCode: 'G1', groupNote: 'llegan en bus a las 14h' },
        ctx(),
      );
      expect(seen[0]!.method).toBe('POST');
      expect(seen[0]!.url).toContain('postGroupNote');
      // Parse the form body rather than matching the raw string: URLSearchParams encodes spaces as
      // `+`, and decodeURIComponent does NOT turn those back into spaces.
      const body = new URLSearchParams(seen[0]!.body);
      expect(body.get('groupNote')).toBe('llegan en bus a las 14h');
      expect(body.get('groupCode')).toBe('G1');
    });
  });

  it('closes the last SCOPE DENIED in the live coverage probe', () => {
    // `read:group` was the one method still denied against property 320754 — denied precisely because
    // its tools did not exist, so its scope was never requested. Building them requests it.
    const auth = createCloudbedsProvider().auth;
    if (auth.type !== 'oauth2') throw new Error('expected oauth2');
    expect(auth.scopes).toContain('read:group');
    expect(auth.scopes).toContain('write:group');
  });
});
