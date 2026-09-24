import { describe, expect, it, vi } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { createSiteminderProvider } from '../provider';

// Documented, not recorded — see __fixtures__/documented/README.md.
import property from '../__fixtures__/documented/property.json';
import quotes from '../__fixtures__/documented/quotes.json';
import roomRates from '../__fixtures__/documented/room-rates.json';
import roomTypes from '../__fixtures__/documented/room-types.json';
import notAuthorisedQuickStart from '../__fixtures__/documented/errors/401-quick-start.json';
// Recorded from the live API on 2026-09-24 with a deliberately invalid key (design-notes E1, E2).
import invalidKeyObserved from '../__fixtures__/observed/errors/401-invalid-key.json';
import missingKeyObserved from '../__fixtures__/observed/errors/401-missing-key.json';
import notAuthorisedReference from '../__fixtures__/documented/errors/401-reference.json';
import accessDenied from '../__fixtures__/documented/errors/403-reference.json';
import rateLimited from '../__fixtures__/documented/errors/429-quick-start.json';

const KEY = 'sm-super-secret-direct-booking-key';
const PROPERTY = 'f63ce398-da03-4573-856d-ed8d71e57e3d';
const BASE = 'https://directbooking.siteminder.com/public-api/api';

const CTX: ProviderCallContext = {
  credential: { secret: new SecretString(KEY) },
  metadata: { propertyUuid: PROPERTY },
};

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly method: string;
}

/** A fetch double that records each request and answers with the queued bodies, in order. */
function fakeFetch(...answers: Array<{ body: unknown; status?: number }>) {
  const calls: Call[] = [];
  let i = 0;
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      method: init?.method ?? 'GET',
    });
    const answer = answers[Math.min(i++, answers.length - 1)] ?? { body: {} };
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { impl: impl as unknown as typeof globalThis.fetch, calls };
}

function provider(...answers: Array<{ body: unknown; status?: number }>) {
  const { impl, calls } = fakeFetch(...answers);
  return { provider: createSiteminderProvider({ fetchImpl: impl }), calls };
}

function successData(result: ToolResult): unknown {
  if (result.kind !== 'success') throw new Error(`expected success, got: ${result.message}`);
  return result.data;
}

function failure(result: ToolResult): { code: ProviderErrorCode; message: string } {
  if (result.kind !== 'error') throw new Error('expected an error result');
  return { code: result.code, message: result.message };
}

const STAY = { checkIn: '2026-10-01', checkOut: '2026-10-03', adults: 2 };

describe('siteminder provider — conformance', () => {
  it('passes the provider conformance suite', async () => {
    await runProviderConformance(createSiteminderProvider());
  });
});

describe('siteminder provider — catalog surface', () => {
  it('publishes one header secret, x-sm-api-key, forwarded', () => {
    const p = createSiteminderProvider();
    expect(p.auth.type).toBe('api_key');
    if (p.auth.type === 'api_key') {
      expect(p.auth.credentialDelivery).toBe('forwarded');
      expect(p.auth.fields).toHaveLength(1);
      expect(p.auth.fields[0]).toMatchObject({ key: 'x-sm-api-key', placement: 'header' });
    }
  });

  it('publishes propertyUuid as the pasted context and the account identity', () => {
    const p = createSiteminderProvider();
    const required = (p.contextSchema as { required?: string[] } | undefined)?.required ?? [];
    expect(required).toEqual(['propertyUuid']);
    expect(p.manifest.accountContextKeys).toEqual(['propertyUuid']);
    // Pasted, not discovered: a property key cannot list properties.
    expect(p.manifest.contextDiscovery).toBeUndefined();
  });

  it('probes a pasted key with get_property, which needs nothing but the pasted context', async () => {
    const p = createSiteminderProvider({ fetchImpl: fakeFetch({ body: property }).impl });
    expect(p.manifest.connectionProbe?.tool).toBe('mcp_siteminder_get_property');
    const result = await p.callTool('mcp_siteminder_get_property', {}, CTX);
    expect(result.kind).toBe('success');
  });

  it('publishes the curated read surface and nothing that writes', () => {
    const names = createSiteminderProvider()
      .listTools()
      .map((t) => t.name)
      .sort();
    expect(names).toEqual([
      'mcp_siteminder_build_booking_link',
      'mcp_siteminder_get_property',
      'mcp_siteminder_get_quotes',
      'mcp_siteminder_get_room_type_amenities',
      'mcp_siteminder_get_room_type_bedrooms',
      'mcp_siteminder_get_room_type_photos',
      'mcp_siteminder_list_room_rates',
      'mcp_siteminder_list_room_types',
    ]);
  });
});

describe('siteminder provider — request shaping', () => {
  it('sends the key in the x-sm-api-key header and never in the URL', async () => {
    const { provider: p, calls } = provider({ body: property });
    await p.callTool('mcp_siteminder_get_property', {}, CTX);

    expect(calls[0]!.url).toBe(`${BASE}/properties/${PROPERTY}`);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers['x-sm-api-key']).toBe(KEY);
    expect(calls[0]!.url).not.toContain(KEY);
  });

  it('refuses a context whose property id is not a uuid, before any request', async () => {
    const { provider: p, calls } = provider({ body: property });
    const result = await p.callTool(
      'mcp_siteminder_get_property',
      {},
      { ...CTX, metadata: { propertyUuid: 'not-a-uuid' } },
    );
    expect(result.kind).toBe('error');
    expect(calls).toHaveLength(0);
  });

  it.each(['..', '../quotes?x=1', 'deluxe'])(
    'refuses a room type id that is not a uuid (%s), before any request',
    async (roomTypeUuid) => {
      const { provider: p, calls } = provider({ body: [] });
      const result = await p.callTool('mcp_siteminder_get_room_type_photos', { roomTypeUuid }, CTX);
      expect(failure(result).code).toBe(ProviderErrorCode.INVALID_INPUT);
      expect(calls).toHaveLength(0);
    },
  );

  it('asks for one room type under the property', async () => {
    const { provider: p, calls } = provider({ body: [] });
    await p.callTool(
      'mcp_siteminder_get_room_type_photos',
      { roomTypeUuid: '403950b4-0919-4396-afa1-3957a38a83f8' },
      CTX,
    );
    expect(calls[0]!.url).toBe(
      `${BASE}/properties/${PROPERTY}/room-types/403950b4-0919-4396-afa1-3957a38a83f8/photos`,
    );
  });
});

describe('siteminder provider — lists', () => {
  it('wraps room types in the uniform page, with SiteMinder totals', async () => {
    const { provider: p, calls } = provider({ body: roomTypes });
    const data = successData(await p.callTool('mcp_siteminder_list_room_types', {}, CTX)) as {
      items: unknown[];
      totalPages: number;
      totalResults: number;
      hasMore: boolean;
    };

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe(`/public-api/api/properties/${PROPERTY}/room-types`);
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('perPage')).toBe('25');
    expect(data.items).toEqual(roomTypes.results);
    expect(data).toMatchObject({ totalPages: 1, totalResults: 1, hasMore: false });
  });

  it('reads the `items` list the quick start shows, as well as `results`', async () => {
    const { provider: p } = provider({ body: { items: roomRates.results } });
    const data = successData(await p.callTool('mcp_siteminder_list_room_rates', {}, CTX)) as {
      items: unknown[];
    };
    expect(data.items).toEqual(roomRates.results);
  });

  it('refuses a page larger than SiteMinder serves, before any request', async () => {
    const { provider: p, calls } = provider({ body: roomRates });
    const result = await p.callTool('mcp_siteminder_list_room_rates', { pageSize: 80 }, CTX);
    expect(failure(result).code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(calls).toHaveLength(0);
  });

  it('treats a list with neither shape as an unrecognized response, not an empty hotel', async () => {
    const { provider: p } = provider({ body: { data: [] } });
    const result = await p.callTool('mcp_siteminder_list_room_types', {}, CTX);
    expect(failure(result).code).toBe(ProviderErrorCode.PROVIDER_ERROR);
  });
});

describe('siteminder provider — quotes', () => {
  it('asks /quotes with the stay, and returns the quotes verbatim', async () => {
    const { provider: p, calls } = provider({ body: quotes });
    const data = successData(
      await p.callTool(
        'mcp_siteminder_get_quotes',
        { ...STAY, children: 1, promoCode: 'SUMMER', withBreakdown: true },
        CTX,
      ),
    );

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe(`/public-api/api/properties/${PROPERTY}/quotes`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      checkIn: '2026-10-01',
      checkOut: '2026-10-03',
      adults: '2',
      children: '1',
      promocode: 'SUMMER',
      withBreakdown: 'true',
    });
    expect(data).toEqual(quotes);
  });

  it('sends nothing it was not given', async () => {
    const { provider: p, calls } = provider({ body: quotes });
    await p.callTool('mcp_siteminder_get_quotes', STAY, CTX);
    expect([...new URL(calls[0]!.url).searchParams.keys()].sort()).toEqual([
      'adults',
      'checkIn',
      'checkOut',
    ]);
  });

  it('returns an empty list as a success — nothing bookable is an answer, not a failure', async () => {
    const { provider: p } = provider({ body: [] });
    expect(successData(await p.callTool('mcp_siteminder_get_quotes', STAY, CTX))).toEqual([]);
  });

  it.each([
    ['a stay over 31 nights', { checkIn: '2026-10-01', checkOut: '2026-11-02' }],
    ['a check-out before check-in', { checkIn: '2026-10-05', checkOut: '2026-10-03' }],
    ['a zero-night stay', { checkIn: '2026-10-05', checkOut: '2026-10-05' }],
    ['a date that does not exist', { checkIn: '2026-02-30', checkOut: '2026-03-02' }],
  ])('refuses %s without spending a request', async (_label, dates) => {
    const { provider: p, calls } = provider({ body: quotes });
    const result = await p.callTool('mcp_siteminder_get_quotes', { ...dates, adults: 2 }, CTX);
    expect(failure(result).code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(calls).toHaveLength(0);
  });

  it('accepts exactly 31 nights', async () => {
    const { provider: p, calls } = provider({ body: quotes });
    const result = await p.callTool(
      'mcp_siteminder_get_quotes',
      { checkIn: '2026-10-01', checkOut: '2026-11-01', adults: 1 },
      CTX,
    );
    expect(result.kind).toBe('success');
    expect(calls).toHaveLength(1);
  });

  it('requires at least one adult', async () => {
    const { provider: p } = provider({ body: quotes });
    const result = await p.callTool('mcp_siteminder_get_quotes', { ...STAY, adults: 0 }, CTX);
    expect(failure(result).code).toBe(ProviderErrorCode.INVALID_INPUT);
  });
});

describe('siteminder provider — booking link', () => {
  it("fills the hotel's booking engine with the stay, and says it reserves nothing", async () => {
    const { provider: p, calls } = provider({ body: property });
    const data = successData(
      await p.callTool(
        'mcp_siteminder_build_booking_link',
        { ...STAY, children: 1, rooms: 1, promoCode: 'SUMMER', locale: 'es', currency: 'COP' },
        CTX,
      ),
    ) as { url: string; holdsRoom: boolean; createsReservation: boolean };

    expect(calls).toHaveLength(1);
    const url = new URL(data.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://direct-book.com/properties/propertyChannelCode',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      check_in_date: '2026-10-01',
      check_out_date: '2026-10-03',
      number_adults: '2',
      number_children: '1',
      number_infants: '0',
      num_rooms: '1',
      promotion_code: 'SUMMER',
      promocode: 'SUMMER',
      locale: 'es',
      currency: 'COP',
    });
    expect(data.holdsRoom).toBe(false);
    expect(data.createsReservation).toBe(false);
  });

  it('keeps a query the engine URL already carries', async () => {
    const { provider: p } = provider({
      body: {
        ...property,
        bookingEngineUrl: 'https://book-directonline.com/properties/ABC?channel=site',
      },
    });
    const data = successData(await p.callTool('mcp_siteminder_build_booking_link', STAY, CTX)) as {
      url: string;
    };
    expect(new URL(data.url).searchParams.get('channel')).toBe('site');
  });

  it('says so when the hotel has no booking engine URL', async () => {
    const { provider: p } = provider({ body: { ...property, bookingEngineUrl: null } });
    const result = await p.callTool('mcp_siteminder_build_booking_link', STAY, CTX);
    expect(failure(result)).toMatchObject({ code: ProviderErrorCode.PROVIDER_ERROR });
    expect(failure(result).message).toContain('no booking engine URL');
  });

  it('never hands a guest a link that is not https', async () => {
    const { provider: p } = provider({
      body: { ...property, bookingEngineUrl: 'javascript:alert(1)' },
    });
    const result = await p.callTool('mcp_siteminder_build_booking_link', STAY, CTX);
    expect(failure(result).code).toBe(ProviderErrorCode.PROVIDER_ERROR);
  });

  it('refuses an impossible stay before reading the property', async () => {
    const { provider: p, calls } = provider({ body: property });
    const result = await p.callTool(
      'mcp_siteminder_build_booking_link',
      { checkIn: '2026-10-03', checkOut: '2026-10-01', adults: 2 },
      CTX,
    );
    expect(failure(result).code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(calls).toHaveLength(0);
  });

  it('passes a failed property read through with its own code', async () => {
    const { provider: p } = provider({ body: notAuthorisedReference, status: 401 });
    const result = await p.callTool('mcp_siteminder_build_booking_link', STAY, CTX);
    expect(failure(result).code).toBe(ProviderErrorCode.AUTH_EXPIRED);
  });
});

describe('siteminder provider — errors', () => {
  it.each([
    ['the reference body', notAuthorisedReference, 'NotAuthorised'],
    ['the quick-start body', notAuthorisedQuickStart, 'Unauthorized'],
    ['the observed invalid-key body', invalidKeyObserved, 'Unauthorized'],
    ['the observed missing-key body', missingKeyObserved, 'Unauthorized'],
  ])('maps a 401 with %s to AUTH_EXPIRED — only a new key fixes it', async (_l, body, name) => {
    const { provider: p } = provider({ body, status: 401 });
    const f = failure(await p.callTool('mcp_siteminder_get_property', {}, CTX));
    expect(f.code).toBe(ProviderErrorCode.AUTH_EXPIRED);
    expect(f.message).toBe(`SiteMinder get property failed (HTTP 401, ${name})`);
  });

  it('maps a 403 to AUTH_EXPIRED until a live 403 says otherwise (ADR 0007, design-notes Q2)', async () => {
    const { provider: p } = provider({ body: accessDenied, status: 403 });
    const f = failure(await p.callTool('mcp_siteminder_get_property', {}, CTX));
    expect(f.code).toBe(ProviderErrorCode.AUTH_EXPIRED);
    expect(f.message).toContain('AccessDenied');
  });

  it('maps a 429 to RATE_LIMITED', async () => {
    const { provider: p } = provider({ body: rateLimited, status: 429 });
    const f = failure(await p.callTool('mcp_siteminder_get_quotes', STAY, CTX));
    expect(f.code).toBe(ProviderErrorCode.RATE_LIMITED);
    expect(f.message).toContain('RateLimited');
  });

  it('maps a 500 to PROVIDER_UNAVAILABLE', async () => {
    const { provider: p } = provider({
      body: { errors: [{ name: 'InternalServerError' }] },
      status: 500,
    });
    const f = failure(await p.callTool('mcp_siteminder_list_room_types', {}, CTX));
    expect(f.code).toBe(ProviderErrorCode.PROVIDER_UNAVAILABLE);
  });

  it("never puts SiteMinder's free-text message into the error", async () => {
    const { provider: p } = provider({
      body: {
        errors: [{ name: 'BadRequest', message: 'checkOut must be <= 31 nights, guest John' }],
      },
      status: 400,
    });
    const f = failure(await p.callTool('mcp_siteminder_get_quotes', STAY, CTX));
    expect(f.code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(f.message).toBe('SiteMinder get quotes failed (HTTP 400, BadRequest)');
  });

  it('drops an error identifier that is really free text', async () => {
    const { provider: p } = provider({ body: { error: 'the key abc is invalid' }, status: 401 });
    const f = failure(await p.callTool('mcp_siteminder_get_property', {}, CTX));
    expect(f.message).toBe('SiteMinder get property failed (HTTP 401)');
  });

  it('treats a 200 with no body as a failure, not an empty hotel', async () => {
    const { provider: p } = provider({ body: null });
    const f = failure(await p.callTool('mcp_siteminder_get_property', {}, CTX));
    expect(f.code).toBe(ProviderErrorCode.PROVIDER_ERROR);
  });
});

describe('siteminder provider — credential containment', () => {
  it('keeps the key out of an error that echoes it back', async () => {
    const { provider: p } = provider({
      body: { errors: [{ name: 'NotAuthorised', message: `bad key ${KEY}` }] },
      status: 401,
    });
    const result = await p.callTool('mcp_siteminder_get_property', {}, CTX);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it.each([
    ['a flat error', { error: KEY }],
    ['an error code', { errors: [{ code: KEY }] }],
    ['an error name', { errors: [{ name: KEY }] }],
  ])('keeps a key echoed into %s out of the result', async (_l, body) => {
    const { provider: p } = provider({ body, status: 401 });
    const result = await p.callTool('mcp_siteminder_get_property', {}, CTX);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('keeps the key out of a transport failure', async () => {
    const impl = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${BASE}`);
    }) as unknown as typeof globalThis.fetch;
    const p = createSiteminderProvider({ fetchImpl: impl });
    const result = await p.callTool('mcp_siteminder_get_property', {}, CTX);
    expect(failure(result).code).toBe(ProviderErrorCode.PROVIDER_UNAVAILABLE);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});
