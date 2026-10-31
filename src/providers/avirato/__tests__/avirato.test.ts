import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../../../core/catalog';
import { ProviderErrorCode } from '../../../core/errors';
import { createRegistry } from '../../../core/registry';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import type { ProviderCallContext } from '../../../core/types';
import { createAviratoClient } from '../client';
import { aviratoProvider, createAviratoProvider } from '../provider';
import { buildAviratoTools } from '../tools';
import availability from '../__fixtures__/availability.json';
import cancelled from '../__fixtures__/cancel.json';
import created from '../__fixtures__/create.json';
import errorInvalidToken from '../__fixtures__/error-invalid-token.json';
import errorRetrieving from '../__fixtures__/error-retrieving.json';
import errorValidation from '../__fixtures__/error-validation.json';
import establishment from '../__fixtures__/establishment.json';
import extra from '../__fixtures__/extra.json';
import modified from '../__fixtures__/modify.json';
import promoUnknown from '../__fixtures__/promo-unknown.json';
import quoteDuplicated from '../__fixtures__/quote-duplicated.json';
import rate from '../__fixtures__/rate.json';
import regime from '../__fixtures__/regime.json';
import reservation from '../__fixtures__/reservation.json';
import reservationsByClient from '../__fixtures__/reservations-by-client.json';
import space from '../__fixtures__/space.json';
import urlsGuest from '../__fixtures__/urls-guest.json';

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

const ctx: ProviderCallContext = {
  credential: { secret: new SecretString('minted-jwt') },
  metadata: { web_code: 1234 },
};

// ---------------------------------------------------------------------------
// S1 — skeleton, discovery and the first read
// ---------------------------------------------------------------------------

describe('avirato provider — S1 discovery', () => {
  it('passes provider conformance', async () => {
    await runProviderConformance(aviratoProvider);
  });

  it('is the avirato hospitality provider', () => {
    expect(aviratoProvider.manifest.slug).toBe('avirato');
    expect(aviratoProvider.manifest.displayName).toBe('Avirato');
    expect(aviratoProvider.manifest.category).toBe('hospitality');
    expect(aviratoProvider.manifest.connectionProbe).toBeUndefined();
    expect(aviratoProvider.manifest.contextDiscovery).toBeUndefined();
  });

  it('publishes a credential_exchange mint at /v3/token/login, the token nested at data.token, reused 15 minutes', () => {
    const [entry] = buildCatalog(createRegistry([aviratoProvider]));
    expect(entry?.authDescriptor).toEqual({
      type: 'credential_exchange',
      credentialDelivery: 'reference',
      tokenEndpoint: 'https://apiv3.avirato.com/v3/token/login',
      method: 'POST',
      bodyFields: { email: 'email', password: 'password' },
      responseFields: { token: 'data.token' },
      tokenTtlSeconds: 900,
      tokenPlacement: 'bearer_header',
    });
  });

  it('names the establishment by a required numeric web_code in the call context', () => {
    const schema = aviratoProvider.contextSchema as
      | { properties?: Record<string, { type?: string }>; required?: readonly string[] }
      | undefined;
    expect(schema?.required).toEqual(['web_code']);
    expect(schema?.properties?.web_code?.type).toBe('integer');
  });
});

describe('avirato provider — S1 get_establishment', () => {
  it('reads the establishment of the context web_code, bearer-authenticated, and returns Avirato data unwrapped', async () => {
    const capture: Captured[] = [];
    const provider = createAviratoProvider({
      fetchImpl: fakeFetch({ body: establishment, capture }),
    });

    const r = await provider.callTool('mcp_avirato_get_establishment', {}, ctx);

    expect(r).toMatchObject({ kind: 'success', data: establishment.data });
    expect(capture).toHaveLength(1);
    expect(capture[0]?.init.method).toBe('GET');
    expect(capture[0]?.url).toBe('https://apiv3.avirato.com/v3/establishment?web_code=1234');
    expect(capture[0]?.init.headers?.authorization ?? capture[0]?.init.headers?.Authorization).toBe(
      'Bearer minted-jwt',
    );
  });

  it('honours a base URL override (the sandbox)', async () => {
    const capture: Captured[] = [];
    const provider = createAviratoProvider({
      baseUrl: 'https://sandbox.avirato.com/v3/',
      fetchImpl: fakeFetch({ body: establishment, capture }),
    });

    await provider.callTool('mcp_avirato_get_establishment', {}, ctx);

    expect(capture[0]?.url).toBe('https://sandbox.avirato.com/v3/establishment?web_code=1234');
  });

  it('refuses a call without a web_code before reaching Avirato', async () => {
    const capture: Captured[] = [];
    const provider = createAviratoProvider({ fetchImpl: fakeFetch({ capture }) });

    const r = await provider.callTool(
      'mcp_avirato_get_establishment',
      {},
      {
        credential: ctx.credential,
        metadata: {},
      },
    );

    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// S2 — catalog reads
// ---------------------------------------------------------------------------

/** Calls one tool against a canned Avirato answer and returns the result and the request it sent. */
async function callWith(name: string, args: Record<string, unknown>, body: unknown, status = 200) {
  const capture: Captured[] = [];
  const provider = createAviratoProvider({ fetchImpl: fakeFetch({ body, status, capture }) });
  const result = await provider.callTool(name, args, ctx);
  return { result, capture };
}

describe('avirato provider — S2 catalog reads', () => {
  it.each([
    ['mcp_avirato_list_room_types', 'space', space],
    ['mcp_avirato_list_rates', 'rate', rate],
    ['mcp_avirato_list_regimes', 'regime', regime],
    ['mcp_avirato_list_extras', 'extra', extra],
  ])(
    '%s reads /%s of the context web_code and returns the array verbatim',
    async (name, path, body) => {
      const { result, capture } = await callWith(name, {}, body);

      expect(result).toMatchObject({ kind: 'success', data: body.data });
      expect(capture[0]?.init.method).toBe('GET');
      expect(capture[0]?.url).toBe(`https://apiv3.avirato.com/v3/${path}?web_code=1234`);
    },
  );

  it('check_availability sends the stay window and returns the subtypes day by day', async () => {
    const { result, capture } = await callWith(
      'mcp_avirato_check_availability',
      { start_date: '2027-02-16', end_date: '2027-02-17' },
      availability,
    );

    expect(result).toMatchObject({ kind: 'success', data: availability.data });
    expect(capture[0]?.url).toBe(
      'https://apiv3.avirato.com/v3/availability?web_code=1234&start_date=2027-02-16&end_date=2027-02-17',
    );
  });

  it('check_availability narrows to one subtype when asked', async () => {
    const { capture } = await callWith(
      'mcp_avirato_check_availability',
      { start_date: '2027-02-16', end_date: '2027-02-16', space_subtype_id: 2 },
      availability,
    );

    expect(capture[0]?.url).toContain('&space_subtype_id=2');
  });

  it.each([
    [{ start_date: '2027-02-30', end_date: '2027-03-01' }, 'a day that does not exist'],
    [{ start_date: '16/02/2027', end_date: '2027-02-17' }, 'a date not in YYYY-MM-DD'],
    [{ start_date: '2027-02-17', end_date: '2027-02-16' }, 'an end before the start'],
  ])('check_availability refuses %j (%s) before reaching Avirato', async (args) => {
    const { result, capture } = await callWith(
      'mcp_avirato_check_availability',
      args,
      availability,
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(0);
  });

  it('validate_promotional_code answers { valid: false } when Avirato knows no such code', async () => {
    const { result, capture } = await callWith(
      'mcp_avirato_validate_promotional_code',
      { code: 'VERANO 10' },
      promoUnknown,
    );

    expect(result).toMatchObject({ kind: 'success', data: { valid: false } });
    expect(capture[0]?.url).toBe(
      'https://apiv3.avirato.com/v3/promotional_codes/VERANO%2010?web_code=1234',
    );
  });

  it('validate_promotional_code passes a known code through as { valid: true, code }', async () => {
    const known = { status: 'success', data: { code: 'VERANO10', discount: 10 } };
    const { result } = await callWith(
      'mcp_avirato_validate_promotional_code',
      { code: 'VERANO10' },
      known,
    );

    expect(result).toMatchObject({ kind: 'success', data: { valid: true, code: known.data } });
  });

  it('marks every catalog read read-only and keeps all of them on the agent menu', () => {
    const listed = aviratoProvider.listTools();
    for (const name of [
      'mcp_avirato_get_establishment',
      'mcp_avirato_list_room_types',
      'mcp_avirato_list_rates',
      'mcp_avirato_list_regimes',
      'mcp_avirato_list_extras',
      'mcp_avirato_check_availability',
      'mcp_avirato_validate_promotional_code',
    ]) {
      const t = listed.find((tool) => tool.name === name);
      expect(t, name).toBeDefined();
      expect(t?.readOnly, name).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// S3 — error mapping (contract §D)
// ---------------------------------------------------------------------------

describe('avirato provider — S3 errors', () => {
  const read = 'mcp_avirato_get_establishment';

  it('a rejected or superseded token (401) asks for a fresh mint: PROVIDER_AUTH_EXPIRED', async () => {
    const { result } = await callWith(read, {}, errorInvalidToken, 401);
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
  });

  it('a missing permission (403) is not a reconnect: PROVIDER_ERROR', async () => {
    const forbidden = { statusCode: 403, errorCode: 'FORBBIDEN', message: 'Forbidden' };
    const { result } = await callWith(read, {}, forbidden, 403);
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
    expect((result as { message: string }).message).toContain('FORBBIDEN');
  });

  it('a burst over the limit (429) is PROVIDER_RATE_LIMITED', async () => {
    const { result } = await callWith(
      read,
      {},
      { statusCode: 429, message: 'Too Many Requests' },
      429,
    );
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.RATE_LIMITED });
  });

  it('Avirato down (5xx) is PROVIDER_UNAVAILABLE', async () => {
    const { result } = await callWith(read, {}, 'Bad Gateway', 502);
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_UNAVAILABLE });
  });

  it('a validation refusal is PROVIDER_INVALID_INPUT and names what Avirato refused', async () => {
    const { result } = await callWith(read, {}, errorValidation, 400);
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    const message = (result as { message: string }).message;
    expect(message).toContain('INPUT_DATA_VALIDATION_FAILED');
    expect(message).toContain('start_date must be a valid ISO 8601 date string');
  });

  it('"not found or cancelled" is PROVIDER_ERROR with a plain reason, not a validation error', async () => {
    const { result } = await callWith(read, {}, errorRetrieving, 400);
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
    expect((result as { message: string }).message).toContain('not found or cancelled');
  });

  it('never echoes the request path, the web_code or the token in an error message', async () => {
    for (const [body, status] of [
      [errorRetrieving, 400],
      [errorValidation, 400],
      [errorInvalidToken, 401],
    ] as const) {
      const { result } = await callWith(read, {}, body, status);
      const message = (result as { message: string }).message;
      expect(message).not.toContain('/v3/');
      expect(message).not.toContain('1234');
      expect(message).not.toContain('minted-jwt');
    }
  });
});

// ---------------------------------------------------------------------------
// S4 — the quote (control plane)
// ---------------------------------------------------------------------------

describe('avirato provider — S4 quote_stay', () => {
  const stay = {
    start_date: '2027-02-16',
    end_date: '2027-02-17',
    rooms: [{ space_subtype_id: 2, adults: 2, children: 0 }],
  };

  it('is routable by name but withdrawn from the agent menu', () => {
    expect(aviratoProvider.listTools().map((t) => t.name)).not.toContain('mcp_avirato_quote_stay');
    expect(aviratoProvider.routableToolNames()).toContain('mcp_avirato_quote_stay');
  });

  it('POSTs the stay to /price/price_for_reservation and returns the rows with exact duplicates removed', async () => {
    const { result, capture } = await callWith(
      'mcp_avirato_quote_stay',
      stay,
      quoteDuplicated,
      201,
    );

    expect(capture[0]?.init.method).toBe('POST');
    expect(capture[0]?.url).toBe(
      'https://apiv3.avirato.com/v3/price/price_for_reservation?web_code=1234',
    );
    expect(JSON.parse(capture[0]?.init.body ?? '{}')).toEqual(stay);
    expect(result).toMatchObject({
      kind: 'success',
      data: { items: [quoteDuplicated.data[0], quoteDuplicated.data[2]] },
    });
  });

  it('sends rate_ids as numbers — Avirato refuses them as strings', async () => {
    const { capture } = await callWith(
      'mcp_avirato_quote_stay',
      { ...stay, rate_ids: [2, 11] },
      quoteDuplicated,
      201,
    );

    expect(JSON.parse(capture[0]?.init.body ?? '{}').rate_ids).toEqual([2, 11]);
  });

  it.each([
    [{ ...stay, end_date: '2027-02-16' }, 'a stay of zero nights'],
    [{ ...stay, rooms: [] }, 'no room'],
    [{ ...stay, rooms: [{ space_subtype_id: 2, adults: 0, children: 0 }] }, 'a room with no adult'],
    [{ ...stay, rate_ids: ['2'] }, 'a rate id as a string'],
  ] as Array<[Record<string, unknown>, string]>)(
    'refuses %j (%s) before reaching Avirato',
    async (args) => {
      const { result, capture } = await callWith(
        'mcp_avirato_quote_stay',
        args,
        quoteDuplicated,
        201,
      );

      expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
      expect(capture).toHaveLength(0);
    },
  );
});

// ---------------------------------------------------------------------------
// S5 — reservation reads, each declaring whose record it reaches
// ---------------------------------------------------------------------------

describe('avirato provider — S5 reservation reads', () => {
  const published = () => new Map(aviratoProvider.listTools().map((t) => [t.name, t]));

  it('get_reservation reads one reservation by id and returns the row, not Avirato’s one-element array', async () => {
    const { result, capture } = await callWith(
      'mcp_avirato_get_reservation',
      { reservation_id: 901 },
      reservation,
    );

    expect(capture[0]?.url).toBe('https://apiv3.avirato.com/v3/reservation/901?web_code=1234');
    expect(result).toMatchObject({ kind: 'success', data: reservation.data[0] });
  });

  it('get_reservation of a cancelled or unknown id is PROVIDER_ERROR, not found or cancelled', async () => {
    const { result } = await callWith(
      'mcp_avirato_get_reservation',
      { reservation_id: 901 },
      errorRetrieving,
      400,
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
    expect((result as { message: string }).message).toContain('not found or cancelled');
  });

  it('find_reservations_by_guest reads by client document and returns { items }', async () => {
    const { result, capture } = await callWith(
      'mcp_avirato_find_reservations_by_guest',
      { client_doc: 'TEST 0001' },
      reservationsByClient,
    );

    expect(capture[0]?.url).toBe(
      'https://apiv3.avirato.com/v3/reservation/client/TEST%200001?web_code=1234',
    );
    expect(result).toMatchObject({ kind: 'success', data: { items: reservationsByClient.data } });
  });

  it('find_reservations_by_guest of an unknown document is an empty list, not an error', async () => {
    const { result } = await callWith(
      'mcp_avirato_find_reservations_by_guest',
      { client_doc: 'NOBODY' },
      errorRetrieving,
      400,
    );

    expect(result).toMatchObject({ kind: 'success', data: { items: [] } });
  });

  it('get_reservation_links asks for one link type and returns { type, url } verbatim', async () => {
    const { result, capture } = await callWith(
      'mcp_avirato_get_reservation_links',
      { reservation_id: 901, type: 'Guest' },
      urlsGuest,
    );

    expect(capture[0]?.url).toBe(
      'https://apiv3.avirato.com/v3/reservation/urls/901?web_code=1234&type=Guest',
    );
    expect(result).toMatchObject({
      kind: 'success',
      data: { type: 'Guest', url: urlsGuest.data.url },
    });
  });

  it('get_reservation_links refuses a link type Avirato does not offer', async () => {
    const { result, capture } = await callWith(
      'mcp_avirato_get_reservation_links',
      { reservation_id: 901, type: 'Pay' },
      urlsGuest,
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(0);
  });

  it('the reads by reservation id are bound to the reservation’s owner', () => {
    for (const name of ['mcp_avirato_get_reservation', 'mcp_avirato_get_reservation_links']) {
      expect(published().get(name)?.identityPolicy, name).toEqual({
        mode: 'subject-bound',
        identityFields: [],
        recordOwnershipField: 'reservation_id',
        recordOwnershipKind: 'avirato:reservation',
      });
      expect(published().get(name)?.readOnly, name).toBe(true);
    }
  });

  it('find_reservations_by_guest is bound to the document it names, and its rows to their owner', () => {
    expect(published().get('mcp_avirato_find_reservations_by_guest')?.identityPolicy).toEqual({
      mode: 'subject-bound',
      identityFields: ['client_doc'],
      ownedResultField: 'reservation_id',
      recordOwnershipKind: 'avirato:reservation',
    });
  });

  it('every declared identity field exists in its tool’s input schema', () => {
    for (const tool of aviratoProvider.listTools()) {
      if (tool.identityPolicy?.mode !== 'subject-bound') continue;
      const properties = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      );
      for (const field of [
        ...tool.identityPolicy.identityFields,
        ...(tool.identityPolicy.recordOwnershipField
          ? [tool.identityPolicy.recordOwnershipField]
          : []),
      ]) {
        expect(properties, `${tool.name}: ${field}`).toContain(field);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// S6 — the writes (control plane)
// ---------------------------------------------------------------------------

describe('avirato provider — S6 create_reservation and cancel_reservation', () => {
  const room = {
    space_subtype_id: 2,
    quantity: 1,
    adults: 2,
    children: 0,
    check_in: '2027-02-16T17:00:00.000Z',
    check_out: '2027-02-17T17:00:00.000Z',
    regime: 'BB',
    rate_id: 2,
    status: 'RESERVATION',
    client: { client_doc: 'TEST-0001', name: 'Ana', surname: 'Prueba', email: 'ana@example.test' },
    payment: { payment_type: 'CARD', is_paid: false },
  };

  it('both writes are routable by name but withdrawn from the agent menu', () => {
    const menu = aviratoProvider.listTools().map((t) => t.name);
    for (const name of ['mcp_avirato_create_reservation', 'mcp_avirato_cancel_reservation']) {
      expect(menu, name).not.toContain(name);
      expect(aviratoProvider.routableToolNames(), name).toContain(name);
    }
  });

  it('create sends Avirato’s exact body: payment becomes `price`, the fields we have no say in are filled', async () => {
    const { result, capture } = await callWith(
      'mcp_avirato_create_reservation',
      { external_code: 'xcale-test-0001', rooms: [room] },
      created,
      201,
    );

    expect(capture).toHaveLength(1);
    expect(capture[0]?.init.method).toBe('POST');
    expect(capture[0]?.url).toBe('https://apiv3.avirato.com/v3/reservation?web_code=1234');
    expect(JSON.parse(capture[0]?.init.body ?? '{}')).toEqual({
      external_code: 'xcale-test-0001',
      rooms: [
        {
          space_subtype_id: 2,
          quantity: 1,
          adults: 2,
          children: 0,
          check_in: '2027-02-16T17:00:00.000Z',
          check_out: '2027-02-17T17:00:00.000Z',
          regime: 'BB',
          rate_id: 2,
          status: 'RESERVATION',
          client: {
            client_doc: 'TEST-0001',
            name: 'Ana',
            surname: 'Prueba',
            email: 'ana@example.test',
          },
          price: { payment_type: 'CARD', is_paid: false },
          operator_reservation_id: '0',
          advance: { total_advance: 0, advance_type: 'CARD' },
          observations: '',
          additional_beds: 0,
          extras: [],
          predefinedCharges: [],
        },
      ],
    });
    expect(result).toMatchObject({ kind: 'success', data: created.data });
  });

  it('create carries a promotional code and observations when given, and no amount ever', async () => {
    const { capture } = await callWith(
      'mcp_avirato_create_reservation',
      { promotional_code: 'VERANO10', rooms: [{ ...room, observations: 'Llega tarde' }] },
      created,
      201,
    );

    const body = JSON.parse(capture[0]?.init.body ?? '{}');
    expect(body.promotional_code).toBe('VERANO10');
    expect(body.external_code).toBeUndefined();
    expect(body.rooms[0].observations).toBe('Llega tarde');
    expect(JSON.stringify(body)).not.toMatch(/"(amount|total|price)"\s*:\s*\d/);
  });

  it.each([
    [{ rooms: [] }, 'no room'],
    [{ rooms: [{ ...room, status: 'Reserva' }] }, 'a status Avirato’s create does not take'],
    [{ rooms: [{ ...room, check_out: room.check_in }] }, 'a check-out not after check-in'],
    [{ rooms: [{ ...room, check_in: '2027-02-16' }] }, 'a check-in that is not a datetime'],
    [
      { rooms: [{ ...room, client: { client_doc: 'TEST-0001' } }] },
      'a client with only a document',
    ],
    [{ rooms: [{ ...room, price: 395000 }] }, 'an amount'],
  ] as Array<[Record<string, unknown>, string]>)(
    'create refuses %j (%s) before reaching Avirato',
    async (args) => {
      const { result, capture } = await callWith(
        'mcp_avirato_create_reservation',
        args,
        created,
        201,
      );

      expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
      expect(capture).toHaveLength(0);
    },
  );

  it('create is one request: a failure is returned, never retried', async () => {
    const { result, capture } = await callWith(
      'mcp_avirato_create_reservation',
      { rooms: [room] },
      'Bad Gateway',
      502,
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_UNAVAILABLE });
    expect(capture).toHaveLength(1);
  });

  it('cancel DELETEs the reservation and returns it, now `Reserva cancelada`', async () => {
    const { result, capture } = await callWith(
      'mcp_avirato_cancel_reservation',
      { reservation_id: 901 },
      cancelled,
    );

    expect(capture[0]?.init.method).toBe('DELETE');
    expect(capture[0]?.url).toBe('https://apiv3.avirato.com/v3/reservation/901?web_code=1234');
    expect(result).toMatchObject({ kind: 'success', data: { status: 'Reserva cancelada' } });
  });

  it('cancel is bound to the reservation’s owner; create declares no policy (it reads nobody)', () => {
    const tools = new Map(
      buildAviratoTools(createAviratoClient()).map((t) => [t.name, t] as const),
    );

    expect(tools.get('mcp_avirato_cancel_reservation')?.identityPolicy).toEqual({
      mode: 'subject-bound',
      identityFields: [],
      recordOwnershipField: 'reservation_id',
      recordOwnershipKind: 'avirato:reservation',
    });
    expect(tools.get('mcp_avirato_create_reservation')?.identityPolicy).toBeUndefined();
    expect(tools.get('mcp_avirato_cancel_reservation')?.readOnly).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S7 — the published surface and credential containment
// ---------------------------------------------------------------------------

describe('avirato provider — S7 surface', () => {
  it('publishes exactly the ten menu tools and routes the four control-plane ones too', () => {
    const menu = [
      'mcp_avirato_get_establishment',
      'mcp_avirato_list_room_types',
      'mcp_avirato_list_rates',
      'mcp_avirato_list_regimes',
      'mcp_avirato_list_extras',
      'mcp_avirato_check_availability',
      'mcp_avirato_validate_promotional_code',
      'mcp_avirato_get_reservation',
      'mcp_avirato_find_reservations_by_guest',
      'mcp_avirato_get_reservation_links',
    ];
    const controlPlane = [
      'mcp_avirato_quote_stay',
      'mcp_avirato_create_reservation',
      'mcp_avirato_cancel_reservation',
      'mcp_avirato_modify_reservation',
    ];

    expect(new Set(aviratoProvider.listTools().map((t) => t.name))).toEqual(new Set(menu));
    expect(new Set(aviratoProvider.routableToolNames())).toEqual(
      new Set([...menu, ...controlPlane]),
    );
    const [entry] = buildCatalog(createRegistry([aviratoProvider]));
    expect(entry?.toolCount).toBe(10);
  });

  it('marks every menu tool read-only — the agent’s menu changes nothing at the hotel', () => {
    for (const tool of aviratoProvider.listTools()) expect(tool.readOnly, tool.name).toBe(true);
  });
});

describe('avirato provider — credential containment', () => {
  it('reveals the token only into the Authorization header, never into a result', async () => {
    const capture: Captured[] = [];
    const provider = createAviratoProvider({
      fetchImpl: fakeFetch({ body: establishment, capture }),
    });

    const result = await provider.callTool('mcp_avirato_get_establishment', {}, ctx);

    expect(capture[0]?.url).not.toContain('minted-jwt');
    expect(JSON.stringify(result)).not.toContain('minted-jwt');
  });

  it('keeps the token and the web_code out of a transport-failure result', async () => {
    const failing = (async (url: string) => {
      throw new Error(`fetch failed for ${url} with Bearer minted-jwt`);
    }) as unknown as typeof fetch;
    const provider = createAviratoProvider({ fetchImpl: failing });

    const result = await provider.callTool('mcp_avirato_get_establishment', {}, ctx);

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_UNAVAILABLE });
    expect(JSON.stringify(result)).not.toContain('minted-jwt');
    expect(JSON.stringify(result)).not.toContain('web_code=1234');
  });

  it('keeps the token out of an error body that echoes the request', async () => {
    const echoing = (async (url: string, init: Captured['init']) =>
      new Response(
        JSON.stringify({
          statusCode: 400,
          path: url,
          errorCode: 'INPUT_DATA_VALIDATION_FAILED',
          errors: [`authorization ${JSON.stringify(init.headers)}`],
        }),
        { status: 400 },
      )) as unknown as typeof fetch;
    const provider = createAviratoProvider({ fetchImpl: echoing });

    const result = await provider.callTool('mcp_avirato_get_establishment', {}, ctx);

    expect(JSON.stringify(result)).not.toContain('1234');
    // A body that echoes the Authorization header back is the provider leaking, and the message
    // forwards validation sentences: they must never carry the bearer.
    expect(JSON.stringify(result)).not.toContain('minted-jwt');
  });
});

describe('avirato provider — the client’s address on create', () => {
  const base = {
    space_subtype_id: 2,
    quantity: 1,
    adults: 2,
    children: 0,
    check_in: '2027-02-16T17:00:00.000Z',
    check_out: '2027-02-17T17:00:00.000Z',
    regime: 'BB',
    rate_id: 2,
    status: 'RESERVATION',
    payment: { payment_type: 'CASH', is_paid: false },
  };

  it('passes state, ISO3 country, city, address and zip code through — the sandbox requires state and country', async () => {
    const client = {
      client_doc: 'TEST-0001',
      name: 'Ana',
      surname: 'Prueba',
      state: 'Antioquia',
      country: 'COL',
      city: 'Medellín',
      address: 'Calle 1',
      zip_code: '050001',
    };
    const { capture } = await callWith(
      'mcp_avirato_create_reservation',
      { rooms: [{ ...base, client }] },
      created,
      201,
    );

    expect(JSON.parse(capture[0]?.init.body ?? '{}').rooms[0].client).toEqual(client);
  });

  it.each(['CO', 'col', 'Colombia'])(
    'refuses country %j — Avirato takes ISO 3166-1 alpha-3',
    async (country) => {
      const { result, capture } = await callWith(
        'mcp_avirato_create_reservation',
        {
          rooms: [
            {
              ...base,
              client: { client_doc: 'TEST-0001', name: 'Ana', surname: 'Prueba', country },
            },
          ],
        },
        created,
        201,
      );

      expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
      expect(capture).toHaveLength(0);
    },
  );
});

// ---------------------------------------------------------------------------
// S9 — modify_reservation (control plane), observed on the sandbox 2026-10-31
// ---------------------------------------------------------------------------

describe('avirato provider — S9 modify_reservation', () => {
  const room = {
    space_subtype_id: 2,
    adults: 1,
    children: 0,
    check_in: '2027-02-15T17:00:00.000Z',
    check_out: '2027-02-16T17:00:00.000Z',
    regime: 'BB',
    rate_id: 2,
    status: 'RESERVATION',
    client: { client_doc: 'TEST-0001', name: 'Ana', surname: 'Prueba', email: 'ana@example.test' },
    payment: { payment_type: 'CASH', is_paid: false },
  };

  it('is routable by name but withdrawn from the agent menu', () => {
    expect(aviratoProvider.listTools().map((t) => t.name)).not.toContain(
      'mcp_avirato_modify_reservation',
    );
    expect(aviratoProvider.routableToolNames()).toContain('mcp_avirato_modify_reservation');
  });

  it('PATCHes the full record Avirato requires: action MODIFY, rateId, the paid-how as price, the fields we fill', async () => {
    const { result, capture } = await callWith(
      'mcp_avirato_modify_reservation',
      { reservation_id: 901, room },
      modified,
    );

    expect(capture).toHaveLength(1);
    expect(capture[0]?.init.method).toBe('PATCH');
    expect(capture[0]?.url).toBe('https://apiv3.avirato.com/v3/reservation/901?web_code=1234');
    expect(JSON.parse(capture[0]?.init.body ?? '{}')).toEqual({
      rooms: [
        {
          action: 'MODIFY',
          reservation_id: 901,
          space_subtype_id: 2,
          adults: 1,
          children: 0,
          check_in: '2027-02-15T17:00:00.000Z',
          check_out: '2027-02-16T17:00:00.000Z',
          regime: 'BB',
          rateId: 2,
          status: 'RESERVATION',
          client: {
            client_doc: 'TEST-0001',
            name: 'Ana',
            surname: 'Prueba',
            email: 'ana@example.test',
          },
          price: { payment_type: 'CASH', is_paid: false },
          advance: { total_advance: 0, advance_type: 'CASH' },
          operator_reservation_id: '0',
          observations: '',
          additional_beds: 0,
          extras: [],
        },
      ],
    });
    expect(result).toMatchObject({ kind: 'success' });
  });

  it.each([
    [
      { reservation_id: 901, room: { ...room, quantity: 1 } },
      'a quantity — Avirato refuses it on modify',
    ],
    [
      { reservation_id: 901, room: { ...room, client: undefined } },
      'no client — a partial record fails',
    ],
    [
      { reservation_id: 901, room: { ...room, check_out: room.check_in } },
      'a check-out not after check-in',
    ],
    [{ room }, 'no reservation id'],
  ] as Array<[Record<string, unknown>, string]>)(
    'refuses %j (%s) before reaching Avirato',
    async (args) => {
      const { result, capture } = await callWith('mcp_avirato_modify_reservation', args, modified);

      expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
      expect(capture).toHaveLength(0);
    },
  );

  it('a modify Avirato refuses comes back typed, and is not retried', async () => {
    const refused = {
      statusCode: 400,
      errorCode: 'ERROR_ON_UPDATE',
      message: 'Unable to modify the reservation',
    };
    const { result, capture } = await callWith(
      'mcp_avirato_modify_reservation',
      { reservation_id: 901, room },
      refused,
      400,
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect((result as { message: string }).message).toContain('ERROR_ON_UPDATE');
    expect(capture).toHaveLength(1);
  });

  it('is bound to the reservation’s owner', () => {
    const tool = buildAviratoTools(createAviratoClient()).find(
      (t) => t.name === 'mcp_avirato_modify_reservation',
    );
    expect(tool?.identityPolicy).toEqual({
      mode: 'subject-bound',
      identityFields: [],
      recordOwnershipField: 'reservation_id',
      recordOwnershipKind: 'avirato:reservation',
    });
  });
});

describe('avirato provider — S9 what modify does to the tag and to a cancelled reservation', () => {
  const room = {
    space_subtype_id: 2,
    adults: 1,
    children: 0,
    check_in: '2027-02-15T17:00:00.000Z',
    check_out: '2027-02-16T17:00:00.000Z',
    regime: 'BB',
    rate_id: 2,
    status: 'RESERVATION',
    client: { client_doc: 'TEST-0001', name: 'Ana', surname: 'Prueba' },
    payment: { payment_type: 'CASH', is_paid: false },
  };

  it('refuses external_code — Avirato rejects it on modify ("property externalCode should not exist")', async () => {
    const { result, capture } = await callWith(
      'mcp_avirato_modify_reservation',
      { reservation_id: 901, external_code: 'xcale-test-0001', room },
      modified,
    );
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(0);
  });

  it('a modify of a cancelled reservation is "not found or cancelled", not bad input', async () => {
    const gone = {
      statusCode: 400,
      errorCode: 'ERROR_RETRIEVING_DATA',
      message: 'Unable to retrieve data',
    };
    const { result } = await callWith(
      'mcp_avirato_modify_reservation',
      { reservation_id: 901, room },
      gone,
      400,
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
    expect((result as { message: string }).message).toContain('not found or cancelled');
  });
});
