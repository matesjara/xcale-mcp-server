import { describe, expect, it, vi } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { createAutocoreProvider } from '../provider';

import createPaymentLink from '../__fixtures__/createPaymentLink.json';
import missingFields from '../__fixtures__/errors/missingFields.json';
import deactivatePaymentLink from '../__fixtures__/deactivatePaymentLink.json';
import hotelNotFound from '../__fixtures__/errors/hotelNotFound.json';
import linkPaid from '../__fixtures__/linkPaid.json';
import linkRejected from '../__fixtures__/linkRejected.json';
import statusApplied from '../__fixtures__/statusApplied.json';
import statusCancelled from '../__fixtures__/statusCancelled.json';
import statusPending from '../__fixtures__/statusPending.json';
import statusRejected from '../__fixtures__/statusRejected.json';
import invalidCredentials from '../__fixtures__/errors/invalidCredentials.json';
import listHotels from '../__fixtures__/listHotels.json';

/** Visibly fake keys, composed as the consumer stores them. Never derived from real ones. */
const STAGING: ProviderCallContext = {
  credential: { secret: new SecretString('AK123:SK456') },
  metadata: { hotelId: 5, environment: 'staging', source: 'xcale' },
};
/** The Auth-Token for AK123 / SK456 at 1700000000 (an independently computed vector, see core tests). */
const TOKEN_AT_1700000000 =
  'QUsxMjM7MTcwMDAwMDAwMDs2ZjA4ODc5N2FkOWM1MGQyNTYzZTQwOTNiODhhZjI2NzMyMzMxOGM1OWIxYzI2OWNlNDBhYjQwNDliNjMzMzEz';
const clock = () => 1_700_000_000_000;

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

/** Records every request as it leaves the core (auth materialized) and answers in order; the last repeats. */
function recordingFetch(...responses: Array<{ status?: number; body: unknown }>) {
  const calls: RecordedCall[] = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fetchImpl: impl as unknown as typeof globalThis.fetch, calls };
}

function successData(result: ToolResult): unknown {
  if (result.kind !== 'success') throw new Error(`expected success, got: ${result.message}`);
  return result.data;
}

/** A listing page of `count` hotels starting at id `firstId`, out of `total`. */
function hotelsPage(firstId: number, count: number, total: number) {
  return {
    paginate_info: {
      start: 0,
      items: count,
      total_items: total,
      total_pages: Math.ceil(total / 10),
    },
    data: Array.from({ length: count }, (_, i) => ({
      id: firstId + i,
      is_archived: false,
      is_active: true,
      name: `Hotel ${firstId + i}`,
      currencies: [{ is_primary: true, currency: { code: 'COP' } }],
    })),
  };
}

const withMetadata = (metadata: Record<string, unknown>): ProviderCallContext => ({
  ...STAGING,
  metadata,
});

describe('autocore provider — connection probe', () => {
  it('proves the keys reach the hotel and names it, with nothing else of its record', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: listHotels });
    const provider = createAutocoreProvider({ fetchImpl, clock });

    const result = await provider.callTool('mcp_autocore_check_credentials', {}, STAGING);

    expect(successData(result)).toEqual({
      valid: true,
      hotel: {
        id: 5,
        name: 'STG XCALE HOTEL',
        active: true,
        currencies: ['COP', 'USD'],
        primaryCurrency: 'COP',
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe('https://api-stg.autocore.pro/v2/hotels?offset=0&limit=10');
    expect(calls[0]!.headers['Auth-Token']).toBe(TOKEN_AT_1700000000);
    expect(JSON.stringify(result)).not.toMatch(/PLACEHOLDER|commission|redeban/i);
  });

  it('refuses a hotel the keys do not reach, pointing at the id rather than the keys', async () => {
    const { fetchImpl } = recordingFetch({ body: listHotels });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_check_credentials',
      {},
      withMetadata({ hotelId: 6, environment: 'staging', source: 'xcale' }),
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.INVALID_INPUT,
      message: 'Autocore hotel 6 is not reachable with these keys',
    });
  });

  // Observed: `links.next` points past the end even on the last page. Paging follows `total_items`.
  it('pages by total_items, not by links.next, and finds a hotel on a later page', async () => {
    const { fetchImpl, calls } = recordingFetch(
      { body: hotelsPage(1, 10, 15) },
      { body: hotelsPage(11, 5, 15) },
    );
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_check_credentials',
      {},
      withMetadata({ hotelId: 13, environment: 'staging', source: 'xcale' }),
    );
    expect(successData(result)).toMatchObject({ valid: true, hotel: { id: 13 } });
    expect(calls.map((c) => c.url)).toEqual([
      'https://api-stg.autocore.pro/v2/hotels?offset=0&limit=10',
      'https://api-stg.autocore.pro/v2/hotels?offset=10&limit=10',
    ]);
  });

  it('stops after 20 pages rather than walking an unbounded listing', async () => {
    const responses = Array.from({ length: 25 }, (_, page) => ({
      body: hotelsPage(1000 + 10 * page, 10, 250),
    }));
    const { fetchImpl, calls } = recordingFetch(...responses);
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_check_credentials',
      {},
      STAGING,
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: 'Autocore hotel listing too large',
    });
    expect(calls).toHaveLength(20);
  });

  it('reports keys Autocore rejects as an expired credential, without echoing its body', async () => {
    const { fetchImpl } = recordingFetch({ status: 401, body: invalidCredentials });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_check_credentials',
      {},
      STAGING,
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.AUTH_EXPIRED,
      message: 'Autocore check credentials failed (HTTP 401)',
    });
    expect(JSON.stringify(result)).not.toContain('Credenciales');
  });

  it('reads the host from the environment and refuses an unknown one without calling anyone', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: listHotels });
    const provider = createAutocoreProvider({ fetchImpl, clock });
    await provider.callTool(
      'mcp_autocore_check_credentials',
      {},
      withMetadata({ hotelId: 5, environment: 'production', source: 'xcale' }),
    );
    expect(calls[0]!.url.startsWith('https://api.autocore.pro/v2/hotels')).toBe(true);

    const refused = await provider.callTool(
      'mcp_autocore_check_credentials',
      {},
      withMetadata({ hotelId: 5, environment: 'testing', source: 'xcale' }),
    );
    expect(refused).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(calls).toHaveLength(1);
  });

  it('does not vouch for a listing without its count', async () => {
    const { fetchImpl } = recordingFetch({ body: { data: [] } });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_check_credentials',
      {},
      STAGING,
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: 'Autocore check credentials returned an unexpected response',
    });
  });
});

describe('autocore provider — create payment link', () => {
  const INPUT = {
    amount: 150000,
    currency: 'COP',
    guestName: 'Jhon Doe',
    email: 'guest@example.com',
    description: 'xcale spike link 1',
    externalRef: 'xcale-spike-001',
    availableHours: 24,
    notificationUrl: 'https://example.com/xcale-autocore-webhook',
    sendLinkByEmail: false,
    allowedPaymentOptions: ['credit_card'],
  };

  it('creates the link with the exact body Autocore takes and returns its code and URL', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: createPaymentLink });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_create_payment_link',
      INPUT,
      STAGING,
    );

    expect(successData(result)).toEqual({
      code: 'vlxcvpqhcjc8',
      url: 'https://app-stg.autocore.pro/payment/xcale_hotel/vlxcvpqhcjc8',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('https://api-stg.autocore.pro/v2/links/schedule/');
    expect(calls[0]!.headers['Auth-Token']).toBe(TOKEN_AT_1700000000);
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      source: 'xcale',
      hotel_id: 5,
      amount: 150000,
      currency: 'COP',
      guest_name: 'Jhon Doe',
      email: 'guest@example.com',
      description: 'xcale spike link 1',
      external_ref_id: 'xcale-spike-001',
      available_hours: 24,
      temp_webhook_url: 'https://example.com/xcale-autocore-webhook',
      send_link_by_email: false,
      allowed_payment_options: ['credit_card'],
    });
  });

  it('leaves absent optionals out of the body instead of sending null', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: createPaymentLink });
    const { email: _email, allowedPaymentOptions: _options, ...required } = INPUT;
    await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_create_payment_link',
      required,
      STAGING,
    );
    const body = JSON.parse(calls[0]!.body!) as Record<string, unknown>;
    expect('email' in body).toBe(false);
    expect('allowed_payment_options' in body).toBe(false);
  });

  // Autocore accepts all of these (observed); the schema is what refuses them, before any call.
  it.each([
    ['a fractional amount', { amount: 150000.5 }],
    ['a zero amount', { amount: 0 }],
    ['a lowercase currency', { currency: 'cop' }],
    ['no description', { description: undefined }],
    ['no sendLinkByEmail', { sendLinkByEmail: undefined }],
    ['a plain-http notification URL', { notificationUrl: 'http://example.com/hook' }],
    ['an undeclared key', { tip: 1000 }],
  ])('refuses %s without calling Autocore', async (_label, change) => {
    const { fetchImpl, calls } = recordingFetch({ body: createPaymentLink });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_create_payment_link',
      { ...INPUT, ...change },
      STAGING,
    );
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(calls).toHaveLength(0);
  });

  // Autocore creates a second link for a repeated external_ref_id (observed): never retried.
  it('sends the POST exactly once, even when no response comes back', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      calls.push(String(url));
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch;
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_create_payment_link',
      INPUT,
      STAGING,
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
      message: 'Autocore create payment link unreachable',
    });
    expect(calls).toHaveLength(1);
  });

  it("reports Autocore's own rejection as invalid input, in its own words", async () => {
    const { fetchImpl } = recordingFetch({ status: 422, body: missingFields });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_create_payment_link',
      INPUT,
      STAGING,
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.INVALID_INPUT,
      message: 'Autocore create payment link failed (HTTP 422)',
    });
  });

  it('does not vouch for a 2xx without a code and a URL', async () => {
    const { fetchImpl } = recordingFetch({ body: { msg: 'ok' } });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_create_payment_link',
      INPUT,
      STAGING,
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: 'Autocore create payment link returned an unexpected response',
    });
  });
});

describe('autocore provider — deactivate payment link', () => {
  // Undocumented by Autocore: what its web app's "Cancelar cobro" calls (observed on Staging).
  it('cancels the link by its code and confirms it, without passing Autocore message on', async () => {
    const { fetchImpl, calls } = recordingFetch(
      { body: statusCancelled },
      { body: deactivatePaymentLink },
    );
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_deactivate_payment_link',
      { code: 'gmoiew13h8zz' },
      STAGING,
    );
    expect(successData(result)).toEqual({ code: 'gmoiew13h8zz', cancelled: true });
    // First the link is proven to be this hotel's (the status read is scoped by hotel_id), then cancelled.
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      [
        'GET',
        'https://api-stg.autocore.pro/v2/common/transaction-status?hotel_id=5&ref_number=gmoiew13h8zz&transaction_type=payment_link',
      ],
      ['DELETE', 'https://api-stg.autocore.pro/v2/bookings/chatbot/gmoiew13h8zz'],
    ]);
    for (const call of calls) expect(call.headers['Auth-Token']).toBe(TOKEN_AT_1700000000);
    expect(JSON.stringify(result)).not.toContain('Reserva');
  });

  it('is idempotent: cancelling an already-cancelled link succeeds again', async () => {
    const { fetchImpl } = recordingFetch({ body: deactivatePaymentLink });
    const provider = createAutocoreProvider({ fetchImpl, clock });
    for (let i = 0; i < 2; i++) {
      const result = await provider.callTool(
        'mcp_autocore_deactivate_payment_link',
        { code: 'gmoiew13h8zz' },
        STAGING,
      );
      expect(result).toMatchObject({ kind: 'success' });
    }
  });

  // The code becomes a path segment: anything else is refused, never encoded into another route.
  it.each([['../x'], ['ABC'], [''], ['a/b']])(
    'refuses the code %j without calling Autocore',
    async (code) => {
      const { fetchImpl, calls } = recordingFetch({ body: deactivatePaymentLink });
      const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
        'mcp_autocore_deactivate_payment_link',
        { code },
        STAGING,
      );
      expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
      expect(calls).toHaveLength(0);
    },
  );

  it('keeps the core classification for rejected keys and an unknown link', async () => {
    const rejected = await createAutocoreProvider({
      fetchImpl: recordingFetch({ status: 401, body: invalidCredentials }).fetchImpl,
      clock,
    }).callTool('mcp_autocore_deactivate_payment_link', { code: 'abc123' }, STAGING);
    expect(rejected).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.AUTH_EXPIRED,
      message: 'Autocore deactivate payment link failed (HTTP 401)',
    });

    const unknown = await createAutocoreProvider({
      fetchImpl: recordingFetch({ status: 404, body: hotelNotFound }).fetchImpl,
      clock,
    }).callTool('mcp_autocore_deactivate_payment_link', { code: 'abc123' }, STAGING);
    expect(unknown).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
  });
});

describe('autocore provider — transaction status', () => {
  const STATUS_URL = (code: string) =>
    `https://api-stg.autocore.pro/v2/common/transaction-status?hotel_id=5&ref_number=${code}&transaction_type=payment_link`;

  // Observed on Staging (2026-11-13): the status read carries stable codes but no amount; the link
  // read carries the amount paid but only Spanish labels. A paid link takes both.
  it('reads an applied link and the amount and currency actually paid, with no guest data', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: statusApplied }, { body: linkPaid });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_get_transaction_status',
      { code: 'k4doiy1k9tex' },
      STAGING,
    );

    expect(successData(result)).toEqual({
      code: 'k4doiy1k9tex',
      externalRef: 'xcale-s1-exitoso',
      status: 'applied',
      transactionId: '01a1d831-0895-7184-a158-b543f29a4f2b',
      occurredAt: '2026-11-14T03:54:15.862Z',
      amount: 150000,
      currency: 'COP',
    });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', STATUS_URL('k4doiy1k9tex')],
      ['GET', 'https://api-stg.autocore.pro/v2/links/schedule/k4doiy1k9tex'],
    ]);
    for (const call of calls) expect(call.headers['Auth-Token']).toBe(TOKEN_AT_1700000000);
    expect(JSON.stringify(result)).not.toMatch(/Jhon|guest@|PLACEHOLDER|Valor/);
  });

  it('reads a declined attempt as rejected, with no transaction (Autocore sends "N/A") and one call', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: statusRejected });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_get_transaction_status',
      { code: '9oe7ql80awol' },
      STAGING,
    );
    expect(successData(result)).toEqual({
      code: '9oe7ql80awol',
      externalRef: 'xcale-s1-declinado',
      status: 'rejected',
      transactionId: null,
      occurredAt: null,
      amount: null,
      currency: null,
    });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('tarjeta');
  });

  it.each([
    ['pending', statusPending, 'foibzazghzsz'],
    ['cancelled', statusCancelled, 'gmoiew13h8zz'],
  ])('reads a %s link with nulls and a single call', async (status, body, code) => {
    const { fetchImpl, calls } = recordingFetch({ body });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_get_transaction_status',
      { code },
      STAGING,
    );
    expect(successData(result)).toMatchObject({
      code,
      status,
      transactionId: null,
      occurredAt: null,
      amount: null,
      currency: null,
    });
    expect(calls).toHaveLength(1);
  });

  it('never reports a payment without its amount: an applied link whose payment is missing is an error', async () => {
    const { fetchImpl } = recordingFetch({ body: statusApplied }, { body: linkRejected });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_get_transaction_status',
      { code: 'k4doiy1k9tex' },
      STAGING,
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: 'Autocore get transaction status returned an unexpected response',
    });
  });

  it('reports the link read failing on an applied link as that failure, not as paid', async () => {
    const { fetchImpl } = recordingFetch({ body: statusApplied }, { status: 502, body: {} });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_get_transaction_status',
      { code: 'k4doiy1k9tex' },
      STAGING,
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.PROVIDER_UNAVAILABLE,
      message: 'Autocore get transaction status failed (HTTP 502)',
    });
  });

  it('refuses a code that is not one, without calling Autocore, and keeps the core classification', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: statusApplied });
    const provider = createAutocoreProvider({ fetchImpl, clock });
    const refused = await provider.callTool(
      'mcp_autocore_get_transaction_status',
      { code: '../x' },
      STAGING,
    );
    expect(refused).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(calls).toHaveLength(0);

    const unknown = await createAutocoreProvider({
      fetchImpl: recordingFetch({ status: 404, body: hotelNotFound }).fetchImpl,
      clock,
    }).callTool('mcp_autocore_get_transaction_status', { code: 'abc123' }, STAGING);
    expect(unknown).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
  });
});

describe('autocore provider — review fixes', () => {
  // Observed: the status read answers 404 "Link de pago no identificado" for a hotel_id the link is not
  // from, so it proves a link is the connection's hotel's before anything is cancelled.
  it("never cancels a link that is not the connection's hotel's", async () => {
    const { fetchImpl, calls } = recordingFetch({ status: 404, body: hotelNotFound });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_deactivate_payment_link',
      { code: 'otherhotel01' },
      STAGING,
    );
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  // The core transport parses every 2xx as JSON, so a 204 or a non-JSON body never reaches a provider
  // (it reads as unreachable for all of them); what the provider controls is not requiring an object.
  it('takes any JSON 2xx from the cancel as done, without reading its shape', async () => {
    const { fetchImpl, calls } = recordingFetch({ body: statusPending }, { body: null });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_deactivate_payment_link',
      { code: 'foibzazghzsz' },
      STAGING,
    );
    expect(result).toMatchObject({ kind: 'success', data: { cancelled: true } });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE']);
  });

  it.each([
    ['archived', { is_archived: true, is_active: true }],
    ['inactive', { is_archived: false, is_active: false }],
  ])('refuses at connect a hotel Autocore lists as %s', async (_label, flags) => {
    const page = structuredClone(listHotels) as { data: Array<Record<string, unknown>> };
    Object.assign(page.data[0]!, flags);
    const { fetchImpl } = recordingFetch({ body: page });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_check_credentials',
      {},
      STAGING,
    );
    expect(result).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.INVALID_INPUT,
      message: 'Autocore hotel 5 is not active',
    });
  });

  it.each([
    ['naive (as observed)', '2026-11-14T03:54:15.862324', '2026-11-14T03:54:15.862Z'],
    ['with a Z', '2026-11-14T03:54:15Z', '2026-11-14T03:54:15.000Z'],
    ['with an offset', '2026-11-13T22:54:15-05:00', '2026-11-14T03:54:15.000Z'],
  ])('reads a payment time %s as UTC', async (_label, createdAt, expected) => {
    const link = structuredClone(linkPaid) as { payments: Array<{ created_at: string }> };
    link.payments[0]!.created_at = createdAt;
    const { fetchImpl } = recordingFetch({ body: statusApplied }, { body: link });
    const result = await createAutocoreProvider({ fetchImpl, clock }).callTool(
      'mcp_autocore_get_transaction_status',
      { code: 'k4doiy1k9tex' },
      STAGING,
    );
    expect(successData(result)).toMatchObject({ status: 'applied', occurredAt: expected });
  });
});
