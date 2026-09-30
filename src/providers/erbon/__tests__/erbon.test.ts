import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import type { ProviderCallContext } from '../../../core/types';
import { SecretString } from '../../../core/secret-string';
import { createErbonProvider, erbonProvider } from '../provider';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface Captured {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
}

/** A fake `fetch` that records the request and returns a canned JSON body / status. */
function fakeFetch(opts: { status?: number; body?: unknown; capture?: Captured[] }): typeof fetch {
  const status = opts.status ?? 200;
  const okFlag = status >= 200 && status < 300;
  return (async (url: string, init: Captured['init']) => {
    opts.capture?.push({ url, init });
    return {
      ok: okFlag,
      status,
      json: async () => opts.body ?? {},
      text: async () =>
        typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? ''),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const ctx: ProviderCallContext = {
  credential: { secret: new SecretString('minted-jwt') },
  metadata: { hotelID: 'H1' },
};

// Recorded sandbox shapes (see docs/design/erbon-read-only-provider/sandbox-evidence.md).
const AVAILABILITY = [
  { date: '2026-10-20', roomTypeDescription: 'SUITE ESTANDAR', statusAvailability: 8 },
  { date: '2026-10-20', roomTypeDescription: 'SUITE JUNIOR', statusAvailability: 12 },
];
const ROOM_TYPES = [
  { id: 2, code: 'STD', description: 'SUITE ESTANDAR', minPax: 1, maxPax: 2, roomCount: 8 },
];
const RATES = [
  {
    id: 3,
    code: 'Estandar RC-Channel',
    description: 'Estandar RC-Channel',
    allowRO: true,
    allowBB: true,
  },
];

// ---------------------------------------------------------------------------
// S1 — foundation & discovery
// ---------------------------------------------------------------------------

describe('erbon provider — S1 discovery shape', () => {
  it('is identified as the erbon hospitality provider', () => {
    expect(erbonProvider.manifest.slug).toBe('erbon');
    expect(erbonProvider.manifest.displayName).toBe('Erbon');
    expect(erbonProvider.manifest.category).toBe('hospitality');
    expect(erbonProvider.manifest.providerVersion.length).toBeGreaterThan(0);
    expect(erbonProvider.manifest.schemaVersion.length).toBeGreaterThan(0);
  });

  it('publishes credential_exchange auth minted from /auth/login with reference delivery', () => {
    const auth = erbonProvider.auth;
    expect(auth.type).toBe('credential_exchange');
    if (auth.type !== 'credential_exchange') throw new Error('unreachable');
    expect(auth.credentialDelivery).toBe('reference');
    expect(auth.tokenEndpoint).toBe('https://api.erbonsoftware.com/auth/login');
    expect(auth.method).toBe('POST');
    expect(auth.bodyFields).toEqual({ username: 'username', password: 'password' });
    expect(auth.responseFields.token).toBe('bearerToken');
    expect(auth.responseFields.expiry).toBe('expirationUTCDate');
    expect(auth.tokenPlacement).toBe('bearer_header');
  });

  it('identifies the hotel via a contextSchema requiring hotelID', () => {
    const schema = erbonProvider.contextSchema as
      | { properties?: Record<string, unknown>; required?: readonly string[] }
      | undefined;
    expect(schema).toBeDefined();
    expect(schema?.properties?.hotelID).toBeDefined();
    expect(schema?.required).toContain('hotelID');
  });

  it('declares no connectionProbe / contextDiscovery / alternative connect methods', () => {
    expect(erbonProvider.manifest.connectionProbe).toBeUndefined();
    expect(erbonProvider.manifest.contextDiscovery).toBeUndefined();
    expect(erbonProvider.additionalAuth).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S2 — the four menu reads
// ---------------------------------------------------------------------------

describe('erbon provider — S2 menu reads', () => {
  it('publishes exactly the four money-free reads on the agent menu', () => {
    const names = erbonProvider.listTools().map((t) => t.name);
    expect(new Set(names)).toEqual(
      new Set([
        'mcp_erbon_check_availability',
        'mcp_erbon_list_room_types',
        'mcp_erbon_list_rates',
        'mcp_erbon_get_hotel',
      ]),
    );
  });

  it('check_availability sends dates in headers, scopes the path to hotelID, returns rows verbatim', async () => {
    const capture: Captured[] = [];
    const provider = createErbonProvider({ fetchImpl: fakeFetch({ body: AVAILABILITY, capture }) });
    const res = await provider.callTool(
      'mcp_erbon_check_availability',
      { checkinDate: '2026-10-20', checkoutDate: '2026-10-23' },
      ctx,
    );
    expect(res.kind).toBe('success');
    if (res.kind === 'success') expect(res.data).toEqual(AVAILABILITY);
    expect(capture[0]?.url).toContain('/hotel/H1/availability');
    expect(capture[0]?.init.headers?.checkinDate).toBe('2026-10-20');
    expect(capture[0]?.init.headers?.checkoutDate).toBe('2026-10-23');
  });

  it('list_room_types reads mapping/roomtype for the hotel, verbatim', async () => {
    const capture: Captured[] = [];
    const provider = createErbonProvider({ fetchImpl: fakeFetch({ body: ROOM_TYPES, capture }) });
    const res = await provider.callTool('mcp_erbon_list_room_types', {}, ctx);
    expect(res.kind).toBe('success');
    if (res.kind === 'success') expect(res.data).toEqual(ROOM_TYPES);
    expect(capture[0]?.url).toContain('/hotel/H1/mapping/roomtype');
  });

  it('list_rates reads mapping/rates for the hotel, verbatim', async () => {
    const capture: Captured[] = [];
    const provider = createErbonProvider({ fetchImpl: fakeFetch({ body: RATES, capture }) });
    const res = await provider.callTool('mcp_erbon_list_rates', {}, ctx);
    expect(res.kind).toBe('success');
    if (res.kind === 'success') expect(res.data).toEqual(RATES);
    expect(capture[0]?.url).toContain('/hotel/H1/mapping/rates');
  });

  it('get_hotel reads /hotel/{hotelID} with no trailing path segment', async () => {
    const capture: Captured[] = [];
    const provider = createErbonProvider({
      fetchImpl: fakeFetch({ body: { name: 'Hotel X' }, capture }),
    });
    const res = await provider.callTool('mcp_erbon_get_hotel', {}, ctx);
    expect(res.kind).toBe('success');
    expect(capture[0]?.url).toMatch(/\/hotel\/H1$/);
  });

  it('rejects a non-ISO checkinDate as INVALID_INPUT before any request', async () => {
    const capture: Captured[] = [];
    const provider = createErbonProvider({ fetchImpl: fakeFetch({ body: AVAILABILITY, capture }) });
    const res = await provider.callTool(
      'mcp_erbon_check_availability',
      { checkinDate: '2026/10/20', checkoutDate: '2026-10-23' },
      ctx,
    );
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(capture.length).toBe(0);
  });

  it('maps a 401 from Erbon to PROVIDER_AUTH_EXPIRED', async () => {
    const provider = createErbonProvider({
      fetchImpl: fakeFetch({ status: 401, body: 'unauthorized' }),
    });
    const res = await provider.callTool('mcp_erbon_list_rates', {}, ctx);
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.AUTH_EXPIRED);
  });
});

// ---------------------------------------------------------------------------
// S3 — the money guard (get_rate_prices is backend-only)
// ---------------------------------------------------------------------------

describe('erbon provider — S3 money guard', () => {
  it('keeps get_rate_prices OFF the agent menu but routable by the backend', () => {
    const menu = erbonProvider.listTools().map((t) => t.name);
    expect(menu).not.toContain('mcp_erbon_get_rate_prices');
    expect(erbonProvider.routableToolNames()).toContain('mcp_erbon_get_rate_prices');
  });

  it('get_rate_prices reads mapping/rateprices with dates + ids in headers, verbatim', async () => {
    const PRICES = [
      {
        id: 157308,
        idRoomType: 2,
        idRate: 1,
        date: '2026-09-29',
        priceRO: 346.0,
        priceBB: 396.0,
        priceHB: 446.0,
        priceFB: 496.0,
        priceAI: 546.0,
        currencyCode: 'COP',
      },
    ];
    const capture: Captured[] = [];
    const provider = createErbonProvider({ fetchImpl: fakeFetch({ body: PRICES, capture }) });
    const res = await provider.callTool(
      'mcp_erbon_get_rate_prices',
      { dateFrom: '2026-10-20', dateTo: '2026-10-23', idRate: 3, idRoomType: 2 },
      ctx,
    );
    expect(res.kind).toBe('success');
    if (res.kind === 'success') expect(res.data).toEqual(PRICES);
    expect(capture[0]?.url).toContain('/hotel/H1/mapping/rateprices');
    expect(capture[0]?.init.headers?.dateFrom).toBe('2026-10-20');
    expect(capture[0]?.init.headers?.idRate).toBe('3');
    expect(capture[0]?.init.headers?.idRoomType).toBe('2');
  });

  it('returns an empty array verbatim when the hotel has no prices loaded (sandbox reality)', async () => {
    const provider = createErbonProvider({ fetchImpl: fakeFetch({ body: [] }) });
    const res = await provider.callTool(
      'mcp_erbon_get_rate_prices',
      { dateFrom: '2026-10-20', dateTo: '2026-10-23', idRate: 3, idRoomType: 2 },
      ctx,
    );
    expect(res.kind).toBe('success');
    if (res.kind === 'success') expect(res.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S4 — conformance & error mapping
// ---------------------------------------------------------------------------

describe('erbon provider — S4 conformance & errors', () => {
  it('satisfies the generic provider conformance contract', async () => {
    await runProviderConformance(erbonProvider);
  });

  it('maps a 429 to PROVIDER_RATE_LIMITED and a 500 to PROVIDER_UNAVAILABLE', async () => {
    const limited = createErbonProvider({
      fetchImpl: fakeFetch({ status: 429, body: 'slow down' }),
    });
    const r1 = await limited.callTool('mcp_erbon_list_rates', {}, ctx);
    expect(r1.kind).toBe('error');
    if (r1.kind === 'error') expect(r1.code).toBe(ProviderErrorCode.RATE_LIMITED);

    const down = createErbonProvider({ fetchImpl: fakeFetch({ status: 500, body: 'boom' }) });
    const r2 = await down.callTool('mcp_erbon_list_rates', {}, ctx);
    expect(r2.kind).toBe('error');
    if (r2.kind === 'error') expect(r2.code).toBe(ProviderErrorCode.PROVIDER_UNAVAILABLE);
  });

  it('requires hotelID context (missing metadata → INVALID_INPUT, no request made)', async () => {
    const capture: Captured[] = [];
    const provider = createErbonProvider({ fetchImpl: fakeFetch({ body: [], capture }) });
    const res = await provider.callTool(
      'mcp_erbon_list_rates',
      {},
      {
        credential: { secret: new SecretString('tok') },
      },
    );
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(capture.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// S5 — create_booking (backend-only write)
// ---------------------------------------------------------------------------

const VALID_BOOKING = {
  checkInDate: '2026-09-29',
  checkOutDate: '2026-09-30',
  idRoomTypeReserved: 2,
  idRoomTypeOccupied: 2,
  idRate: 1,
  idConfigPension: 'BB' as const,
  numberAdults: 2,
  ratePrices: [{ date: '2026-09-29', price: 270 }],
  guests: [{ idGuest: 29, isHolder: true }],
};

describe('erbon provider — S5 create_booking (write)', () => {
  it('is backend-only: withdrawn from the agent menu, present in routableToolNames', () => {
    expect(erbonProvider.listTools().map((t) => t.name)).not.toContain('mcp_erbon_create_booking');
    expect(erbonProvider.routableToolNames()).toContain('mcp_erbon_create_booking');
  });

  it('POSTs booking/new with the args as a JSON body, scoped to hotelID, verbatim', async () => {
    const capture: Captured[] = [];
    const provider = createErbonProvider({
      fetchImpl: fakeFetch({ body: { bookingInternalID: 999 }, capture }),
    });
    const res = await provider.callTool(
      'mcp_erbon_create_booking',
      { ...VALID_BOOKING, voucher: 'api123' },
      ctx,
    );
    expect(res.kind).toBe('success');
    if (res.kind === 'success') expect(res.data).toEqual({ bookingInternalID: 999 });
    expect(capture[0]?.init.method).toBe('POST');
    expect(capture[0]?.url).toMatch(/\/hotel\/H1\/booking\/new$/);
    expect(capture[0]?.init.headers?.['content-type']).toBe('application/json');
    const body = JSON.parse(capture[0]?.init.body ?? '{}');
    expect(body.idConfigPension).toBe('BB');
    expect(body.guests).toEqual([{ idGuest: 29, isHolder: true }]);
    expect(body.voucher).toBe('api123');
  });

  it('rejects a booking with no guests as INVALID_INPUT before any request', async () => {
    const capture: Captured[] = [];
    const provider = createErbonProvider({ fetchImpl: fakeFetch({ body: {}, capture }) });
    const res = await provider.callTool(
      'mcp_erbon_create_booking',
      { ...VALID_BOOKING, guests: [] },
      ctx,
    );
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(capture.length).toBe(0);
  });

  it('maps a non-2xx Erbon response on the write path to a typed error (400 → INVALID_INPUT)', async () => {
    const provider = createErbonProvider({
      fetchImpl: fakeFetch({ status: 400, body: 'ERR_BOOKING_INVALID' }),
    });
    const res = await provider.callTool('mcp_erbon_create_booking', VALID_BOOKING, ctx);
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.INVALID_INPUT);
  });
});

// ---------------------------------------------------------------------------
// S6 — guest tools + the full menu/routable split
// ---------------------------------------------------------------------------

describe('erbon provider — S6 guest tools', () => {
  it('the agent menu is exactly the 4 reads; every money/write tool is routable-only', () => {
    const menu = erbonProvider.listTools().map((t) => t.name);
    expect(new Set(menu)).toEqual(
      new Set([
        'mcp_erbon_check_availability',
        'mcp_erbon_list_room_types',
        'mcp_erbon_list_rates',
        'mcp_erbon_get_hotel',
      ]),
    );
    const routable = erbonProvider.routableToolNames();
    for (const n of [
      'mcp_erbon_get_rate_prices',
      'mcp_erbon_create_booking',
      'mcp_erbon_search_guest',
      'mcp_erbon_create_guest',
    ]) {
      expect(routable).toContain(n);
      expect(menu).not.toContain(n);
    }
  });

  it('search_guest sends guestID in a header', async () => {
    const capture: Captured[] = [];
    const provider = createErbonProvider({ fetchImpl: fakeFetch({ body: [{ id: 29 }], capture }) });
    const res = await provider.callTool('mcp_erbon_search_guest', { guestID: 29 }, ctx);
    expect(res.kind).toBe('success');
    expect(capture[0]?.url).toMatch(/\/hotel\/H1\/guest\/search$/);
    expect(capture[0]?.init.headers?.guestID).toBe('29');
  });

  it('search_guest sends documentType/documentNumber in headers', async () => {
    const capture: Captured[] = [];
    const provider = createErbonProvider({ fetchImpl: fakeFetch({ body: [], capture }) });
    await provider.callTool(
      'mcp_erbon_search_guest',
      { documentType: 'CC', documentNumber: '123' },
      ctx,
    );
    expect(capture[0]?.init.headers?.documenttype).toBe('CC');
    expect(capture[0]?.init.headers?.documentnumber).toBe('123');
  });

  it('search_guest with no identifier is INVALID_INPUT, no request made', async () => {
    const capture: Captured[] = [];
    const provider = createErbonProvider({ fetchImpl: fakeFetch({ body: [], capture }) });
    const res = await provider.callTool('mcp_erbon_search_guest', {}, ctx);
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(capture.length).toBe(0);
  });

  it('create_guest POSTs guest/new with the args as a JSON body', async () => {
    const capture: Captured[] = [];
    const provider = createErbonProvider({ fetchImpl: fakeFetch({ body: { id: 30 }, capture }) });
    const res = await provider.callTool(
      'mcp_erbon_create_guest',
      { name: 'Ana Díaz', email: 'ana@example.com' },
      ctx,
    );
    expect(res.kind).toBe('success');
    expect(capture[0]?.init.method).toBe('POST');
    expect(capture[0]?.url).toMatch(/\/hotel\/H1\/guest\/new$/);
    const body = JSON.parse(capture[0]?.init.body ?? '{}');
    expect(body.name).toBe('Ana Díaz');
    expect(body.email).toBe('ana@example.com');
  });
});

// ---------------------------------------------------------------------------
// S3b/S4 support — booking reads (backend-only: lookup + reconcile)
// ---------------------------------------------------------------------------

describe('erbon provider — booking reads (get_booking / search_booking)', () => {
  it('keeps get_booking and search_booking OFF the agent menu but routable', () => {
    const menu = erbonProvider.listTools().map((t) => t.name);
    const routable = erbonProvider.routableToolNames();
    for (const n of ['mcp_erbon_get_booking', 'mcp_erbon_search_booking']) {
      expect(menu).not.toContain(n);
      expect(routable).toContain(n);
    }
  });

  it('get_booking GETs /booking/{id}, url-encoding the id, verbatim', async () => {
    const capture: Captured[] = [];
    const provider = createErbonProvider({
      fetchImpl: fakeFetch({ body: { bookingInternalID: 'B-1', voucher: 'v1' }, capture }),
    });
    const res = await provider.callTool('mcp_erbon_get_booking', { bookingInternalID: 'B-1' }, ctx);
    expect(res.kind).toBe('success');
    if (res.kind === 'success')
      expect(res.data).toEqual({ bookingInternalID: 'B-1', voucher: 'v1' });
    expect(capture[0]?.url).toMatch(/\/hotel\/H1\/booking\/B-1$/);
  });

  it('search_booking POSTs booking/search with the window filters in headers', async () => {
    const capture: Captured[] = [];
    const provider = createErbonProvider({ fetchImpl: fakeFetch({ body: [], capture }) });
    await provider.callTool(
      'mcp_erbon_search_booking',
      { bookingCreatedAtStart: '2026-10-19', bookingCreatedAtEnd: '2026-10-21' },
      ctx,
    );
    expect(capture[0]?.init.method).toBe('POST');
    expect(capture[0]?.url).toMatch(/\/hotel\/H1\/booking\/search$/);
    expect(capture[0]?.init.headers?.bookingCreatedAtStart).toBe('2026-10-19');
    expect(capture[0]?.init.headers?.bookingCreatedAtEnd).toBe('2026-10-21');
  });
});
