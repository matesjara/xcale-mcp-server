import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import { createCloudbedsProvider } from '../provider';

/**
 * A list read whose success envelope carries no list is "I could not read it", never "there are none"
 * (xcale-mcp-server#193). A false empty answer reads as no reservation / no guest / no group, and a
 * consumer acts on that. Same rule as `get_room_calendar` (`getRatePlans`).
 */
const ctx = {
  credential: { secret: new SecretString('cbat_test0000000000000000000000000') },
  metadata: { propertyID: '20064' },
  request: {},
} as never;

type Outcome = {
  kind: string;
  code?: string;
  message?: string;
  items?: unknown[];
  totalResults?: number;
};

function answering(body: unknown) {
  return createCloudbedsProvider({
    fetchImpl: (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never,
  });
}

const call = (body: unknown, tool: string, args: Record<string, unknown>) =>
  answering(body).callTool(tool, args, ctx) as Promise<Outcome>;

const READS: Array<[tool: string, method: string, args: Record<string, unknown>]> = [
  ['mcp_cloudbeds_list_reservations', 'getReservations', {}],
  ['mcp_cloudbeds_search_guests', 'getGuestList', {}],
  ['mcp_cloudbeds_find_guest_reservations', 'getGuestList', { guestEmail: 'ana@example.com' }],
  ['mcp_cloudbeds_list_groups', 'getGroups', {}],
  ['mcp_cloudbeds_list_group_notes', 'getGroupNotes', { groupCode: 'G1' }],
  ['mcp_cloudbeds_list_room_blocks', 'getRoomBlocks', {}],
  ['mcp_cloudbeds_list_allotment_blocks', 'getAllotmentBlocks', {}],
  [
    'mcp_cloudbeds_list_allotment_block_notes',
    'listAllotmentBlockNotes',
    { allotmentBlockCode: 'A1' },
  ],
];

describe.each(READS)('%s', (tool, method, args) => {
  it.each([
    ['data is an object', { success: true, data: { canary: 'zz-raw-body' } }],
    ['the envelope has no data field', { success: true, total: 0 }],
    ['data is null', { success: true, data: null }],
  ])('answers a provider error naming %s when %s', async (_n, body) => {
    const res = await call(body, tool, args);
    expect(res.kind).toBe('error');
    expect(res.code).toBe(ProviderErrorCode.PROVIDER_ERROR);
    expect(res.message).toContain(method);
    expect(res.message).not.toContain('zz-raw-body');
    expect(res.items).toBeUndefined();
  });

  it('still answers an empty list for a real empty page', async () => {
    const res = await call({ success: true, data: [], total: 0 }, tool, args);
    expect(res.kind).not.toBe('error');
    expect(res.items ?? []).toEqual([]);
  });
});
