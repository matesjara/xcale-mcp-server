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

describe('cloudbeds revenue / inventory tools', () => {
  describe('get_dashboard', () => {
    it('reads the property’s day, omitting the date when not given', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool('mcp_cloudbeds_get_dashboard', {}, ctx());
      const qs = new URL(seen[0]!.url).searchParams;
      expect(seen[0]!.url).toContain('getDashboard');
      expect(qs.get('propertyID')).toBe('PROP1');
      // Absent, not "undefined": the provider defaults to its own today, which is the property's
      // timezone — a date we invent here would be our clock's, and could be the wrong day.
      expect(qs.has('date')).toBe(false);
    });

    it('forwards an explicit date', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool('mcp_cloudbeds_get_dashboard', { date: '2026-09-14' }, ctx());
      expect(new URL(seen[0]!.url).searchParams.get('date')).toBe('2026-09-14');
    });
  });

  describe('list_room_blocks', () => {
    it('paginates through the uniform contract', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_list_room_blocks',
        { page: 2, pageSize: 5, roomTypeID: 'RT1' },
        ctx(),
      );
      const qs = new URL(seen[0]!.url).searchParams;
      expect(qs.get('pageNumber')).toBe('2');
      expect(qs.get('pageSize')).toBe('5');
      expect(qs.get('roomTypeID')).toBe('RT1');
    });
  });

  describe('create_room_block', () => {
    it('encodes rooms PHP-style, the shape the sandbox proved for create_reservation', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_create_room_block',
        {
          roomBlockType: 'out_of_service',
          roomBlockReason: 'burst pipe',
          startDate: '2026-09-14',
          endDate: '2026-09-16',
          rooms: [
            { roomID: '1', roomTypeID: 'RT1' },
            { roomID: '2', roomTypeID: 'RT1' },
          ],
        },
        ctx(),
      );
      expect(seen[0]!.method).toBe('POST');
      const body = decodeURIComponent(seen[0]!.body);
      expect(body).toContain('rooms[0][roomID]=1');
      expect(body).toContain('rooms[1][roomID]=2');
      expect(body).toContain('propertyID=PROP1');
    });

    it('rejects a block type Cloudbeds does not define', async () => {
      // The enum is the provider's, not ours: blocked_dates | out_of_service | courtesy_hold.
      const provider = createCloudbedsProvider({ fetchImpl: capture().fetchImpl });
      const res = await provider.callTool(
        'mcp_cloudbeds_create_room_block',
        {
          roomBlockType: 'maintenance',
          roomBlockReason: 'x',
          startDate: '2026-09-14',
          endDate: '2026-09-16',
          rooms: [{ roomID: '1', roomTypeID: 'RT1' }],
        },
        ctx(),
      );
      expect(res.kind).toBe('error'); // rejected by the schema, never sent
    });

    it('refuses a block with no rooms', async () => {
      const provider = createCloudbedsProvider({ fetchImpl: capture().fetchImpl });
      const res = await provider.callTool(
        'mcp_cloudbeds_create_room_block',
        {
          roomBlockType: 'blocked_dates',
          roomBlockReason: 'x',
          startDate: '2026-09-14',
          endDate: '2026-09-16',
          rooms: [],
        },
        ctx(),
      );
      expect(res.kind).toBe('error');
    });
  });

  describe('update_room_block', () => {
    it('is sent as PUT', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_update_room_block',
        { roomBlockID: 'RB1', roomBlockReason: 'fixed' },
        ctx(),
      );
      expect(seen[0]!.method).toBe('PUT');
      expect(seen[0]!.url).toContain('putRoomBlock');
    });
  });

  describe('list_allotment_blocks', () => {
    it('paginates and filters', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_list_allotment_blocks',
        { page: 1, pageSize: 10, groupCode: 'GRP1' },
        ctx(),
      );
      const qs = new URL(seen[0]!.url).searchParams;
      expect(qs.get('groupCode')).toBe('GRP1');
      expect(qs.get('pageSize')).toBe('10');
    });
  });

  it('publishes no allotment WRITE tool yet — the spec contradicts itself there', () => {
    // `createAllotmentBlockNotes`/`updateAllotmentBlockNotes` are POST but declared under
    // **read**:allotmentBlock. Copying that blind would put the provider's own error into our
    // contract, and `requiredScopes` is the field a wrong copy corrupts. Observe first.
    const names = createCloudbedsProvider()
      .listTools()
      .map((t) => t.name);
    expect(names).toContain('mcp_cloudbeds_list_allotment_blocks');
    expect(names.some((n) => /allotment.*(note|create|update)/i.test(n))).toBe(false);

    const auth = createCloudbedsProvider().auth;
    if (auth.type !== 'oauth2') throw new Error('expected oauth2');
    // Not built ⇒ not requested. That is the derivation doing the bookkeeping for us.
    expect(auth.scopes).not.toContain('write:allotmentBlock');
  });
});
