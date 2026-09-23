import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { FetchLike } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { createMewsProvider } from '../provider';

import configuration from '../__fixtures__/observed-configuration.json';
import services from '../__fixtures__/observed-services.json';
import availability from '../__fixtures__/observed-availability.json';
import reservationPrice from '../__fixtures__/observed-reservation-price.json';
import reservationAdd from '../__fixtures__/observed-reservation-add.json';
import reservationCancel from '../__fixtures__/observed-reservation-cancel.json';
import customersGetAll from '../__fixtures__/observed-customers-getall.json';
import noAvailability from '../__fixtures__/errors/403-no-availability.json';
import cancelAgain from '../__fixtures__/errors/403-cancel-again.json';
import concurrentChange from '../__fixtures__/errors/403-concurrent-change.json';
import badAccessToken from '../__fixtures__/errors/401-bad-access-token.json';
import tooMany from '../__fixtures__/errors/429-too-many-requests.json';
import invalidJson from '../__fixtures__/errors/400-invalid-json.json';

const ACCESS_TOKEN = 'hotel-access-token-SECRET';
const CLIENT_TOKEN = 'xcale-client-token-SECRET';
const SERVICE_ID = 'bd26d8db-86da-4f96-9efc-e5a4654a4a94';
const ADULT = 'c202559b-c900-48f9-b8ba-ade8008e4070';
const CATEGORY = '6ebb4101-3e4f-46c7-96b2-0b76f112fe57';
const RATE = '1312c636-2947-429b-bec9-b4ad00f374b0';
const CUSTOMER = '00000000-0000-0000-0000-000000000001';

const CTX: ProviderCallContext = {
  credential: { secret: new SecretString(ACCESS_TOKEN) },
  metadata: { serviceId: SERVICE_ID },
};

interface Sent {
  readonly operation: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

type Route = { readonly status?: number; readonly body: unknown };

/** A fetch double routed by Mews operation (`configuration/get`), recording every request. */
function fakeMews(routes: Record<string, Route>) {
  const sent: Sent[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const operation = href.split('/api/connector/v1/')[1] ?? '';
    sent.push({
      operation,
      url: href,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    const route = routes[operation];
    if (!route) return new Response(JSON.stringify({ Message: 'no route' }), { status: 404 });
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as FetchLike;
  return { impl, sent };
}

function mews(routes: Record<string, Route>, clientToken = CLIENT_TOKEN) {
  const { impl, sent } = fakeMews(routes);
  const provider = createMewsProvider({
    fetchImpl: impl,
    clientToken,
    clientName: 'xcale-test 0.0.0',
    baseUrl: 'https://api.mews-demo.com',
  });
  return { provider, sent };
}

function data(result: ToolResult): unknown {
  if (result.kind !== 'success') throw new Error(`expected success, got: ${result.message}`);
  return result.data;
}

function failure(result: ToolResult): { code: ProviderErrorCode; message: string } {
  if (result.kind !== 'error') throw new Error('expected an error result');
  return { code: result.code, message: result.message };
}

/** A copy of the observed configuration in another zone, to test the conversion across zones. */
function configurationIn(timeZone: string) {
  return {
    ...configuration,
    Enterprise: { ...configuration.Enterprise, TimeZoneIdentifier: timeZone },
  };
}

const STAY_ROUTES: Record<string, Route> = {
  'configuration/get': { body: configuration },
  'services/getAll': { body: services },
};

describe('mews provider — catalog surface', () => {
  it('passes the generic provider conformance suite', async () => {
    await runProviderConformance(mews({}).provider);
  });

  it('publishes an api_key descriptor placing the hotel AccessToken in the JSON body (ADR 0018)', () => {
    const { auth } = createMewsProvider();
    expect(auth.type).toBe('api_key');
    if (auth.type === 'api_key') {
      expect(auth.fields).toEqual([
        { key: 'AccessToken', label: 'Access token', placement: 'json_body' },
      ]);
      expect(auth.credentialDelivery).toBe('forwarded');
    }
  });

  it('publishes serviceId as the required context, discovered and probed by list_services', () => {
    const p = createMewsProvider();
    expect((p.contextSchema as { required?: string[] }).required).toEqual(['serviceId']);
    expect(p.manifest.connectionProbe?.tool).toBe('mcp_mews_list_services');
    expect(p.manifest.contextDiscovery).toEqual({
      key: 'serviceId',
      tool: 'mcp_mews_list_services',
      resultPath: '0.Id',
    });
  });

  it('names every tool under the mcp_mews_ prefix', () => {
    const names = createMewsProvider()
      .listTools()
      .map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^mcp_mews_[a-z_]+$/);
  });
});

describe('mews provider — credentials on the wire', () => {
  it('sends AccessToken, ClientToken and Client in the POST body, and no auth header', async () => {
    const { provider, sent } = mews({ 'configuration/get': { body: configuration } });

    await provider.callTool('mcp_mews_get_configuration', {}, CTX);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://api.mews-demo.com/api/connector/v1/configuration/get');
    expect(sent[0]?.body).toMatchObject({
      AccessToken: ACCESS_TOKEN,
      ClientToken: CLIENT_TOKEN,
      Client: 'xcale-test 0.0.0',
    });
    expect(Object.keys(sent[0]?.headers ?? {}).map((h) => h.toLowerCase())).not.toContain(
      'authorization',
    );
  });

  it('fails closed, before any request, when this server has no ClientToken', async () => {
    const { provider, sent } = mews({ 'configuration/get': { body: configuration } }, '');

    const result = await provider.callTool('mcp_mews_get_configuration', {}, CTX);

    expect(failure(result)).toMatchObject({ code: ProviderErrorCode.PROVIDER_ERROR });
    expect(failure(result).message).toMatch(/not configured/);
    expect(sent).toHaveLength(0);
  });

  it('never puts either token in an error message, even when Mews echoes them', async () => {
    const echo = {
      Message: 'Bad request.',
      RequestId: 'fa4c90d1-b51a-42fb-b01c-a379bf9e80de',
      Details: { AccessToken: ACCESS_TOKEN, ClientToken: CLIENT_TOKEN },
    };
    const { provider } = mews({ 'configuration/get': { status: 400, body: echo } });

    const { message } = failure(await provider.callTool('mcp_mews_get_configuration', {}, CTX));

    expect(message).not.toContain(ACCESS_TOKEN);
    expect(message).not.toContain(CLIENT_TOKEN);
  });
});

describe('mews provider — list_services (discovery)', () => {
  it('returns only active NIGHTLY bookable services, so discovery never binds a restaurant and an hourly one never reads as a second account', async () => {
    const { provider, sent } = mews({ 'services/getAll': { body: services } });

    const result = data(await provider.callTool('mcp_mews_list_services', {}, CTX)) as Array<{
      Id: string;
      Name: string;
      TimeUnitPeriod: string;
    }>;

    // Observed: the restaurant is Bookable with Ordering 0 and hourly units; the accommodation has
    // Ordering 666 and nightly units. A stay is sold by the night, so the restaurant is not a candidate.
    expect(result.map((s) => s.Name)).toEqual(['Accommodation (real)']);
    expect(result[0]).toMatchObject({ Id: SERVICE_ID, TimeUnitPeriod: 'Day' });
    expect(result.some((s) => s.Name === 'Trivec POS')).toBe(false);
    expect(sent[0]?.body).not.toHaveProperty('ServiceIds');
  });
});

describe('mews provider — local dates to Mews instants', () => {
  it('asks availability from local midnight of the first night to local midnight of the last (Budapest)', async () => {
    const { provider, sent } = mews({
      'configuration/get': { body: configuration },
      'services/getAvailability/2024-01-22': { body: availability },
    });

    const result = await provider.callTool(
      'mcp_mews_get_availability',
      { checkIn: '2026-10-15', checkOut: '2026-10-17' },
      CTX,
    );

    expect(data(result)).toEqual(availability);
    const call = sent.find((s) => s.operation === 'services/getAvailability/2024-01-22');
    expect(call?.body).toMatchObject({
      ServiceId: SERVICE_ID,
      FirstTimeUnitStartUtc: '2026-10-14T22:00:00Z',
      LastTimeUnitStartUtc: '2026-10-15T22:00:00Z',
    });
  });

  it('uses the offset in force on each night, across the end of DST', async () => {
    const { provider, sent } = mews({
      'configuration/get': { body: configuration },
      'services/getAvailability/2024-01-22': { body: availability },
    });

    // Budapest leaves DST on 2026-10-25: UTC+2 before, UTC+1 after.
    await provider.callTool(
      'mcp_mews_get_availability',
      { checkIn: '2026-10-24', checkOut: '2026-10-27' },
      CTX,
    );

    expect(sent.at(-1)?.body).toMatchObject({
      FirstTimeUnitStartUtc: '2026-10-23T22:00:00Z',
      LastTimeUnitStartUtc: '2026-10-25T23:00:00Z',
    });
  });

  it('puts a Colombian night on the right calendar day (UTC-5)', async () => {
    const { provider, sent } = mews({
      'configuration/get': { body: configurationIn('America/Bogota') },
      'services/getAvailability/2024-01-22': { body: availability },
    });

    await provider.callTool(
      'mcp_mews_get_availability',
      { checkIn: '2026-10-15', checkOut: '2026-10-16' },
      CTX,
    );

    expect(sent.at(-1)?.body).toMatchObject({
      FirstTimeUnitStartUtc: '2026-10-15T05:00:00Z',
      LastTimeUnitStartUtc: '2026-10-15T05:00:00Z',
    });
  });

  it('prices a stay from the service check-in and check-out, sending StartUtc (not Scheduled*)', async () => {
    const { provider, sent } = mews({
      ...STAY_ROUTES,
      'reservations/price': { body: reservationPrice },
    });

    const result = await provider.callTool(
      'mcp_mews_price_reservation',
      {
        categoryId: CATEGORY,
        rateId: RATE,
        checkIn: '2026-10-15',
        checkOut: '2026-10-17',
        personCounts: [{ ageCategoryId: ADULT, count: 2 }],
      },
      CTX,
    );

    expect(data(result)).toEqual(reservationPrice);
    const call = sent.find((s) => s.operation === 'reservations/price');
    // StartOffset P0M0DT15H0M0S and EndOffset P0M0DT11H46M0S in Budapest — the exact instants of
    // the observed reservation 130489 (design-notes E7).
    expect(call?.body).toMatchObject({
      ServiceId: SERVICE_ID,
      Reservations: [
        {
          StartUtc: '2026-10-15T13:00:00Z',
          EndUtc: '2026-10-17T09:46:00Z',
          RequestedCategoryId: CATEGORY,
          RateId: RATE,
          PersonCounts: [{ AgeCategoryId: ADULT, Count: 2 }],
        },
      ],
    });
    const reservation = (call?.body.Reservations as Array<Record<string, unknown>>)[0];
    expect(reservation).not.toHaveProperty('ScheduledStartUtc');
    expect(reservation).not.toHaveProperty('ScheduledEndUtc');
  });

  it('refuses a stay with no nights before calling Mews', async () => {
    const { provider, sent } = mews(STAY_ROUTES);

    const result = await provider.callTool(
      'mcp_mews_get_availability',
      { checkIn: '2026-10-17', checkOut: '2026-10-17' },
      CTX,
    );

    expect(failure(result).code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(sent).toHaveLength(0);
  });

  it('refuses a date that is not on the calendar', async () => {
    const { provider } = mews(STAY_ROUTES);

    const result = await provider.callTool(
      'mcp_mews_get_availability',
      { checkIn: '2026-02-30', checkOut: '2026-03-02' },
      CTX,
    );

    expect(failure(result).code).toBe(ProviderErrorCode.INVALID_INPUT);
  });
});

describe('mews provider — writes', () => {
  it('creates one reservation for an existing guest, leaving the confirmation email to Mews', async () => {
    const { provider, sent } = mews({
      ...STAY_ROUTES,
      'reservations/add': { body: reservationAdd },
    });

    const result = await provider.callTool(
      'mcp_mews_create_reservation',
      {
        customerId: CUSTOMER,
        checkIn: '2026-10-15',
        checkOut: '2026-10-17',
        rooms: [
          {
            categoryId: CATEGORY,
            rateId: RATE,
            personCounts: [{ ageCategoryId: ADULT, count: 2 }],
          },
        ],
      },
      CTX,
    );

    expect(data(result)).toEqual(reservationAdd);
    const call = sent.find((s) => s.operation === 'reservations/add');
    expect(call?.body).not.toHaveProperty('SendConfirmationEmail');
    expect(call?.body.Reservations).toEqual([
      {
        State: 'Confirmed',
        StartUtc: '2026-10-15T13:00:00Z',
        EndUtc: '2026-10-17T09:46:00Z',
        CustomerId: CUSTOMER,
        RequestedCategoryId: CATEGORY,
        RateId: RATE,
        PersonCounts: [{ AgeCategoryId: ADULT, Count: 2 }],
      },
    ]);
  });

  it('sends the confirmation-email choice when the caller makes one', async () => {
    const { provider, sent } = mews({
      ...STAY_ROUTES,
      'reservations/add': { body: reservationAdd },
    });

    await provider.callTool(
      'mcp_mews_create_reservation',
      {
        customerId: CUSTOMER,
        checkIn: '2026-10-15',
        checkOut: '2026-10-17',
        rooms: [
          {
            categoryId: CATEGORY,
            rateId: RATE,
            personCounts: [{ ageCategoryId: ADULT, count: 2 }],
          },
        ],
        sendConfirmationEmail: false,
      },
      CTX,
    );

    expect(sent.find((s) => s.operation === 'reservations/add')?.body).toMatchObject({
      SendConfirmationEmail: false,
    });
  });

  it('books several rooms in ONE call, so Mews takes all of them or none (E24)', async () => {
    const { provider, sent } = mews({
      ...STAY_ROUTES,
      'reservations/add': { body: reservationAdd },
    });
    const TWIN = '00000000-0000-0000-0000-0000000000c2';

    await provider.callTool(
      'mcp_mews_create_reservation',
      {
        customerId: CUSTOMER,
        checkIn: '2026-10-15',
        checkOut: '2026-10-17',
        rooms: [
          {
            categoryId: CATEGORY,
            rateId: RATE,
            personCounts: [{ ageCategoryId: ADULT, count: 2 }],
          },
          { categoryId: TWIN, rateId: RATE, personCounts: [{ ageCategoryId: ADULT, count: 1 }] },
        ],
      },
      CTX,
    );

    const adds = sent.filter((s) => s.operation === 'reservations/add');
    expect(adds).toHaveLength(1);
    const reservations = adds[0]?.body.Reservations as Array<Record<string, unknown>>;
    expect(reservations.map((r) => r.RequestedCategoryId)).toEqual([CATEGORY, TWIN]);
    expect(reservations.every((r) => r.CustomerId === CUSTOMER)).toBe(true);
    expect(reservations.every((r) => r.StartUtc === '2026-10-15T13:00:00Z')).toBe(true);
  });

  it('refuses an empty room list before calling Mews', async () => {
    const { provider, sent } = mews(STAY_ROUTES);

    const result = await provider.callTool(
      'mcp_mews_create_reservation',
      { customerId: CUSTOMER, checkIn: '2026-10-15', checkOut: '2026-10-17', rooms: [] },
      CTX,
    );

    expect(failure(result).code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(sent).toHaveLength(0);
  });

  it('cancels with the reason Mews requires', async () => {
    const { provider, sent } = mews({ 'reservations/cancel': { body: reservationCancel } });

    const result = await provider.callTool(
      'mcp_mews_cancel_reservation',
      { reservationIds: ['0a3d14b4-81a0-46c6-990f-b4ce00e202d1'], reason: 'Guest asked to cancel' },
      CTX,
    );

    expect(data(result)).toEqual(reservationCancel);
    expect(sent[0]?.body).toMatchObject({
      ReservationIds: ['0a3d14b4-81a0-46c6-990f-b4ce00e202d1'],
      Notes: 'Guest asked to cancel',
    });
    expect(sent[0]?.body).not.toHaveProperty('PostCancellationFee');
  });

  it('adds a guest without ever overwriting an existing one', async () => {
    const { provider, sent } = mews({ 'customers/add': { body: { Id: CUSTOMER } } });

    await provider.callTool(
      'mcp_mews_add_customer',
      { lastName: 'Guest', firstName: 'Probe', email: 'guest@example.com' },
      CTX,
    );

    expect(sent[0]?.body).toMatchObject({
      LastName: 'Guest',
      FirstName: 'Probe',
      Email: 'guest@example.com',
      OverwriteExisting: false,
    });
  });

  it('finds a guest by email', async () => {
    const { provider, sent } = mews({ 'customers/getAll': { body: customersGetAll } });

    const result = await provider.callTool(
      'mcp_mews_search_customers',
      { emails: ['guest@example.com'] },
      CTX,
    );

    expect(data(result)).toEqual(customersGetAll);
    expect(sent[0]?.body).toMatchObject({ Emails: ['guest@example.com'] });
  });

  it('requires a filter to list reservations', async () => {
    const { provider, sent } = mews({});

    const result = await provider.callTool('mcp_mews_list_reservations', {}, CTX);

    expect(failure(result).code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(sent).toHaveLength(0);
  });
});

describe('mews provider — error classification (design-notes §5)', () => {
  const errorCase = async (status: number, body: unknown) => {
    const { provider } = mews({ 'configuration/get': { status, body } });
    return failure(await provider.callTool('mcp_mews_get_configuration', {}, CTX));
  };

  it('403 "no availability" is a business refusal, never a reconnect, and says why', async () => {
    const { provider } = mews({
      ...STAY_ROUTES,
      'reservations/add': { status: 403, body: noAvailability },
    });

    const result = failure(
      await provider.callTool(
        'mcp_mews_create_reservation',
        {
          customerId: CUSTOMER,
          checkIn: '2026-10-15',
          checkOut: '2026-10-17',
          rooms: [
            {
              categoryId: CATEGORY,
              rateId: RATE,
              personCounts: [{ ageCategoryId: ADULT, count: 2 }],
            },
          ],
        },
        CTX,
      ),
    );

    expect(result.code).toBe(ProviderErrorCode.PROVIDER_ERROR);
    expect(result.message).toContain('no availability for the selected dates');
    expect(result.message).toContain('e05b21b8-8ccc-4734-aaf0-cf86c03d8eea');
  });

  it('403 "Please provide reason." is a refusal too', async () => {
    expect((await errorCase(403, cancelAgain)).code).toBe(ProviderErrorCode.PROVIDER_ERROR);
  });

  it('403 that asks to try again is a transient conflict, not a refusal', async () => {
    // Observed 2026-09-23 on a cancel right after a create; the same cancel succeeded 5 s later.
    const { code, message } = await errorCase(403, concurrentChange);
    expect(code).toBe(ProviderErrorCode.PROVIDER_UNAVAILABLE);
    expect(message).toContain('try again');
  });

  it('401 is the only reconnect', async () => {
    expect((await errorCase(401, badAccessToken)).code).toBe(ProviderErrorCode.AUTH_EXPIRED);
  });

  it('429 and 408 are rate limits', async () => {
    expect((await errorCase(429, tooMany)).code).toBe(ProviderErrorCode.RATE_LIMITED);
    expect((await errorCase(408, { Message: 'Request timeout.' })).code).toBe(
      ProviderErrorCode.RATE_LIMITED,
    );
  });

  it('400 is caller-fixable input', async () => {
    expect((await errorCase(400, invalidJson)).code).toBe(ProviderErrorCode.INVALID_INPUT);
  });

  it('5xx is the provider being unavailable', async () => {
    expect((await errorCase(503, { Message: 'Unavailable' })).code).toBe(
      ProviderErrorCode.PROVIDER_UNAVAILABLE,
    );
  });

  it('a success that is not a JSON object is not vouched for', async () => {
    const { provider } = mews({ 'configuration/get': { body: [1, 2, 3] } });
    const result = failure(await provider.callTool('mcp_mews_get_configuration', {}, CTX));
    expect(result.code).toBe(ProviderErrorCode.PROVIDER_ERROR);
  });

  it('caps and cleans the Mews message', async () => {
    const long = { Message: `line\u0000one\n${'x'.repeat(500)}`, RequestId: 'not-a-uuid' };
    const { message } = await errorCase(403, long);
    expect(message).not.toMatch(/[\u0000-\u001f]/);
    expect(message.length).toBeLessThan(300);
    expect(message).not.toContain('not-a-uuid');
  });
});
