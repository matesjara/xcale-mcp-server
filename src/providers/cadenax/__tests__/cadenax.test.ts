import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../../../core/catalog';
import { ProviderErrorCode } from '../../../core/errors';
import { createRegistry } from '../../../core/registry';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import type { ProviderCallContext } from '../../../core/types';
import { PROVIDERS } from '../..';
import { cadenaxProvider, createCadenaxProvider } from '../provider';
import lotsSearch from '../__fixtures__/lots-search.json';
import reservation from '../__fixtures__/reservation.json';
import staffByPhone from '../__fixtures__/staff-by-phone.json';
import whoami from '../__fixtures__/whoami.json';
import whoamiTwoOffices from '../__fixtures__/whoami-two-offices.json';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface Captured {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
}

/** A fake `fetch` that records each request and answers with a canned JSON body and status. */
function fakeFetch(opts: { status?: number; body?: unknown; capture?: Captured[] }): typeof fetch {
  const status = opts.status ?? 200;
  return (async (url: string, init: Captured['init']) => {
    opts.capture?.push({ url, init });
    const text = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? '');
    return new Response(text, { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

/** A visibly fake key, in the shape Cadenax prints them. */
const KEY = 'cof_dev_FAKEFAKEFAKE';

const ctx: ProviderCallContext = {
  credential: { secret: new SecretString(KEY) },
  metadata: { office: 'USA' },
};

const BASE = 'https://api-cofinet.cadenax.com/api';
const ID = '64f0000000000000000000c1';

const PUBLISHED = [
  'mcp_cadenax_get_contract',
  'mcp_cadenax_get_delivery',
  'mcp_cadenax_get_lot',
  'mcp_cadenax_get_reservation',
  'mcp_cadenax_list_expiring_contracts',
  'mcp_cadenax_search_companies',
  'mcp_cadenax_search_contacts',
  'mcp_cadenax_search_contracts',
  'mcp_cadenax_search_deliveries',
  'mcp_cadenax_search_lots',
  'mcp_cadenax_search_reservations',
];

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

describe('cadenax provider — discovery', () => {
  it('passes provider conformance', async () => {
    await runProviderConformance(cadenaxProvider);
  });

  it('is registered, so the catalog lists it', () => {
    expect(PROVIDERS.map((p) => p.manifest.slug)).toContain('cadenax');
  });

  it('publishes a forwarded API key in the X-API-Key header, with no secret in the descriptor', () => {
    const [entry] = buildCatalog(createRegistry([cadenaxProvider]));
    expect(entry?.authDescriptor).toEqual({
      type: 'api_key',
      credentialDelivery: 'forwarded',
      fields: [{ key: 'X-API-Key', label: 'API key', placement: 'header' }],
    });
  });

  it('proves a key and discovers its office with the same no-context tool', () => {
    expect(cadenaxProvider.manifest.connectionProbe).toEqual({ tool: 'mcp_cadenax_whoami' });
    expect(cadenaxProvider.manifest.contextDiscovery).toEqual({
      key: 'office',
      tool: 'mcp_cadenax_whoami',
      resultPath: 'assignedOffices.0.code',
    });
  });

  it('names the office by a required code in the call context', () => {
    const schema = cadenaxProvider.contextSchema as
      | { properties?: Record<string, { type?: string }>; required?: readonly string[] }
      | undefined;
    expect(schema?.required).toEqual(['office']);
    expect(schema?.properties?.office?.type).toBe('string');
  });

  it('publishes the reads to an agent and keeps the identity tools off its menu', () => {
    const tools = cadenaxProvider.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(PUBLISHED);
    // Every published tool is a read for the account's own staff, and says so.
    for (const t of tools) {
      expect(t.readOnly, t.name).toBe(true);
      expect(t.audience, t.name).toBe('operator');
    }
  });

  it("declares that every client-record tool returns other people's records", () => {
    const tools = cadenaxProvider.listTools();
    const withoutPolicy = tools.filter((t) => t.identityPolicy === undefined).map((t) => t.name);
    // Lots are inventory: nobody's personal record.
    expect(withoutPolicy.sort()).toEqual(['mcp_cadenax_get_lot', 'mcp_cadenax_search_lots']);
    for (const t of tools.filter((t) => t.identityPolicy !== undefined)) {
      expect(t.identityPolicy, t.name).toEqual({ mode: 'subject-scoped' });
    }
  });
});

// ---------------------------------------------------------------------------
// whoami — the probe and the context discovery
// ---------------------------------------------------------------------------

describe('cadenax provider — whoami', () => {
  it('reads GET /auth/me with the key in X-API-Key and needs no context', async () => {
    const capture: Captured[] = [];
    const provider = createCadenaxProvider({ fetchImpl: fakeFetch({ body: whoami, capture }) });

    const r = await provider.callTool(
      'mcp_cadenax_whoami',
      {},
      { credential: ctx.credential, metadata: {} },
    );

    expect(r).toMatchObject({ kind: 'success', data: whoami });
    expect(capture).toHaveLength(1);
    expect(capture[0]?.init.method).toBe('GET');
    expect(capture[0]?.url).toBe(`${BASE}/auth/me`);
    expect(capture[0]?.init.headers?.['X-API-Key']).toBe(KEY);
    // The key travels in a header: never in the URL.
    expect(capture[0]?.url).not.toContain(KEY);
  });

  it('answers the office the manifest tells a consumer to read', async () => {
    const provider = createCadenaxProvider({ fetchImpl: fakeFetch({ body: whoami }) });
    const r = await provider.callTool('mcp_cadenax_whoami', {}, ctx);
    const data = (r as { data: typeof whoami }).data;
    expect(data.assignedOffices[0]?.code).toBe('USA');
  });

  it('refuses a key that reaches more than one office, naming them', async () => {
    const provider = createCadenaxProvider({ fetchImpl: fakeFetch({ body: whoamiTwoOffices }) });
    const r = await provider.callTool('mcp_cadenax_whoami', {}, ctx);
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
    expect((r as { message: string }).message).toContain('2 offices (USA, EUROPE)');
  });

  it('refuses the profile of a human session: only a key connects', async () => {
    const provider = createCadenaxProvider({
      fetchImpl: fakeFetch({ body: { _id: ID, email: 'someone@example.com', role: 'admin' } }),
    });
    const r = await provider.callTool('mcp_cadenax_whoami', {}, ctx);
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
  });

  it('reports a dead key as reconnect-required', async () => {
    const provider = createCadenaxProvider({
      fetchImpl: fakeFetch({ status: 401, body: { error: 'Invalid or expired API key' } }),
    });
    const r = await provider.callTool('mcp_cadenax_whoami', {}, ctx);
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
    expect((r as { message: string }).message).toBe(
      'Cadenax whoami failed (HTTP 401): Invalid or expired API key',
    );
  });

  it('is dispatched by name though it is not on the menu', async () => {
    expect(cadenaxProvider.listTools().map((t) => t.name)).not.toContain('mcp_cadenax_whoami');
  });
});

// ---------------------------------------------------------------------------
// resolve_staff_by_phone — the consumer's audience question
// ---------------------------------------------------------------------------

describe('cadenax provider — resolve_staff_by_phone', () => {
  it("asks Cadenax about the connection's office and returns the staff member", async () => {
    const capture: Captured[] = [];
    const provider = createCadenaxProvider({
      fetchImpl: fakeFetch({ body: staffByPhone, capture }),
    });

    const r = await provider.callTool(
      'mcp_cadenax_resolve_staff_by_phone',
      { phone: '+57 311 7904018' },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'success', data: { found: true, staff: staffByPhone.data } });
    const url = new URL(capture[0]?.url ?? '');
    expect(url.pathname).toBe('/api/users/by-phone');
    expect(url.searchParams.get('phone')).toBe('+57 311 7904018');
    expect(url.searchParams.get('office')).toBe('USA');
  });

  it('answers a 404 as "not staff", which is an answer and not a failure', async () => {
    const provider = createCadenaxProvider({
      fetchImpl: fakeFetch({
        status: 404,
        body: { error: 'No active user of this office matches that phone' },
      }),
    });
    const r = await provider.callTool(
      'mcp_cadenax_resolve_staff_by_phone',
      { phone: '3000000000' },
      ctx,
    );
    expect(r).toMatchObject({ kind: 'success', data: { found: false } });
  });

  it('never turns a failure into "not staff": a caller that fails closed must see it', async () => {
    for (const status of [401, 403, 500, 503]) {
      const provider = createCadenaxProvider({
        fetchImpl: fakeFetch({ status, body: { error: 'nope' } }),
      });
      const r = await provider.callTool(
        'mcp_cadenax_resolve_staff_by_phone',
        { phone: '3000000000' },
        ctx,
      );
      expect(r, String(status)).toMatchObject({ kind: 'error' });
    }
  });

  it('refuses a 200 that carries no staff member', async () => {
    const provider = createCadenaxProvider({ fetchImpl: fakeFetch({ body: { data: null } }) });
    const r = await provider.callTool(
      'mcp_cadenax_resolve_staff_by_phone',
      { phone: '3000000000' },
      ctx,
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
  });
});

// ---------------------------------------------------------------------------
// The office comes from the connection
// ---------------------------------------------------------------------------

describe('cadenax provider — office scope', () => {
  const OFFICE_TOOLS: ReadonlyArray<[string, Record<string, unknown>, string]> = [
    ['mcp_cadenax_search_lots', {}, '/api/lots/search'],
    ['mcp_cadenax_get_lot', { lotId: ID }, `/api/lots/${ID}`],
    ['mcp_cadenax_search_reservations', {}, '/api/reservations/search'],
    ['mcp_cadenax_get_reservation', { reservationId: ID }, `/api/reservations/${ID}`],
    ['mcp_cadenax_search_contracts', {}, '/api/contracts/search'],
    ['mcp_cadenax_list_expiring_contracts', {}, '/api/contracts/expiring'],
    ['mcp_cadenax_get_contract', { contractId: ID }, `/api/contracts/${ID}`],
    ['mcp_cadenax_search_deliveries', {}, '/api/deliveries/search'],
    ['mcp_cadenax_get_delivery', { deliveryId: ID }, `/api/deliveries/${ID}`],
  ];

  it.each(OFFICE_TOOLS)('%s sends the connection office', async (name, args, path) => {
    const capture: Captured[] = [];
    const provider = createCadenaxProvider({
      fetchImpl: fakeFetch({ body: { success: true, data: [] }, capture }),
    });

    await provider.callTool(name, args, ctx);

    const url = new URL(capture[0]?.url ?? '');
    expect(url.pathname).toBe(path);
    expect(url.searchParams.get('office')).toBe('USA');
    expect(capture[0]?.init.method).toBe('GET');
  });

  it.each(OFFICE_TOOLS)(
    '%s never sends an office an agent named: the argument is refused or dropped',
    async (name, args) => {
      const capture: Captured[] = [];
      const provider = createCadenaxProvider({
        fetchImpl: fakeFetch({ body: { success: true, data: [] }, capture }),
      });

      await provider.callTool(name, { ...args, office: 'EUROPE' }, ctx);

      // A detail tool refuses the unknown argument; a paginated search drops it (the core's list
      // helper does not keep a schema strict). Either way Cadenax is only ever asked about USA.
      for (const sent of capture) {
        expect(new URL(sent.url).searchParams.getAll('office')).toEqual(['USA']);
      }
    },
  );

  it('refuses a call without an office before reaching Cadenax', async () => {
    const capture: Captured[] = [];
    const provider = createCadenaxProvider({ fetchImpl: fakeFetch({ capture }) });
    const r = await provider.callTool(
      'mcp_cadenax_search_lots',
      {},
      { credential: ctx.credential, metadata: {} },
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(0);
  });

  it('refuses an office that is not a code', async () => {
    const capture: Captured[] = [];
    const provider = createCadenaxProvider({ fetchImpl: fakeFetch({ capture }) });
    const r = await provider.callTool(
      'mcp_cadenax_search_lots',
      {},
      { credential: ctx.credential, metadata: { office: 'USA&office=EUROPE' } },
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(0);
  });

  it('searches the one client book without an office, as Cadenax keeps it', async () => {
    for (const [name, path] of [
      ['mcp_cadenax_search_companies', '/api/companies/search'],
      ['mcp_cadenax_search_contacts', '/api/contacts/search'],
    ] as const) {
      const capture: Captured[] = [];
      const provider = createCadenaxProvider({
        fetchImpl: fakeFetch({ body: { success: true, data: [] }, capture }),
      });
      await provider.callTool(name, { q: 'nord' }, ctx);
      const url = new URL(capture[0]?.url ?? '');
      expect(url.pathname).toBe(path);
      expect(url.searchParams.get('q')).toBe('nord');
      expect(url.searchParams.has('office')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe('cadenax provider — reads', () => {
  it('pages a search, mapping the uniform page onto Cadenax page/limit', async () => {
    const capture: Captured[] = [];
    const provider = createCadenaxProvider({
      fetchImpl: fakeFetch({ body: lotsSearch, capture }),
    });

    const r = await provider.callTool(
      'mcp_cadenax_search_lots',
      {
        q: 'geisha',
        process: 'washed',
        lotStatus: 'physical',
        isAvailableForReservation: true,
        availableStock_gt: 100,
        page: 1,
        pageSize: 25,
      },
      ctx,
    );

    expect(r).toMatchObject({
      kind: 'success',
      data: {
        items: lotsSearch.data,
        page: 1,
        pageSize: 25,
        totalPages: 2,
        totalResults: 40,
        hasMore: true,
      },
    });
    const params = new URL(capture[0]?.url ?? '').searchParams;
    expect(Object.fromEntries(params)).toEqual({
      q: 'geisha',
      process: 'washed',
      lotStatus: 'physical',
      isAvailableForReservation: 'true',
      availableStock_gt: '100',
      office: 'USA',
      page: '1',
      limit: '25',
    });
  });

  it('defaults a search to the first page of 25 and caps a page at 100', async () => {
    const capture: Captured[] = [];
    const provider = createCadenaxProvider({
      fetchImpl: fakeFetch({ body: lotsSearch, capture }),
    });

    await provider.callTool('mcp_cadenax_search_reservations', { expiringWithinDays: 7 }, ctx);
    const params = new URL(capture[0]?.url ?? '').searchParams;
    expect(params.get('page')).toBe('1');
    expect(params.get('limit')).toBe('25');
    expect(params.get('expiringWithinDays')).toBe('7');

    const tooWide = await provider.callTool(
      'mcp_cadenax_search_reservations',
      { pageSize: 500 },
      ctx,
    );
    expect(tooWide).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(1);
  });

  it('returns a record as Cadenax sent it, envelope included', async () => {
    const provider = createCadenaxProvider({ fetchImpl: fakeFetch({ body: reservation }) });
    const r = await provider.callTool('mcp_cadenax_get_reservation', { reservationId: ID }, ctx);
    expect(r).toMatchObject({ kind: 'success', data: reservation });
  });

  it('passes includeDeliveries and days through', async () => {
    const capture: Captured[] = [];
    const provider = createCadenaxProvider({
      fetchImpl: fakeFetch({ body: { success: true, contracts: [] }, capture }),
    });
    await provider.callTool(
      'mcp_cadenax_get_contract',
      { contractId: ID, includeDeliveries: true },
      ctx,
    );
    await provider.callTool('mcp_cadenax_list_expiring_contracts', { days: 30 }, ctx);
    expect(new URL(capture[0]?.url ?? '').searchParams.get('includeDeliveries')).toBe('true');
    expect(new URL(capture[1]?.url ?? '').searchParams.get('days')).toBe('30');
  });

  it('refuses an id that is not a Cadenax id, so a path is never built from one', async () => {
    const capture: Captured[] = [];
    const provider = createCadenaxProvider({ fetchImpl: fakeFetch({ capture }) });
    for (const lotId of ['..', '../api-keys', 'summary', `${ID}/../x`, '']) {
      const r = await provider.callTool('mcp_cadenax_get_lot', { lotId }, ctx);
      expect(r, lotId).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    }
    expect(capture).toHaveLength(0);
  });

  it('refuses a date that does not exist', async () => {
    const provider = createCadenaxProvider({ fetchImpl: fakeFetch({ body: lotsSearch }) });
    const r = await provider.callTool(
      'mcp_cadenax_search_reservations',
      { expiryFrom: '2027-02-30' },
      ctx,
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
  });

  it('reports a search answer that is not a list, and a null body, as provider errors', async () => {
    for (const body of [{ success: true }, { success: true, data: {} }, 'null']) {
      const provider = createCadenaxProvider({ fetchImpl: fakeFetch({ body }) });
      const r = await provider.callTool('mcp_cadenax_search_lots', {}, ctx);
      expect(r, JSON.stringify(body)).toMatchObject({
        kind: 'error',
        code: ProviderErrorCode.PROVIDER_ERROR,
      });
    }
    const provider = createCadenaxProvider({ fetchImpl: fakeFetch({ body: 'null' }) });
    const r = await provider.callTool('mcp_cadenax_get_lot', { lotId: ID }, ctx);
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
  });

  it('honours a base URL override (staging)', async () => {
    const capture: Captured[] = [];
    const provider = createCadenaxProvider({
      baseUrl: 'https://staging-api-cofinet.cadenax.com/api/',
      fetchImpl: fakeFetch({ body: whoami, capture }),
    });
    await provider.callTool('mcp_cadenax_whoami', {}, ctx);
    expect(capture[0]?.url).toBe('https://staging-api-cofinet.cadenax.com/api/auth/me');
  });

  it('returns a typed error for an unknown tool', async () => {
    const r = await cadenaxProvider.callTool('mcp_cadenax_nope', {}, ctx);
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.UNKNOWN_TOOL });
  });
});

// ---------------------------------------------------------------------------
// Errors through the full call path
// ---------------------------------------------------------------------------

describe('cadenax provider — errors', () => {
  const call = (status: number, body: unknown, tool = 'mcp_cadenax_search_lots') =>
    createCadenaxProvider({ fetchImpl: fakeFetch({ status, body }) }).callTool(tool, {}, ctx);

  it('maps a dead key to reconnect-required on a read', async () => {
    const r = await call(401, { error: 'Invalid or expired API key' });
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
  });

  it('never asks for a reconnect on a 403: the key is live and Cadenax refused the act', async () => {
    for (const body of [
      { error: 'Access denied for this office' },
      { error: 'Insufficient permissions' },
      {
        error: 'This API key resolves to no reachable office.',
        details: { code: 'API_KEY_SCOPE_UNRESOLVED' },
      },
    ]) {
      const r = await call(403, body);
      expect(r, body.error).toMatchObject({
        kind: 'error',
        code: ProviderErrorCode.PROVIDER_ERROR,
      });
      expect((r as { message: string }).message).toContain(body.error);
    }
  });

  it("carries Cadenax's machine code and sentence", async () => {
    const r = await call(403, {
      error: 'This API key resolves to no reachable office.',
      details: { code: 'API_KEY_SCOPE_UNRESOLVED' },
    });
    expect((r as { message: string }).message).toBe(
      'Cadenax search lots failed (HTTP 403, API_KEY_SCOPE_UNRESOLVED): ' +
        'This API key resolves to no reachable office.',
    );
  });

  it('maps rate limiting, an unavailable directory, a server error and bad input', async () => {
    expect(await call(429, { error: 'Too many requests' })).toMatchObject({
      code: ProviderErrorCode.RATE_LIMITED,
    });
    expect(
      await call(503, {
        error: 'Office directory temporarily unavailable. Retry shortly.',
        details: { code: 'OFFICE_DIRECTORY_UNAVAILABLE' },
      }),
    ).toMatchObject({ code: ProviderErrorCode.PROVIDER_UNAVAILABLE });
    expect(await call(500, { error: 'Failed to search lots' })).toMatchObject({
      code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
    });
    expect(await call(400, { error: 'Office parameter is required' })).toMatchObject({
      code: ProviderErrorCode.INVALID_INPUT,
    });
  });

  it('reports a record Cadenax does not find as a provider error with its sentence', async () => {
    const r = await createCadenaxProvider({
      fetchImpl: fakeFetch({ status: 404, body: { error: 'Lot not found' } }),
    }).callTool('mcp_cadenax_get_lot', { lotId: ID }, ctx);
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
    expect((r as { message: string }).message).toBe(
      'Cadenax get lot failed (HTTP 404): Lot not found',
    );
  });

  it('never puts the key, a URL or a raw body in an error', async () => {
    const r = await call(
      500,
      `<html>${KEY} https://api-cofinet.cadenax.com/api/lots/search</html>`,
    );
    const message = (r as { message: string }).message;
    expect(message).toBe('Cadenax search lots failed (HTTP 500)');
    const echoed = await call(400, { error: `bad key ${KEY}` });
    expect((echoed as { message: string }).message).toBe('Cadenax search lots failed (HTTP 400)');
  });
});
