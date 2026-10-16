import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RequestSpec } from '../../../core/auth/http-request';
import { ProviderErrorCode } from '../../../core/errors';
import type { RequestResult } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import type { ProviderCallContext } from '../../../core/types';
import { createProfitroomClient } from '../client';
import { PROVIDERS } from '../../index';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import { createProfitroomProvider } from '../provider';

import { bookingEngineUrlContext, hotelKeyFrom } from '../context';
import {
  availabilitySchema,
  calendarSchema,
  detailsSchema,
  offersSchema,
  roomsSchema,
} from '../schemas';

/** A raw engine response captured live on 2026-10-14 (contract §D). */
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, '..', '__fixtures__', `${name}.json`), 'utf8'));
}

// ---------------------------------------------------------------------------
// S1 — Booking-engine URL (CONTEXT.md): parsed, never fetched. Contract §B.
// ---------------------------------------------------------------------------

describe('booking-engine URL context', () => {
  it.each([
    ['https://booking.profitroom.com/es/hotellapausa', 'hotellapausa'],
    ['https://booking.profitroom.com/en/hotellapausa/', 'hotellapausa'],
    ['https://booking.profitroom.com/es/hotellapausa/home?currency=COP', 'hotellapausa'],
    ['https://booking.profitroom.com/pl/hotel-123', 'hotel-123'],
  ])('accepts %s and routes to hotel key %s', (bookingEngineUrl, key) => {
    const parsed = bookingEngineUrlContext.safeParse({ bookingEngineUrl });
    expect(parsed.success).toBe(true);
    expect(hotelKeyFrom(bookingEngineUrl)).toBe(key);
  });

  it.each([
    ['plain http', 'http://booking.profitroom.com/es/hotellapausa'],
    ['another host', 'https://evil.com/es/hotellapausa'],
    ['a look-alike host', 'https://booking.profitroom.com.evil.com/es/hotellapausa'],
    ['userinfo', 'https://x@booking.profitroom.com/es/hotellapausa'],
    ['a port', 'https://booking.profitroom.com:8443/es/hotellapausa'],
    ['no locale segment', 'https://booking.profitroom.com/hotellapausa'],
    ['no hotel segment', 'https://booking.profitroom.com/es/'],
    ['an API path', 'https://booking.profitroom.com/api/hotellapausa/details'],
    ['not a URL', 'hotellapausa'],
  ])('rejects %s', (_case, bookingEngineUrl) => {
    expect(bookingEngineUrlContext.safeParse({ bookingEngineUrl }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S1 — wire schemas: the fields we use, shared with the drift probe. Contract §A, §E.
// ---------------------------------------------------------------------------

describe('engine response schemas', () => {
  it.each([
    ['details', detailsSchema],
    ['rooms', roomsSchema],
    ['offers', offersSchema],
    ['calendar', calendarSchema],
    ['availability', availabilitySchema],
    ['availability-child', availabilitySchema],
    ['availability-dropped-child', availabilitySchema],
  ] as const)('accepts the live %s response', (name, schema) => {
    const parsed = schema.safeParse(fixture(name));
    expect(parsed.error?.issues).toBeUndefined();
  });

  it('rejects a drifted availability response and names the field', () => {
    const drifted = structuredClone(fixture('availability')) as {
      proposals: { proposal: Record<string, unknown> }[];
    }[];
    const proposal = drifted[0]?.proposals[0]?.proposal as Record<string, unknown>;
    proposal.cost = proposal.price;
    delete proposal.price;

    const parsed = availabilitySchema.safeParse(drifted);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual([0, 'proposals', 0, 'proposal', 'price']);
  });
});

// ---------------------------------------------------------------------------
// S2 — client: fixed base, required header, fail-closed parsing, error remap, cache. Contract §A.1, §C.4, §C.5.
// ---------------------------------------------------------------------------

type Reply = RequestResult | ((spec: RequestSpec) => RequestResult);

/** The core's `ctx.request` seam, faked: records each spec and answers in order (last one repeats). */
function fakeRequest(...replies: Reply[]) {
  const calls: RequestSpec[] = [];
  const request = async (spec: RequestSpec): Promise<RequestResult> => {
    calls.push(spec);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)] as Reply;
    return typeof reply === 'function' ? reply(spec) : reply;
  };
  return { calls, request };
}

const okReply = (data: unknown): RequestResult => ({ ok: true, status: 200, data });

describe('profitroom client', () => {
  it('builds every request from the fixed API base, with the engine header and the query', async () => {
    const { calls, request } = fakeRequest(okReply(fixture('offers')));
    const client = createProfitroomClient();

    const r = await client.get(request, 'hotellapausa', 'offers', offersSchema, {
      query: { status: '1' },
    });

    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('https://booking.profitroom.com/api/hotellapausa/offers?status=1');
    expect(calls[0]?.headers).toEqual({ 'x-requested-with': 'XMLHttpRequest' });
  });

  it('fails closed on a drifted response: PROVIDER_ERROR naming the endpoint and field, never the data', async () => {
    const drifted = structuredClone(fixture('calendar')) as { dates: Record<string, unknown>[] };
    delete drifted.dates[0]?.minLOS;
    const { request } = fakeRequest(okReply(drifted));

    const r = await createProfitroomClient().get(
      request,
      'hotellapausa',
      'calendar',
      calendarSchema,
    );

    expect(r).toEqual({
      ok: false,
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: 'unexpected response from Profitroom (calendar: dates.0.minLOS Required)',
    });
  });

  const failed = (status: number, errorCode: ProviderErrorCode, body = ''): RequestResult => ({
    ok: false,
    status,
    errorCode,
    body,
  });

  it.each([
    [
      '401 → unavailable, not a reconnect (nothing to reconnect)',
      failed(401, ProviderErrorCode.AUTH_EXPIRED),
      ProviderErrorCode.PROVIDER_UNAVAILABLE,
    ],
    [
      '403 → unavailable (we were blocked)',
      failed(403, ProviderErrorCode.AUTH_EXPIRED),
      ProviderErrorCode.PROVIDER_UNAVAILABLE,
    ],
    [
      '404 site_not_found → invalid input (the URL names no hotel)',
      failed(404, ProviderErrorCode.PROVIDER_ERROR, JSON.stringify(fixture('site-not-found'))),
      ProviderErrorCode.INVALID_INPUT,
    ],
    [
      '422 → invalid input',
      failed(
        422,
        ProviderErrorCode.INVALID_INPUT,
        JSON.stringify(fixture('calendar-missing-params')),
      ),
      ProviderErrorCode.INVALID_INPUT,
    ],
    [
      '429 → rate limited',
      failed(429, ProviderErrorCode.RATE_LIMITED),
      ProviderErrorCode.RATE_LIMITED,
    ],
    [
      '503 → unavailable',
      failed(503, ProviderErrorCode.PROVIDER_UNAVAILABLE),
      ProviderErrorCode.PROVIDER_UNAVAILABLE,
    ],
  ])('maps %s', async (_case, reply, code) => {
    const { request } = fakeRequest(reply);
    const r = await createProfitroomClient().get(request, 'hotellapausa', 'details', detailsSchema);
    expect(r).toMatchObject({ ok: false, code });
  });

  it('reports a timeout or network failure as unavailable, without a fake status', async () => {
    const { request } = fakeRequest(failed(0, ProviderErrorCode.PROVIDER_UNAVAILABLE, 'aborted'));
    const r = await createProfitroomClient().get(request, 'hotellapausa', 'details', detailsSchema);
    expect(r).toEqual({
      ok: false,
      code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
      message: 'Profitroom did not answer the details request',
    });
  });

  describe('static-resource cache (15 min, per hotel and locale)', () => {
    const MIN = 60_000;
    function clock(start = 0) {
      let t = start;
      return { now: () => t, advance: (ms: number) => (t += ms) };
    }

    it('serves details, rooms and offers from memory within 15 minutes', async () => {
      const c = clock();
      const { calls, request } = fakeRequest(okReply(fixture('rooms')));
      const client = createProfitroomClient({ now: c.now });

      await client.get(request, 'hotellapausa', 'rooms', roomsSchema);
      c.advance(14 * MIN);
      const again = await client.get(request, 'hotellapausa', 'rooms', roomsSchema);

      expect(again.ok).toBe(true);
      expect(calls).toHaveLength(1);
    });

    it('asks Profitroom again after 15 minutes or for another hotel', async () => {
      const c = clock();
      const { calls, request } = fakeRequest(okReply(fixture('rooms')));
      const client = createProfitroomClient({ now: c.now });

      await client.get(request, 'hotellapausa', 'rooms', roomsSchema);
      await client.get(request, 'otherhotel', 'rooms', roomsSchema);
      c.advance(15 * MIN);
      await client.get(request, 'hotellapausa', 'rooms', roomsSchema);

      expect(calls).toHaveLength(3);
    });

    it('never caches availability or the calendar — prices and nights are always live', async () => {
      const { calls, request } = fakeRequest(okReply(fixture('availability')));
      const client = createProfitroomClient();
      const query = { checkIn: '2026-10-23', checkOut: '2026-10-25', 'occupancy[0][adults]': '2' };

      await client.get(request, 'hotellapausa', 'availability', availabilitySchema, { query });
      await client.get(request, 'hotellapausa', 'availability', availabilitySchema, { query });

      expect(calls).toHaveLength(2);
    });

    it('does not cache a failure', async () => {
      const { calls, request } = fakeRequest(
        failed(503, ProviderErrorCode.PROVIDER_UNAVAILABLE),
        okReply(fixture('details')),
      );
      const client = createProfitroomClient();

      const first = await client.get(request, 'hotellapausa', 'details', detailsSchema);
      const second = await client.get(request, 'hotellapausa', 'details', detailsSchema);

      expect(first.ok).toBe(false);
      expect(second.ok).toBe(true);
      expect(calls).toHaveLength(2);
    });

    it('invalidate(hotel) drops the cached resources of that hotel', async () => {
      const { calls, request } = fakeRequest(okReply(fixture('rooms')));
      const client = createProfitroomClient();

      await client.get(request, 'hotellapausa', 'rooms', roomsSchema);
      client.invalidate('hotellapausa');
      await client.get(request, 'hotellapausa', 'rooms', roomsSchema);

      expect(calls).toHaveLength(2);
    });
  });
});

// ---------------------------------------------------------------------------
// Provider-level helpers: a fake engine answering from the live fixtures, by path.
// ---------------------------------------------------------------------------

const LA_PAUSA = 'https://booking.profitroom.com/es/hotellapausa';

/** Fake engine: routes `/api/{hotel}/{resource}` to a fixture (or an override) and records each URL. */
function fakeEngine(overrides: Record<string, { status?: number; body: unknown }> = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    const resource = new URL(url).pathname.split('/')[3] ?? '';
    const reply = overrides[resource] ?? { body: fixture(resource) };
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}

/** A connected call: the pasted URL plus the hotelKey the consumer discovered at connect. */
const callCtx = (bookingEngineUrl = LA_PAUSA, hotelKey = 'hotellapausa'): ProviderCallContext => ({
  credential: { secret: new SecretString('') },
  metadata: { bookingEngineUrl, hotelKey },
});

// ---------------------------------------------------------------------------
// S3 — static tools: projection with Profitroom's own names (ADR 0009). Contract §C.1, §C.3.
// ---------------------------------------------------------------------------

describe('static tools', () => {
  it('get_hotel projects details in the requested locale and derives the booking-engine URL', async () => {
    const { fetchImpl } = fakeEngine();
    const r = await createProfitroomProvider({ fetchImpl }).callTool(
      'mcp_profitroom_get_hotel',
      { locale: 'es' },
      callCtx(),
    );

    expect(r).toMatchObject({
      kind: 'success',
      data: {
        name: 'Hotel La Pausa',
        defaultCurrency: { code: 'COP' },
        timeZone: 'America/Bogota',
        defaultLocale: 'es',
        locales: [
          { locale: 'es', isLive: true },
          { locale: 'en', isLive: true },
        ],
        personTypes: [
          { type: 'A', minAge: null, maxAge: null },
          { type: 'C', minAge: 0, maxAge: 2 },
        ],
        config: {
          'Hotel.CheckinAfter': '15:00',
          'Hotel.CheckoutBefore': '12:00',
          'be.taxesPresentationMode': 'net',
          'be.maxRoomsPerReservation': '5',
        },
        bookingEngineUrl: 'https://booking.profitroom.com/es/hotellapausa',
      },
    });
  });

  it('list_room_types projects every room in the requested locale, keeping Profitroom field names', async () => {
    const { fetchImpl } = fakeEngine();
    const r = await createProfitroomProvider({ fetchImpl }).callTool(
      'mcp_profitroom_list_room_types',
      { locale: 'en' },
      callCtx(),
    );

    expect(r.kind).toBe('success');
    const rooms = (r as { data: Record<string, unknown>[] }).data;
    expect(rooms).toHaveLength(6);
    expect(rooms[0]).toMatchObject({
      id: 230226,
      name: 'Double Cabin with Jacuzzi',
      attributes: { area: { unit: expect.any(String) } },
      limits: { max: { occupancy: { adults: 2, children: [{ minAge: 0, maxAge: 2, count: 1 }] } } },
      offerIds: expect.arrayContaining([380900]),
    });
    expect(rooms[0]).toHaveProperty('description');
    expect(rooms[0]).not.toHaveProperty('translations');
    expect(rooms[0]).not.toHaveProperty('gallery');
  });

  // #145 — the engine names each photo only by file; the provider derives its public URL. Observed
  // 2026-10-15: the featured photo lives under images/rooms/, the gallery under images/gallery/.
  it('list_room_types gives each room its photo URLs: the featured one first, then the gallery in order', async () => {
    const { fetchImpl } = fakeEngine();
    const r = await createProfitroomProvider({ fetchImpl }).callTool(
      'mcp_profitroom_list_room_types',
      { locale: 'es' },
      callCtx(),
    );

    const rooms = (r as { data: { photos: { url: string }[] }[] }).data;
    const photos = rooms[0]?.photos ?? [];
    expect(photos[0]).toEqual({
      url: 'https://r.profitroom.pl/hotellapausa/images/rooms/thumbs/1134x0/e51137b9-1229-424e-8727-ec3073cbcda9.jpg',
    });
    expect(photos[1]).toEqual({
      url: 'https://r.profitroom.pl/hotellapausa/images/gallery/thumbs/1134x0/d2715b30-47f6-4f5d-b2f1-35a5ba483a6c.jpg',
    });
    expect(photos).toHaveLength(9); // 1 featured + 8 gallery images
  });

  it('list_room_types still lists a room with no gallery, a reshaped one, or a file name that is not an image', async () => {
    const rooms = structuredClone(fixture('rooms')) as Record<string, unknown>[];
    rooms[0]!.gallery = null;
    rooms[1]!.gallery = 'reshaped';
    (rooms[2]!.gallery as { featured: { fileName: string } }).featured.fileName =
      '../../other/secret.jpg';
    const { fetchImpl } = fakeEngine({ rooms: { body: rooms } });

    const r = await createProfitroomProvider({ fetchImpl }).callTool(
      'mcp_profitroom_list_room_types',
      { locale: 'es' },
      callCtx(),
    );

    expect(r.kind).toBe('success');
    const listed = (r as { data: { photos: { url: string }[] }[] }).data;
    expect(listed).toHaveLength(6);
    expect(listed[0]?.photos).toEqual([]);
    expect(listed[1]?.photos).toEqual([]);
    expect(listed[2]?.photos.every((p) => p.url.includes('/images/gallery/'))).toBe(true);
    expect(listed[2]?.photos.some((p) => p.url.includes('secret'))).toBe(false);
  });

  // Review of #146: the file-name rule is lowercase, as the contract states.
  it('list_room_types drops a photo whose file name is not lowercase', async () => {
    const rooms = structuredClone(fixture('rooms')) as Record<string, unknown>[];
    (rooms[0]!.gallery as { featured: { fileName: string } }).featured.fileName = 'FEATURED.JPG';
    const { fetchImpl } = fakeEngine({ rooms: { body: rooms } });

    const r = await createProfitroomProvider({ fetchImpl }).callTool(
      'mcp_profitroom_list_room_types',
      { locale: 'es' },
      callCtx(),
    );

    const photos = (r as { data: { photos: { url: string }[] }[] }).data[0]?.photos ?? [];
    expect(photos.some((p) => p.url.includes('FEATURED'))).toBe(false);
    expect(photos[0]?.url).toContain('/images/gallery/');
  });

  it('list_rates keeps profiles verbatim and falls back to the hotel language when a rate lacks one', async () => {
    const { fetchImpl } = fakeEngine();
    const r = await createProfitroomProvider({ fetchImpl }).callTool(
      'mcp_profitroom_list_rates',
      { locale: 'en' },
      callCtx(),
    );

    expect(r.kind).toBe('success');
    const offers = (r as { data: Record<string, unknown>[] }).data;
    const standard = offers.find((o) => o.id === 380900);
    const lastMinute = offers.find((o) => o.id === 524038);
    expect(standard).toMatchObject({
      type: 'O',
      roomIds: expect.arrayContaining([230226]),
      profiles: [
        {
          profileId: 212614,
          type: 'elastic',
          deposit: { percentage: 30, nights: null },
          params: { cancelTime: '7', cancelUnit: 'days', remainingPaymentType: 'upon_arrival' },
        },
      ],
      restrictions: { availableTo: '2029-07-11' },
    });
    expect(standard?.name).not.toBe('Tarifa Estándar'); // the English translation exists
    expect(lastMinute?.name).toBe('Oferta de primer minuto con desayuno -15%'); // es only → fallback
  });

  it('asks the engine for active rates only, as its own page does', async () => {
    const { urls, fetchImpl } = fakeEngine();
    await createProfitroomProvider({ fetchImpl }).callTool(
      'mcp_profitroom_list_rates',
      {},
      callCtx(),
    );
    expect(urls).toContain('https://booking.profitroom.com/api/hotellapausa/offers?status=1');
  });

  it('rejects a language the hotel does not offer, before reading rooms', async () => {
    const { urls, fetchImpl } = fakeEngine();
    const r = await createProfitroomProvider({ fetchImpl }).callTool(
      'mcp_profitroom_list_room_types',
      { locale: 'de' },
      callCtx(),
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(urls.some((u) => u.includes('/rooms'))).toBe(false);
  });

  it('rejects a connection whose URL is not a Profitroom booking engine, without calling anyone', async () => {
    const { urls, fetchImpl } = fakeEngine();
    const r = await createProfitroomProvider({ fetchImpl }).callTool(
      'mcp_profitroom_get_hotel',
      {},
      callCtx('https://evil.com/es/hotellapausa'),
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(urls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// S4 — availability calendar: hotel-wide open nights, verbatim. Contract §A.5, §C.1.
// ---------------------------------------------------------------------------

describe('get_availability_calendar', () => {
  it('returns the engine calendar for the range, with its own keys', async () => {
    const { urls, fetchImpl } = fakeEngine();
    const r = await createProfitroomProvider({ fetchImpl }).callTool(
      'mcp_profitroom_get_availability_calendar',
      { from: '2026-10-20', to: '2026-10-26' },
      callCtx(),
    );

    expect(urls).toContain(
      'https://booking.profitroom.com/api/hotellapausa/calendar?from=2026-10-20&to=2026-10-26',
    );
    expect(r).toMatchObject({
      kind: 'success',
      data: {
        from: '2026-10-20',
        to: '2026-10-26',
        dates: expect.arrayContaining([
          { date: '2026-10-20', availability: true, minLOS: 1, maxLOS: null, CTD: false },
        ]),
      },
    });
  });

  it.each([
    ['a range longer than 60 days', { from: '2026-10-01', to: '2026-12-15' }],
    ['`to` before `from`', { from: '2026-10-26', to: '2026-10-20' }],
    ['a date that does not exist', { from: '2026-02-30', to: '2026-03-02' }],
  ])('rejects %s without calling the engine', async (_case, args) => {
    const { urls, fetchImpl } = fakeEngine();
    const r = await createProfitroomProvider({ fetchImpl }).callTool(
      'mcp_profitroom_get_availability_calendar',
      args,
      callCtx(),
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(urls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// S5 — the stay: check_availability (no money) and get_stay_prices (controlPlane). Contract §C.2–§C.4.
// ---------------------------------------------------------------------------

/** "Today" before the fixture stay (2026-10-23 → 25), so the fixtures stay valid forever. */
const BEFORE_STAY = Date.parse('2026-10-14T15:00:00Z');
const stay = (extra: Record<string, unknown> = {}) => ({
  checkIn: '2026-10-23',
  checkOut: '2026-10-25',
  rooms: [{ adults: 2 }],
  ...extra,
});

describe('check_availability', () => {
  it('lists what can be booked, joined with room, rate and terms — and carries no money', async () => {
    const { urls, fetchImpl } = fakeEngine();
    const r = await createProfitroomProvider({ fetchImpl, now: () => BEFORE_STAY }).callTool(
      'mcp_profitroom_check_availability',
      stay({ locale: 'es' }),
      callCtx(),
    );

    expect(urls).toContain(
      'https://booking.profitroom.com/api/hotellapausa/availability?checkIn=2026-10-23&checkOut=2026-10-25&occupancy%5B0%5D%5Badults%5D=2',
    );
    expect(r).toMatchObject({
      kind: 'success',
      data: {
        checkIn: '2026-10-23',
        checkOut: '2026-10-25',
        occupancy: { adults: 2, childrenAges: [] },
        available: true,
        proposals: [
          {
            OfferID: 380900,
            RoomID: 230226,
            profileId: 212614,
            roomCount: 4,
            room: { id: 230226, name: 'Cabaña Doble con Jacuzzi' },
            offer: { id: 380900, name: 'Tarifa Estándar' },
            profile: { profileId: 212614, type: 'elastic', deposit: { percentage: 30 } },
          },
        ],
      },
    });
    expect(JSON.stringify(r)).not.toMatch(/price|amount|1411000/i);
  });

  it('refreshes rooms and rates once when a proposal names an unknown room, then fails closed', async () => {
    const roomsWithoutIt = (fixture('rooms') as { id: number }[]).filter((r) => r.id !== 230226);
    const { urls, fetchImpl } = fakeEngine({ rooms: { body: roomsWithoutIt } });
    const r = await createProfitroomProvider({ fetchImpl, now: () => BEFORE_STAY }).callTool(
      'mcp_profitroom_check_availability',
      stay(),
      callCtx(),
    );

    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
    expect(urls.filter((u) => u.endsWith('/rooms'))).toHaveLength(2);
  });

  it('serves a room created minutes ago once the refresh finds it', async () => {
    let roomsCalls = 0;
    const all = fixture('rooms') as { id: number }[];
    const { fetchImpl } = fakeEngine();
    const engine = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/rooms')) {
        roomsCalls += 1;
        const body = roomsCalls === 1 ? all.filter((r) => r.id !== 230226) : all;
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => '',
        } as unknown as Response;
      }
      return fetchImpl(url, init);
    }) as unknown as typeof fetch;

    const r = await createProfitroomProvider({
      fetchImpl: engine,
      now: () => BEFORE_STAY,
    }).callTool('mcp_profitroom_check_availability', stay(), callCtx());

    expect(r).toMatchObject({ kind: 'success', data: { proposals: [{ room: { id: 230226 } }] } });
    expect(roomsCalls).toBe(2);
  });

  it('rejects a child older than the hotel prices as a child, before asking for availability', async () => {
    const { urls, fetchImpl } = fakeEngine();
    const r = await createProfitroomProvider({ fetchImpl, now: () => BEFORE_STAY }).callTool(
      'mcp_profitroom_check_availability',
      stay({ rooms: [{ adults: 2, childrenAges: [7] }] }),
      callCtx(),
    );

    expect(r).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.INVALID_INPUT,
      message: 'children older than 2 count as adults at this hotel',
    });
    expect(urls.some((u) => u.includes('/availability'))).toBe(false);
  });

  it('prices a child inside the range and sends the age to the engine', async () => {
    const { urls, fetchImpl } = fakeEngine({
      availability: { body: fixture('availability-child') },
    });
    const r = await createProfitroomProvider({ fetchImpl, now: () => BEFORE_STAY }).callTool(
      'mcp_profitroom_check_availability',
      stay({ rooms: [{ adults: 2, childrenAges: [1] }] }),
      callCtx(),
    );

    expect(urls.some((u) => u.includes('occupancy%5B0%5D%5Bchildren%5D%5B0%5D=1'))).toBe(true);
    expect(r).toMatchObject({
      kind: 'success',
      data: { occupancy: { adults: 2, childrenAges: [1] }, available: true },
    });
  });

  it('answers "does not fit one room" when the engine re-splits the party — never a partial quote', async () => {
    // Observed: the engine answers a party one room cannot take with a multi-room suggestion.
    const { fetchImpl } = fakeEngine({
      availability: { body: fixture('availability-dropped-child') },
    });
    const r = await createProfitroomProvider({ fetchImpl, now: () => BEFORE_STAY }).callTool(
      'mcp_profitroom_check_availability',
      stay({ rooms: [{ adults: 2, childrenAges: [1] }] }),
      callCtx(),
    );

    expect(r).toMatchObject({
      kind: 'success',
      data: { available: false, reason: 'party_does_not_fit_one_room', proposals: [] },
    });
  });

  it('answers "not available" (no reason) when the engine has nothing for those dates', async () => {
    const { fetchImpl } = fakeEngine({
      availability: { body: [{ occupancy: { adults: 2, children: [] }, proposals: [] }] },
    });
    const r = await createProfitroomProvider({ fetchImpl, now: () => BEFORE_STAY }).callTool(
      'mcp_profitroom_check_availability',
      stay(),
      callCtx(),
    );

    expect(r).toMatchObject({ kind: 'success', data: { available: false, proposals: [] } });
    expect((r as { data: object }).data).not.toHaveProperty('reason');
  });

  it.each([
    ['check-out on the check-in day', stay({ checkOut: '2026-10-23' }), BEFORE_STAY],
    ['check-out before check-in', stay({ checkOut: '2026-10-22' }), BEFORE_STAY],
    // 2026-10-24 03:00 UTC is still 2026-10-23 22:00 in Bogotá: a check-in on 10-23 is today, allowed;
    // one on 10-22 is in the past for the hotel.
    [
      'a check-in already past at the hotel',
      stay({ checkIn: '2026-10-22' }),
      Date.parse('2026-10-24T03:00:00Z'),
    ],
  ])('rejects %s without asking for availability', async (_case, args, now) => {
    const { urls, fetchImpl } = fakeEngine();
    const r = await createProfitroomProvider({ fetchImpl, now: () => now }).callTool(
      'mcp_profitroom_check_availability',
      args,
      callCtx(),
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(urls.some((u) => u.includes('/availability'))).toBe(false);
  });

  it('accepts a check-in that is today in the hotel time zone though already tomorrow in UTC', async () => {
    const { fetchImpl } = fakeEngine();
    const r = await createProfitroomProvider({
      fetchImpl,
      now: () => Date.parse('2026-10-24T03:00:00Z'),
    }).callTool('mcp_profitroom_check_availability', stay(), callCtx());
    expect(r.kind).toBe('success');
  });
});

describe('get_stay_prices (backend-only money guard)', () => {
  it('is routable by the backend but absent from the agent menu', () => {
    const provider = createProfitroomProvider({ fetchImpl: fakeEngine().fetchImpl });
    expect(provider.listTools().map((t) => t.name)).not.toContain('mcp_profitroom_get_stay_prices');
    expect(provider.routableToolNames()).toContain('mcp_profitroom_get_stay_prices');
  });

  it('adds the live price, the tax mode and a pre-filled booking link to each proposal', async () => {
    const { fetchImpl } = fakeEngine();
    const r = await createProfitroomProvider({ fetchImpl, now: () => BEFORE_STAY }).callTool(
      'mcp_profitroom_get_stay_prices',
      stay({ locale: 'es' }),
      callCtx(),
    );

    expect(r).toMatchObject({
      kind: 'success',
      data: {
        currency: 'COP',
        taxesPresentationMode: 'net',
        taxesIncluded: false,
        available: true,
        proposals: [
          {
            OfferID: 380900,
            RoomID: 230226,
            room: { name: 'Cabaña Doble con Jacuzzi' },
            price: { amount: 1411000, currency: 'COP' },
            originalPrice: { amount: 1510000, currency: 'COP' },
            discounts: [{ amount: -99000, availableTo: '2026-10-30T00:00:00-05:00' }],
            bookingUrl:
              'https://booking.profitroom.com/es/hotellapausa/pricelist/rooms/230226?check-in=2026-10-23&check-out=2026-10-25&r1_adults=2&currency=COP',
          },
        ],
      },
    });
  });

  it('puts children in the link the way this hotel’s engine reads them (classic picker)', async () => {
    const { fetchImpl } = fakeEngine({ availability: { body: fixture('availability-child') } });
    const r = await createProfitroomProvider({ fetchImpl, now: () => BEFORE_STAY }).callTool(
      'mcp_profitroom_get_stay_prices',
      stay({ rooms: [{ adults: 2, childrenAges: [1] }] }),
      callCtx(),
    );

    const url = (r as { data: { proposals: { bookingUrl: string }[] } }).data.proposals[0]
      ?.bookingUrl;
    expect(url).toBe(
      'https://booking.profitroom.com/es/hotellapausa/pricelist/rooms/230226?check-in=2026-10-23&check-out=2026-10-25&r1_adults=2&r1_child0-2=1&currency=COP',
    );
  });

  function withPrice(price: unknown) {
    const body = structuredClone(fixture('availability')) as {
      proposals: { proposal: Record<string, unknown> }[];
    }[];
    (body[0]?.proposals[0]?.proposal as Record<string, unknown>).price = price;
    return body;
  }

  it.each([
    ['a price in another currency', { amount: 350, currency: 'USD' }],
    ['a zero price', { amount: 0, currency: 'COP' }],
  ])('fails closed on %s — never hands it on', async (_case, price) => {
    const { fetchImpl } = fakeEngine({ availability: { body: withPrice(price) } });
    const r = await createProfitroomProvider({ fetchImpl, now: () => BEFORE_STAY }).callTool(
      'mcp_profitroom_get_stay_prices',
      stay(),
      callCtx(),
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
  });
});

// ---------------------------------------------------------------------------
// S6 — integration: registered, conformant, credential-less in the catalog.
// ---------------------------------------------------------------------------

describe('profitroom provider integration', () => {
  it('passes provider conformance', async () => {
    await runProviderConformance(createProfitroomProvider({ fetchImpl: fakeEngine().fetchImpl }));
  });

  it('is registered, credential-less, and publishes five money-free menu tools', () => {
    const provider = PROVIDERS.find((p) => p.manifest.slug === 'profitroom');
    expect(provider?.auth).toEqual({ type: 'none' });
    expect(provider?.contextSchema).toMatchObject({
      properties: { bookingEngineUrl: { type: 'string' } },
      required: ['bookingEngineUrl', 'hotelKey'],
    });
    expect(
      provider
        ?.listTools()
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      'mcp_profitroom_check_availability',
      'mcp_profitroom_get_availability_calendar',
      'mcp_profitroom_get_hotel',
      'mcp_profitroom_list_rates',
      'mcp_profitroom_list_room_types',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Phase 0 (backend #1599) — the consumer can connect it: probe, discovery, identity.
// ---------------------------------------------------------------------------

describe('connect support for a credential-less consumer', () => {
  it('publishes a connection probe, discovers hotelKey with it, and keys the account on hotelKey', () => {
    const { manifest } = createProfitroomProvider({ fetchImpl: fakeEngine().fetchImpl });
    expect(manifest.connectionProbe).toEqual({ tool: 'mcp_profitroom_get_hotel' });
    expect(manifest.contextDiscovery).toEqual({
      key: 'hotelKey',
      tool: 'mcp_profitroom_get_hotel',
      resultPath: 'hotelKey',
    });
    expect(manifest.accountContextKeys).toEqual(['hotelKey']);
  });

  it('publishes its logo, served from assets/', () => {
    const { manifest } = createProfitroomProvider({ fetchImpl: fakeEngine().fetchImpl });
    expect(manifest.logoUrl).toBe('/assets/profitroom.webp');
    expect(existsSync(join(process.cwd(), 'assets', 'profitroom.webp'))).toBe(true);
  });

  it('get_hotel discovers hotelKey from the URL alone, as the owner pasted it', async () => {
    const { fetchImpl } = fakeEngine();
    const r = await createProfitroomProvider({ fetchImpl }).callTool(
      'mcp_profitroom_get_hotel',
      {},
      {
        credential: { secret: new SecretString('') },
        metadata: {
          bookingEngineUrl: 'https://booking.profitroom.com/en/hotellapausa/home?currency=COP',
        },
      },
    );
    expect(r).toMatchObject({ kind: 'success', data: { hotelKey: 'hotellapausa' } });
  });

  it('every other tool requires the discovered hotelKey, and it must be the URL’s own', async () => {
    const { urls, fetchImpl } = fakeEngine();
    const provider = createProfitroomProvider({ fetchImpl });
    expect(provider.contextSchema).toMatchObject({ required: ['bookingEngineUrl', 'hotelKey'] });

    const mismatched = await provider.callTool(
      'mcp_profitroom_list_room_types',
      {},
      {
        credential: { secret: new SecretString('') },
        metadata: { bookingEngineUrl: LA_PAUSA, hotelKey: 'otherhotel' },
      },
    );
    expect(mismatched).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(urls).toHaveLength(0);
  });
});
