import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { createLobbypmsProvider, lobbypmsProvider } from '../provider';

// Payloads are the documented examples (https://app.lobbypms.com/api, read 2026-10-15) — NOT
// recordings: no live call has been made yet (no sandbox; the property's token and IP allowlist are
// pending). Replace with anonymized recordings after the first read-only session
// (`docs/design/lobbypms-provider/design-notes.md` › Evidence).
const ROOMS = {
  data: [
    {
      category_id: 123456,
      name: 'Double',
      type: 'privada',
      capacity: 2,
      quantity: 5,
      descriptions: [{ description: 'Double room', lang: 'en' }],
      photos: [{ photo_id: 5150, url: 'https://app.lobbypms.com/permanent/uploads/x.jpg' }],
      rooms: [{ id: 469666, name: '101', type: 'privada' }],
    },
  ],
  meta: { total_records: 1, current_page: 1, records_per_page: 50, total_pages: 1 },
};

const AVAILABILITY_V2 = {
  data: [
    {
      date: '2026-11-12',
      categories: [
        {
          category_id: 2523,
          name: 'King',
          available_rooms: 3,
          plans: [
            {
              id: null,
              name: 'STANDARD_RATE',
              prices: [
                { people: 1, value: 320 },
                { people: 2, value: 340 },
              ],
            },
            { id: 1, name: 'Full pack', prices: [{ people: 1, value: 352 }] },
          ],
          restrictions: { min_stay: 0, max_stay: 0, lead_days: 0 },
        },
      ],
    },
  ],
  meta: { total_records: 1, current_page: 1, records_per_page: 50, total_pages: 1 },
};

const TOKEN = 'lobby-secret-api-token';

const CTX: ProviderCallContext = {
  credential: { secret: new SecretString(TOKEN) },
  metadata: { propertyId: '339654' },
};

interface Call {
  url: string;
  method: string;
  body?: string;
}

/** A fetch double that records each request and answers with `body` at `status`. */
function fakeFetch(body: unknown, status = 200) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { impl: impl as unknown as typeof globalThis.fetch, calls };
}

function provider(body: unknown, status = 200) {
  const { impl, calls } = fakeFetch(body, status);
  return { p: createLobbypmsProvider({ fetchImpl: impl }), calls };
}

function data(result: ToolResult): unknown {
  if (result.kind !== 'success') throw new Error(`expected success, got: ${result.message}`);
  return result.data;
}

function failure(result: ToolResult): { code: ProviderErrorCode; message: string } {
  if (result.kind !== 'error') throw new Error('expected an error result');
  return { code: result.code, message: result.message };
}

describe('lobbypms provider — catalog surface', () => {
  it('satisfies the generic provider conformance contract', async () => {
    await runProviderConformance(lobbypmsProvider);
  });

  it('publishes a forwarded api_key descriptor placing api_token in the query string', () => {
    const { auth } = createLobbypmsProvider();
    expect(auth.type).toBe('api_key');
    expect(auth.credentialDelivery).toBe('forwarded');
    if (auth.type === 'api_key') {
      expect(auth.fields).toEqual([{ key: 'api_token', label: 'API Token', placement: 'query' }]);
    }
  });

  it('publishes propertyId as the required context (account identity)', () => {
    const schema = createLobbypmsProvider().contextSchema as { required?: string[] } | undefined;
    expect(schema?.required).toEqual(['propertyId']);
  });

  it('declares list_room_types as the connection probe, and it is on the agent menu', () => {
    const p = createLobbypmsProvider();
    expect(p.manifest.connectionProbe?.tool).toBe('mcp_lobbypms_list_room_types');
    expect(p.listTools().map((t) => t.name)).toContain('mcp_lobbypms_list_room_types');
  });

  it('publishes the reads, prices included; guest data and writes are routable only', () => {
    // Mateo, 2026-10-17 (#147): a hotel's agent may read its PMS's prices. The consumer's own quote
    // stays the recommended path, never the only one.
    const p = createLobbypmsProvider();
    const menu = p.listTools().map((t) => t.name);
    expect(menu.sort()).toEqual([
      'mcp_lobbypms_check_availability',
      'mcp_lobbypms_get_availability_rates',
      'mcp_lobbypms_list_room_types',
    ]);

    const routable = p.routableToolNames();
    for (const name of [
      'list_rate_plans',
      'list_channels',
      'list_document_types',
      'create_customer',
      'create_booking',
      'get_booking',
      'cancel_booking',
      'create_block',
      'delete_block',
      'create_payment_link',
      'list_payment_links',
    ]) {
      expect(routable).toContain(`mcp_lobbypms_${name}`);
      expect(menu).not.toContain(`mcp_lobbypms_${name}`);
    }
  });

  it('has no tool to modify a booking — LobbyPMS cannot (2026-10-13/14)', () => {
    const names = createLobbypmsProvider().routableToolNames();
    expect(names.some((n) => /modify|update|change/.test(n))).toBe(false);
  });
});

describe('lobbypms provider — requests', () => {
  it('list_room_types: GET v1/rooms with the token appended, verbatim payload', async () => {
    const { p, calls } = provider(ROOMS);
    const result = await p.callTool('mcp_lobbypms_list_room_types', {}, CTX);

    expect(data(result)).toEqual(ROOMS);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://api.lobbypms.com/api/v1/rooms');
    expect(url.searchParams.get('api_token')).toBe(TOKEN);
  });

  it('never sends the propertyId to LobbyPMS — it is identity, not routing', async () => {
    const { p, calls } = provider(ROOMS);
    await p.callTool('mcp_lobbypms_list_room_types', { page: 2 }, CTX);
    expect(calls[0]!.url).not.toContain('339654');
    expect(new URL(calls[0]!.url).searchParams.get('page')).toBe('2');
  });

  it('check_availability returns the availability verbatim, prices included', async () => {
    const { p, calls } = provider(AVAILABILITY_V2);
    const result = await p.callTool(
      'mcp_lobbypms_check_availability',
      { start_date: '2026-11-12', end_date: '2026-11-14', category_id: 2523 },
      CTX,
    );

    expect(data(result)).toEqual(AVAILABILITY_V2);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/api/v2/available-rooms');
    expect(url.searchParams.get('start_date')).toBe('2026-11-12');
    expect(url.searchParams.get('end_date')).toBe('2026-11-14');
    expect(url.searchParams.get('category_id')).toBe('2523');
  });

  it('get_availability_rates reads v2 verbatim, prices included', async () => {
    const v2 = { data: [{ date: '2026-11-12', categories: [{ plans: [{ id: null }] }] }] };
    const { p, calls } = provider(v2);
    const result = await p.callTool(
      'mcp_lobbypms_get_availability_rates',
      { start_date: '2026-11-12', end_date: '2026-11-13' },
      CTX,
    );
    expect(data(result)).toEqual(v2);
    expect(new URL(calls[0]!.url).pathname).toBe('/api/v2/available-rooms');
  });

  it('rejects a stay whose end is not after its start, and a date that does not exist', async () => {
    const { p, calls } = provider(AVAILABILITY_V2);
    const same = await p.callTool(
      'mcp_lobbypms_check_availability',
      { start_date: '2026-11-12', end_date: '2026-11-12' },
      CTX,
    );
    const unreal = await p.callTool(
      'mcp_lobbypms_check_availability',
      { start_date: '2026-02-30', end_date: '2026-03-02' },
      CTX,
    );
    expect(failure(same).code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(failure(unreal).code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(calls).toHaveLength(0);
  });

  it('create_booking POSTs the JSON body to v1/bookings and returns the ids verbatim', async () => {
    const created = { data: [{ idBooking: 955088, idRoom: 90546 }], meta: [] };
    const { p, calls } = provider(created, 201);
    const args = {
      category_id: 2523,
      start_date: '2026-11-12',
      end_date: '2026-11-14',
      total_adults: 2,
      holder_name: 'Ana Perez',
      note: 'xcale ref abc',
    };
    const result = await p.callTool('mcp_lobbypms_create_booking', args, CTX);

    expect(data(result)).toEqual(created);
    expect(calls[0]!.method).toBe('POST');
    expect(new URL(calls[0]!.url).pathname).toBe('/api/v1/bookings');
    expect(JSON.parse(calls[0]!.body!)).toEqual(args);
  });

  it('create_booking needs a holder, and a nationality with a document', async () => {
    const { p, calls } = provider({});
    const base = {
      category_id: 1,
      start_date: '2026-11-12',
      end_date: '2026-11-13',
      total_adults: 1,
    };
    const noHolder = await p.callTool('mcp_lobbypms_create_booking', base, CTX);
    const noNationality = await p.callTool(
      'mcp_lobbypms_create_booking',
      { ...base, customer_document: '123' },
      CTX,
    );
    expect(failure(noHolder).code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(failure(noNationality).code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(calls).toHaveLength(0);
  });

  it('create_customer puts the type in the path and the rest in the body', async () => {
    const { p, calls } = provider({ status: 'success' });
    await p.callTool(
      'mcp_lobbypms_create_customer',
      {
        type: 1,
        customer_document: '1234567',
        customer_nationality: 'CO',
        name: 'Ana',
        surname: 'Perez',
      },
      CTX,
    );
    expect(new URL(calls[0]!.url).pathname).toBe('/api/v1/customer/1');
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      customer_document: '1234567',
      customer_nationality: 'CO',
      name: 'Ana',
      surname: 'Perez',
    });
  });

  it('a person needs a surname; a company does not', async () => {
    const { p } = provider({ status: 'success' });
    const person = await p.callTool(
      'mcp_lobbypms_create_customer',
      { type: 1, customer_document: '1', customer_nationality: 'CO', name: 'Ana' },
      CTX,
    );
    const company = await p.callTool(
      'mcp_lobbypms_create_customer',
      { type: 2, customer_document: '900', customer_nationality: 'CO', name: 'ACME SAS' },
      CTX,
    );
    expect(failure(person).code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(company.kind).toBe('success');
  });

  it('get_booking and cancel_booking put the booking id in the path', async () => {
    const got = provider({ data: { id_reserva: 955088 } });
    await got.p.callTool('mcp_lobbypms_get_booking', { booking_id: 955088 }, CTX);
    expect(new URL(got.calls[0]!.url).pathname).toBe('/api/v1/bookings/955088');

    const cancelled = provider({ cancel_booking: 955088 });
    const result = await cancelled.p.callTool(
      'mcp_lobbypms_cancel_booking',
      { booking_id: 955088, cancellation_reason: 'TTC' },
      CTX,
    );
    expect(data(result)).toEqual({ cancel_booking: 955088 });
    expect(new URL(cancelled.calls[0]!.url).pathname).toBe('/api/v1/cancel-booking/955088');
    expect(JSON.parse(cancelled.calls[0]!.body!)).toEqual({ cancellation_reason: 'TTC' });
  });

  it('create_block and delete_block', async () => {
    const block = provider({ blocked_ids: [1], rooms: [{ room_id: 2, block_id: 1 }] });
    await block.p.callTool(
      'mcp_lobbypms_create_block',
      { category_id: 2523, start_date: '2026-11-12', end_date: '2026-11-13', time: 30 },
      CTX,
    );
    expect(new URL(block.calls[0]!.url).pathname).toBe('/api/v1/block');

    const released = provider({ delete_block: true });
    await released.p.callTool('mcp_lobbypms_delete_block', { block_id: 1 }, CTX);
    expect(released.calls[0]!.method).toBe('DELETE');
    expect(new URL(released.calls[0]!.url).pathname).toBe('/api/v1/block/1');
  });

  it('payment links: create posts the body, list needs a booking_id or an id', async () => {
    const created = provider({ id: 'uuid', url: 'https://engine.lobbypms.com/payment/uuid' });
    await created.p.callTool(
      'mcp_lobbypms_create_payment_link',
      { booking_id: 123, amount: 100.5 },
      CTX,
    );
    expect(new URL(created.calls[0]!.url).pathname).toBe('/api/v1/payment/link');

    const listed = provider({ data: [] });
    const empty = await listed.p.callTool('mcp_lobbypms_list_payment_links', {}, CTX);
    expect(failure(empty).code).toBe(ProviderErrorCode.INVALID_INPUT);
    await listed.p.callTool('mcp_lobbypms_list_payment_links', { booking_id: 123 }, CTX);
    expect(new URL(listed.calls[0]!.url).searchParams.get('booking_id')).toBe('123');
  });
});

describe('lobbypms provider — errors', () => {
  it('an unauthorized caller IP is IP_NOT_AUTHORIZED, never "reconnect" (Observed 2026-10-15)', async () => {
    // The observed body, IP anonymized (TEST-NET-3).
    const { p } = provider(
      ['the 203.0.113.7 trying to access the API is not set as a valid ip'],
      403,
    );
    const f = failure(await p.callTool('mcp_lobbypms_list_room_types', {}, CTX));
    expect(f.code).toBe(ProviderErrorCode.PROVIDER_ERROR);
    expect(f.message).toBe('LobbyPMS list room types failed (HTTP 403, IP_NOT_AUTHORIZED)');
    expect(f.message).not.toContain('203.0.113.7');
  });

  it('an unknown booking id is RECORD_NOT_FOUND — LobbyPMS answers an HTML 404 (Observed 2026-10-16)', async () => {
    const { p } = provider('<!DOCTYPE html><title>Page Not Found</title>', 404);
    const f = failure(await p.callTool('mcp_lobbypms_get_booking', { booking_id: 1 }, CTX));
    expect(f.code).toBe(ProviderErrorCode.PROVIDER_ERROR);
    expect(f.message).toBe('LobbyPMS get booking failed (HTTP 404, RECORD_NOT_FOUND)');
  });

  it('a 404 on a list route keeps no business code: it is not a missing record', async () => {
    const { p } = provider('<!DOCTYPE html><title>Page Not Found</title>', 404);
    const f = failure(await p.callTool('mcp_lobbypms_list_channels', {}, CTX));
    expect(f.message).toBe('LobbyPMS list channels failed (HTTP 404)');
  });

  it('a bad token is a 401 Unauthenticated and stays AUTH_EXPIRED (Observed 2026-10-15)', async () => {
    const { p } = provider({ error: 'Unauthenticated.' }, 401);
    const f = failure(await p.callTool('mcp_lobbypms_list_room_types', {}, CTX));
    expect(f.code).toBe(ProviderErrorCode.AUTH_EXPIRED);
  });

  it('401 without a business code is AUTH_EXPIRED (token or IP authorization)', async () => {
    const { p } = provider({ message: 'Unauthenticated.' }, 401);
    const result = await p.callTool('mcp_lobbypms_list_room_types', {}, CTX);
    expect(failure(result).code).toBe(ProviderErrorCode.AUTH_EXPIRED);
  });

  it('UNAUTHORIZED_BOOKING is a refusal, never "reconnect" — whatever its status', async () => {
    for (const status of [401, 403, 422]) {
      const { p } = provider(
        { error_code: 'UNAUTHORIZED_BOOKING', error: 'not created by the API' },
        status,
      );
      const result = await p.callTool(
        'mcp_lobbypms_cancel_booking',
        { booking_id: 1, cancellation_reason: 'TTC' },
        CTX,
      );
      const f = failure(result);
      expect(f.code).toBe(ProviderErrorCode.PROVIDER_ERROR);
      expect(f.message).toContain('UNAUTHORIZED_BOOKING');
    }
  });

  it('names the documented business code in the message, never the free text', async () => {
    const { p } = provider(
      {
        error_code: 'RESTRICTED_RESERVATION',
        error: 'The reservation cannot be canceled, because it has extra payments',
      },
      422,
    );
    const f = failure(
      await p.callTool(
        'mcp_lobbypms_cancel_booking',
        { booking_id: 1, cancellation_reason: 'TTC' },
        CTX,
      ),
    );
    expect(f.code).toBe(ProviderErrorCode.PROVIDER_ERROR);
    expect(f.message).toBe('LobbyPMS cancel booking failed (HTTP 422, RESTRICTED_RESERVATION)');
  });

  it('INPUT_PARAMETERS is INVALID_INPUT', async () => {
    const { p } = provider({ error_code: 'INPUT_PARAMETERS', code: 'bad' }, 422);
    const result = await p.callTool(
      'mcp_lobbypms_create_customer',
      { type: 2, customer_document: '9', customer_nationality: 'CO', name: 'X' },
      CTX,
    );
    expect(failure(result).code).toBe(ProviderErrorCode.INVALID_INPUT);
  });

  it('429 is RATE_LIMITED and 503 is PROVIDER_UNAVAILABLE (the core map)', async () => {
    const limited = provider('Too Many Attempts.', 429);
    const down = provider('maintenance', 503);
    expect(failure(await limited.p.callTool('mcp_lobbypms_list_room_types', {}, CTX)).code).toBe(
      ProviderErrorCode.RATE_LIMITED,
    );
    expect(failure(await down.p.callTool('mcp_lobbypms_list_room_types', {}, CTX)).code).toBe(
      ProviderErrorCode.PROVIDER_UNAVAILABLE,
    );
  });

  it('ignores an error_code that is not a machine code', async () => {
    const { p } = provider({ error_code: 'call me at +57 300 000 0000' }, 400);
    const f = failure(await p.callTool('mcp_lobbypms_list_room_types', {}, CTX));
    expect(f.message).toBe('LobbyPMS list room types failed (HTTP 400)');
  });
});

describe('lobbypms provider — credential containment', () => {
  it('keeps the token out of a transport-failure result', async () => {
    const failing = vi.fn(async (url: string | URL) => {
      throw new Error(`fetch failed for ${String(url)}`);
    }) as unknown as typeof globalThis.fetch;
    const p = createLobbypmsProvider({ fetchImpl: failing });
    const result = await p.callTool('mcp_lobbypms_list_room_types', {}, CTX);
    expect(result.kind).toBe('error');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('keeps the token out of an error body that echoes the URL', async () => {
    const echoing = vi.fn(
      async (url: string | URL) =>
        new Response(JSON.stringify({ error_code: 'INPUT_PARAMETERS', url: String(url) }), {
          status: 422,
        }),
    ) as unknown as typeof globalThis.fetch;
    const p = createLobbypmsProvider({ fetchImpl: echoing });
    const result = await p.callTool('mcp_lobbypms_list_room_types', {}, CTX);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

describe('lobbypms provider — logo', () => {
  it('advertises a logo the gateway actually serves, in the house tile', () => {
    expect(lobbypmsProvider.manifest.logoUrl).toBe('/assets/lobbypms.svg');
    // Served from the repo's assets/ folder by GET /assets/:filename (no auth).
    const file = join(process.cwd(), 'assets', 'lobbypms.svg');
    expect(existsSync(file)).toBe(true);
    const svg = readFileSync(file, 'utf8');
    expect(svg).toContain('viewBox="0 0 35 35"');
    expect(svg).toContain('<rect width="35" height="35" rx="6" fill="#000000"/>');
    expect(svg).not.toMatch(/<script|on\w+=|javascript:/i);
  });
});
