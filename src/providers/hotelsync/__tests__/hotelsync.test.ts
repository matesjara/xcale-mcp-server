import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../../../core/catalog';
import { ProviderErrorCode } from '../../../core/errors';
import { createRegistry } from '../../../core/registry';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import type { ProviderCallContext } from '../../../core/types';
import { createHotelSyncProvider, hotelsyncProvider } from '../provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Captured {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
}

/** Fixtures are the OpenAPI's 200 examples (see __fixtures__/README.md), not recordings. */
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '..', '__fixtures__', name), 'utf8'));

/** A fake `fetch` that records each request and answers with a canned status and body. */
function fakeFetch(opts: { status?: number; body?: unknown; capture?: Captured[] }): typeof fetch {
  const status = opts.status ?? 200;
  return (async (url: string, init: Captured['init']) => {
    opts.capture?.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => opts.body ?? {},
      text: async () =>
        typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? ''),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

/** The resolved credential a `reference` resolve yields: the session key plus the partner token. */
const ctx: ProviderCallContext = {
  credential: {
    secret: new SecretString('SESSION-PKEY'),
    companions: { partnerToken: new SecretString('PARTNER-TOKEN') },
  },
  metadata: { id_properties: 'PROP-1' },
};

async function call(
  tool: string,
  args: Record<string, unknown>,
  opts: { status?: number; body?: unknown; baseUrl?: string } = {},
) {
  const capture: Captured[] = [];
  const provider = createHotelSyncProvider({
    fetchImpl: fakeFetch({ ...opts, capture }),
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
  });
  const result = await provider.callTool(`mcp_hotelsync_${tool}`, args, ctx);
  const sent = capture[0];
  return {
    result,
    sent,
    body: sent?.init.body ? (JSON.parse(sent.init.body) as Record<string, unknown>) : undefined,
  };
}

const MENU = [
  'mcp_hotelsync_check_availability',
  'mcp_hotelsync_get_property',
  'mcp_hotelsync_list_rate_plans',
  'mcp_hotelsync_list_restrictions',
  'mcp_hotelsync_list_room_types',
];
const BACKEND_ONLY = [
  'mcp_hotelsync_cancel_reservation',
  'mcp_hotelsync_create_reservation',
  'mcp_hotelsync_delete_webhook',
  'mcp_hotelsync_get_prices',
  'mcp_hotelsync_get_reservation',
  'mcp_hotelsync_list_webhooks',
  'mcp_hotelsync_modify_reservation',
  'mcp_hotelsync_quote_room_type',
  'mcp_hotelsync_register_webhook',
  'mcp_hotelsync_search_reservations',
];

// ---------------------------------------------------------------------------
// Contract shape
// ---------------------------------------------------------------------------

describe('hotelsync provider — shape', () => {
  it('passes provider conformance', async () => {
    await runProviderConformance(hotelsyncProvider);
  });

  it('the agent menu is the money-free reads; prices, reservations and webhooks are backend-only', () => {
    expect(
      hotelsyncProvider
        .listTools()
        .map((t) => t.name)
        .sort(),
    ).toEqual(MENU);
    expect([...hotelsyncProvider.routableToolNames()].sort()).toEqual(
      [...MENU, ...BACKEND_ONLY].sort(),
    );
  });

  it('publishes the session-key-in-body credential_exchange descriptor (names only)', () => {
    const [entry] = buildCatalog(createRegistry([hotelsyncProvider]));
    expect(entry?.authDescriptor).toMatchObject({
      type: 'credential_exchange',
      credentialDelivery: 'reference',
      tokenEndpoint: 'https://app.hotelsync.com/api/user/auth/login',
      bodyFields: { partnerToken: 'token', username: 'username', password: 'password' },
      responseFields: { token: 'pkey' },
      tokenPlacement: 'body',
      tokenBodyField: 'key',
      bodyCompanions: { partnerToken: 'token' },
    });
    expect(entry?.authDescriptor).not.toHaveProperty('responseFields.expiry');
  });

  it('proves a connection with a no-argument property read', () => {
    expect(hotelsyncProvider.manifest.connectionProbe).toEqual({
      tool: 'mcp_hotelsync_get_property',
    });
    const probe = hotelsyncProvider
      .listTools()
      .find((t) => t.name === 'mcp_hotelsync_get_property');
    expect(probe?.inputSchema).toMatchObject({ properties: {} });
  });

  it('ships its logo', () => {
    expect(hotelsyncProvider.manifest.logoUrl).toBe('/assets/hotelsync.svg');
    expect(existsSync(join(process.cwd(), 'assets', 'hotelsync.svg'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The wire: one JSON POST, auth in the body, the property from the context
// ---------------------------------------------------------------------------

describe('hotelsync provider — requests', () => {
  it('reads go to production by default as JSON POSTs with key, token and the property in the body', async () => {
    const { result, sent, body } = await call(
      'get_property',
      {},
      { body: fixture('property.json') },
    );
    expect(result).toMatchObject({ kind: 'success', data: fixture('property.json') });
    expect(sent?.url).toBe('https://app.hotelsync.com/api/property/data/property');
    expect(sent?.init.method).toBe('POST');
    expect(body).toEqual({ id_properties: 'PROP-1', key: 'SESSION-PKEY', token: 'PARTNER-TOKEN' });
    expect(JSON.stringify(sent?.init.headers)).not.toMatch(/SESSION-PKEY|PARTNER-TOKEN/);
    expect(sent?.url).not.toMatch(/SESSION-PKEY|PARTNER-TOKEN/);
  });

  it.each([
    ['list_room_types', { details: true }, '/api/room/data/rooms', { details: 1 }, 'rooms.json'],
    ['list_rate_plans', {}, '/api/pricingPlan/data/pricing_plans', {}, 'pricing-plans.json'],
    [
      'check_availability',
      { dfrom: '2026-12-12', dto: '2026-12-15' },
      '/api/avail/data/avail',
      { dfrom: '2026-12-12', dto: '2026-12-15' },
      'avail.json',
    ],
    [
      'list_restrictions',
      { id_restriction_plans: 193, dfrom: '2026-12-12', dto: '2026-12-15' },
      '/api/restrictions/data/restrictions',
      { id_restriction_plans: 193, dfrom: '2026-12-12', dto: '2026-12-15' },
      'restrictions.json',
    ],
    [
      'get_prices',
      { id_pricing_plans: 11029, dfrom: '2026-12-12', dto: '2026-12-15' },
      '/api/prices/data/prices',
      { id_pricing_plans: 11029, dfrom: '2026-12-12', dto: '2026-12-15' },
      'prices.json',
    ],
    [
      'get_reservation',
      { id_reservations: 606308 },
      '/api/reservation/data/reservation',
      { id_reservations: 606308 },
      'reservation.json',
    ],
    ['list_webhooks', {}, '/api/webhooks/data/webhooks', {}, 'webhooks.json'],
  ])('%s → %s, data verbatim', async (tool, args, path, sentArgs, fx) => {
    const { result, sent, body } = await call(tool, args, { body: fixture(fx) });
    expect(sent?.url).toBe(`https://app.hotelsync.com${path}`);
    expect(body).toEqual({
      ...sentArgs,
      id_properties: 'PROP-1',
      key: 'SESSION-PKEY',
      token: 'PARTNER-TOKEN',
    });
    expect(result).toMatchObject({ kind: 'success', data: fixture(fx) });
  });

  it('quotes a room type for a stay and a guest composition', async () => {
    const args = {
      id_room_types: 172,
      id_pricing_plans: 11029,
      dfrom: '2026-12-12',
      dto: '2026-12-15',
      adults: 2,
      children_1: 1,
    };
    const { sent, body } = await call('quote_room_type', args);
    expect(sent?.url).toBe(
      'https://app.hotelsync.com/api/prices/data/reservation_room_type_prices',
    );
    expect(body).toMatchObject(args);
  });

  it('no tool takes the property as input — the context is the only source', async () => {
    const { result, sent } = await call('get_property', { id_properties: 'OTHER' });
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(sent).toBeUndefined();
  });

  it('a passthrough write cannot redirect the call to another property', async () => {
    const { body } = await call('modify_reservation', {
      reservation: { id_reservations: 606308, id_properties: 'OTHER', note: 'late arrival' },
    });
    expect(body?.id_properties).toBe('PROP-1');
  });

  it('runs against staging when configured', async () => {
    const { sent } = await call('list_rate_plans', {}, { baseUrl: 'https://beta.hotelsync.com/' });
    expect(sent?.url).toBe('https://beta.hotelsync.com/api/pricingPlan/data/pricing_plans');
  });

  it('refuses any host but HotelSync production and staging', () => {
    for (const baseUrl of [
      'https://evil.example.com',
      'http://app.hotelsync.com',
      'https://app.hotelsync.com.evil.example',
    ]) {
      expect(() => createHotelSyncProvider({ baseUrl })).toThrow(/not an allowed HotelSync host/);
    }
  });
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

describe('hotelsync provider — writes', () => {
  const reservation = {
    date_arrival: '2026-12-12',
    date_departure: '2026-12-15',
    id_pricing_plans: 11029,
    status: 'confirmed',
    rooms: [{ id_room_types: 172, adults: 2, total_price: 540 }],
    guests: [{ first_name: 'Ana', last_name: 'Pérez', guest_type: 'adults' }],
    id_channels: '1',
    total_price: 540,
  };

  it('creates a reservation, passing every field through', async () => {
    const { sent, body } = await call('create_reservation', reservation, {
      body: { id_reservations: 1232359 },
    });
    expect(sent?.url).toBe('https://app.hotelsync.com/api/reservation/insert/reservation');
    expect(body).toMatchObject({ ...reservation, id_properties: 'PROP-1' });
  });

  it.each([
    ['a stay with no nights', { ...reservation, date_departure: '2026-12-12' }],
    ['a date that does not exist', { ...reservation, date_arrival: '2026-02-30' }],
    ['no room', { ...reservation, rooms: [] }],
    ['no guest', { ...reservation, guests: [] }],
  ])('rejects %s before calling HotelSync', async (_, args) => {
    const { result, sent } = await call('create_reservation', args);
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(sent).toBeUndefined();
  });

  it('cancels with a reason', async () => {
    const { sent, body } = await call('cancel_reservation', {
      id_reservations: 606308,
      reason: 'Guest asked to cancel',
    });
    expect(sent?.url).toBe('https://app.hotelsync.com/api/reservation/delete/delete');
    expect(body).toMatchObject({ id_reservations: 606308, reason: 'Guest asked to cancel' });
  });

  it('registers only an https webhook URL', async () => {
    const ok = await call('register_webhook', { url: 'https://api.example.com/hooks/s3cr3t' });
    expect(ok.body).toMatchObject({ url: 'https://api.example.com/hooks/s3cr3t' });
    const plain = await call('register_webhook', { url: 'http://api.example.com/hooks/x' });
    expect(plain.result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(plain.sent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('hotelsync provider — errors', () => {
  it('401 "Session key invalid" → PROVIDER_AUTH_EXPIRED (the consumer re-logs in and retries once)', async () => {
    const { result } = await call('get_property', {}, { status: 401, body: 'Session key invalid' });
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
    expect(result.kind === 'error' && result.message).toMatch(/the session ended/);
  });

  it('403 on a read → PROVIDER_AUTH_EXPIRED (re-entering the connection fixes it)', async () => {
    const { result } = await call(
      'list_room_types',
      {},
      { status: 403, body: 'No access to property' },
    );
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
    expect(result.kind === 'error' && result.message).toMatch(
      /cannot access the connected property/,
    );
  });

  it('a read-only token refusing a write → PROVIDER_ERROR, not a dead connection', async () => {
    const { result } = await call(
      'cancel_reservation',
      { id_reservations: 1, reason: 'x' },
      { status: 403, body: 'Token has read only access' },
    );
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
  });

  it('an unknown error body is never echoed', async () => {
    const { result } = await call(
      'get_property',
      {},
      { status: 400, body: 'weird internal detail SESSION-PKEY' },
    );
    expect(result.kind).toBe('error');
    expect(result.kind === 'error' && result.message).toBe(
      'HotelSync get property failed (HTTP 400)',
    );
  });
});
