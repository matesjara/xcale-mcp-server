import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { FetchLike } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import reservation from '../__fixtures__/getReservation.json';
import reservations from '../__fixtures__/getReservations.json';
import { createCloudbedsProvider } from '../provider';

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>): FetchLike {
  return (async (url: string | URL) => {
    const method = new URL(url.toString()).pathname.split('/').pop() ?? '';
    const route = routes[method];
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  }) as FetchLike;
}

const ctx = (metadata: Record<string, unknown>) => ({
  credential: { secret: new SecretString('tok') },
  metadata,
});

describe('cloudbeds provider', () => {
  it('passes the generic provider conformance suite', async () => {
    await runProviderConformance(createCloudbedsProvider({ fetchImpl: fakeFetch({}) }));
  });

  it('publishes oauth2 auth + a propertyID contextSchema for discovery', () => {
    const provider = createCloudbedsProvider();
    expect(provider.auth.type).toBe('oauth2');
    expect(provider.contextSchema).toMatchObject({ type: 'object' });
  });

  // Settled against the live sandbox with 27 reservations (api-contract §7-C): Cloudbeds respects
  // `pageSize` and silently IGNORES `resultsPerPage` — `resultsPerPage=2` returned all 27 rows,
  // `pageSize=2` returned 2. Sending the wrong name made every list return the whole set.
  it('translates the uniform page/pageSize contract to Cloudbeds param names + sends propertyID', async () => {
    let calledUrl = '';
    const capturingFetch = (async (url: string | URL) => {
      calledUrl = url.toString();
      return new Response(JSON.stringify(reservations), { status: 200 });
    }) as FetchLike;
    const provider = createCloudbedsProvider({ fetchImpl: capturingFetch });
    await provider.callTool(
      'mcp_cloudbeds_list_reservations',
      { page: 2, pageSize: 10 },
      ctx({ propertyID: 'PROP1' }),
    );
    const qs = new URL(calledUrl).searchParams;
    expect(qs.get('propertyID')).toBe('PROP1');
    expect(qs.get('pageNumber')).toBe('2');
    expect(qs.get('pageSize')).toBe('10'); // the name Cloudbeds actually honours
    expect(qs.get('resultsPerPage')).toBeNull(); // ignored by the provider — never send it
  });

  it('list_reservations returns a uniform PaginatedResult (items kept verbatim)', async () => {
    const provider = createCloudbedsProvider({
      fetchImpl: fakeFetch({ getReservations: { body: reservations } }),
    });
    const r = await provider.callTool(
      'mcp_cloudbeds_list_reservations',
      { page: 1, pageSize: 2 },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r.kind).toBe('success');
    if (r.kind === 'success') {
      const data = r.data as { items: unknown[]; totalResults?: number; hasMore?: boolean };
      expect(data.items).toHaveLength(2);
      expect(data.totalResults).toBe(3);
      expect(data.hasMore).toBe(true);
    }
  });

  it('get_reservation returns the provider data verbatim (fidelity)', async () => {
    const provider = createCloudbedsProvider({
      fetchImpl: fakeFetch({ getReservation: { body: reservation } }),
    });
    const r = await provider.callTool(
      'mcp_cloudbeds_get_reservation',
      { reservationID: 'RES-1001' },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({ kind: 'success', data: { reservationID: 'RES-1001' } });
  });

  it('maps a provider 401 to PROVIDER_AUTH_EXPIRED (reconnect signal)', async () => {
    const provider = createCloudbedsProvider({
      fetchImpl: fakeFetch({ getReservation: { status: 401, body: { message: 'token expired' } } }),
    });
    const r = await provider.callTool(
      'mcp_cloudbeds_get_reservation',
      { reservationID: 'X' },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
  });

  it('rejects invalid args with INVALID_INPUT', async () => {
    const provider = createCloudbedsProvider({ fetchImpl: fakeFetch({}) });
    const r = await provider.callTool(
      'mcp_cloudbeds_get_reservation',
      {},
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
  });

  it('rejects a missing propertyID context with INVALID_INPUT', async () => {
    const provider = createCloudbedsProvider({ fetchImpl: fakeFetch({}) });
    const r = await provider.callTool('mcp_cloudbeds_get_hotel_details', {}, ctx({}));
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
  });

  it('list_properties (discovery tool) runs WITHOUT propertyID context and calls getHotels', async () => {
    const hotels = { success: true, data: [{ propertyID: '320754', propertyName: 'Demo Hotel' }] };
    let calledUrl = '';
    const capturingFetch = (async (url: string | URL) => {
      calledUrl = url.toString();
      return new Response(JSON.stringify(hotels), { status: 200 });
    }) as FetchLike;
    const provider = createCloudbedsProvider({ fetchImpl: capturingFetch });
    // Empty context — the discovery tool must be exempt from the propertyID requirement.
    const r = await provider.callTool('mcp_cloudbeds_list_properties', {}, ctx({}));
    expect(r).toMatchObject({ kind: 'success' });
    expect((r as { data: unknown }).data).toEqual(hotels.data);
    expect(new URL(calledUrl).pathname.endsWith('/getHotels')).toBe(true);
  });

  it('get_rate_plans sends the date range + propertyID and serialises detailedRates for the wire', async () => {
    let calledUrl = '';
    const capturingFetch = (async (url: string | URL) => {
      calledUrl = url.toString();
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
    }) as FetchLike;
    const provider = createCloudbedsProvider({ fetchImpl: capturingFetch });
    await provider.callTool(
      'mcp_cloudbeds_get_rate_plans',
      { startDate: '2026-08-10', endDate: '2026-08-12', detailedRates: true },
      ctx({ propertyID: 'PROP1' }),
    );
    const qs = new URL(calledUrl).searchParams;
    expect(qs.get('propertyID')).toBe('PROP1');
    expect(qs.get('startDate')).toBe('2026-08-10');
    expect(qs.get('endDate')).toBe('2026-08-12');
    expect(qs.get('detailedRates')).toBe('true');
  });

  it('get_rate_plans returns the rate plans verbatim (rateID + nightly detail reach the consumer)', async () => {
    const ratePlans = {
      success: true,
      data: [
        {
          rateID: '3206090',
          roomTypeID: '679065',
          roomRate: 700,
          roomRateDetailed: [{ date: '2026-08-10', rate: 350, minLos: 1 }],
        },
      ],
    };
    const provider = createCloudbedsProvider({
      fetchImpl: fakeFetch({ getRatePlans: { body: ratePlans } }),
    });
    const r = await provider.callTool(
      'mcp_cloudbeds_get_rate_plans',
      { startDate: '2026-08-10', endDate: '2026-08-12' },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({ kind: 'success' });
    expect((r as { data: unknown }).data).toEqual(ratePlans.data);
  });

  // Observed against the live sandbox: Cloudbeds answers a *bad* request with HTTP 200 and
  // `success:false` (missing param, or an ungranted scope) — the envelope, not the status code, is
  // what fails. A tool that trusted the 200 would hand the agent a phantom empty result.
  //
  // Cloudbeds signals a scope denial THIS way (200 + success:false), never 401/403, so the envelope
  // must be classified into the typed error the contract requires — a denied scope is a reconnect
  // signal (AUTH_EXPIRED), not an opaque PROVIDER_ERROR (soul.md priority #2).
  it('maps a 200 + success:false scope denial to AUTH_EXPIRED (the reconnect signal)', async () => {
    const provider = createCloudbedsProvider({
      fetchImpl: fakeFetch({
        getRatePlans: {
          status: 200,
          body: {
            success: false,
            message: 'Scope required for this call was not granted by property.',
          },
        },
      }),
    });
    const r = await provider.callTool(
      'mcp_cloudbeds_get_rate_plans',
      { startDate: '2026-08-10', endDate: '2026-08-12' },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.AUTH_EXPIRED,
      message: 'Scope required for this call was not granted by property.',
    });
  });

  // A caller-fixable envelope failure (missing/invalid param) must classify as INVALID_INPUT so the
  // agent can correct and retry — distinct from the reconnect path above.
  it('maps a 200 + success:false required-param failure to INVALID_INPUT', async () => {
    const provider = createCloudbedsProvider({
      fetchImpl: fakeFetch({
        getRatePlans: {
          status: 200,
          body: { success: false, message: 'startDate is required.' },
        },
      }),
    });
    const r = await provider.callTool(
      'mcp_cloudbeds_get_rate_plans',
      { startDate: '2026-08-10', endDate: '2026-08-12' },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.INVALID_INPUT,
      message: 'startDate is required.',
    });
  });

  // Anything the classifier does not recognize stays PROVIDER_ERROR — no over-eager relabeling.
  it('leaves an unrecognized success:false message as PROVIDER_ERROR', async () => {
    const provider = createCloudbedsProvider({
      fetchImpl: fakeFetch({
        getRatePlans: {
          status: 200,
          body: { success: false, message: 'Temporary glitch, try later.' },
        },
      }),
    });
    const r = await provider.callTool(
      'mcp_cloudbeds_get_rate_plans',
      { startDate: '2026-08-10', endDate: '2026-08-12' },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
  });

  // --- create_reservation (E-08 write path) -------------------------------------------------

  const validBooking = {
    startDate: '2026-08-10',
    endDate: '2026-08-12',
    guestFirstName: 'Ana',
    guestLastName: 'Gomez',
    guestCountry: 'CO',
    guestZip: '110111',
    guestEmail: 'ana@example.com',
    rooms: [{ roomTypeID: '679065', quantity: 1, roomRateID: '3206090' }],
    adults: [{ roomTypeID: '679065', quantity: 2 }],
    children: [{ roomTypeID: '679065', quantity: 0 }],
  };

  async function captureCreate(args: Record<string, unknown>) {
    let body = '';
    let calledUrl = '';
    let method = '';
    const capturingFetch = (async (url: string | URL, init?: RequestInit) => {
      calledUrl = url.toString();
      method = init?.method ?? 'GET';
      body = init?.body?.toString() ?? '';
      return new Response(JSON.stringify({ success: true, reservationID: 'R-1' }), { status: 200 });
    }) as FetchLike;
    const provider = createCloudbedsProvider({ fetchImpl: capturingFetch });
    const r = await provider.callTool(
      'mcp_cloudbeds_create_reservation',
      args,
      ctx({ propertyID: 'PROP1' }),
    );
    return { r, body: new URLSearchParams(body), calledUrl, method };
  }

  it('create_reservation POSTs form-encoded bracketed arrays and injects propertyID from context', async () => {
    const { r, body, calledUrl, method } = await captureCreate(validBooking);
    expect(r).toMatchObject({ kind: 'success' });
    expect(method).toBe('POST');
    expect(calledUrl.endsWith('/postReservation')).toBe(true);
    // propertyID is Explicit Context — never an agent arg.
    expect(body.get('propertyID')).toBe('PROP1');
    // §7-A: PHP-style bracketed arrays, confirmed against the sandbox.
    expect(body.get('rooms[0][roomTypeID]')).toBe('679065');
    expect(body.get('rooms[0][quantity]')).toBe('1');
    expect(body.get('rooms[0][roomRateID]')).toBe('3206090');
    expect(body.get('adults[0][quantity]')).toBe('2');
    expect(body.get('children[0][quantity]')).toBe('0');
    // Booking-only: a declared method, defaulted by the schema.
    expect(body.get('paymentMethod')).toBe('cash');
  });

  it('create_reservation never sends card/payment-authorization fields (booking-only stays booking-only)', async () => {
    const { body } = await captureCreate({
      ...validBooking,
      thirdPartyIdentifier: 'xtest-1',
    });
    expect(body.get('cardToken')).toBeNull();
    expect(body.get('paymentAuthorizationCode')).toBeNull();
    // The consumer's external reference does reach the wire (it owns reconciliation).
    expect(body.get('thirdPartyIdentifier')).toBe('xtest-1');
  });

  it('create_reservation rejects an unknown field (strict schema) and never reaches the provider', async () => {
    const provider = createCloudbedsProvider({ fetchImpl: fakeFetch({}) });
    const r = await provider.callTool(
      'mcp_cloudbeds_create_reservation',
      { ...validBooking, cardToken: 'tok_visa' },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
  });

  it('create_reservation returns the provider payload verbatim (fields live at the envelope root)', async () => {
    const created = {
      success: true,
      reservationID: '9312390733482',
      status: 'confirmed',
      grandTotal: 770,
    };
    const provider = createCloudbedsProvider({
      fetchImpl: fakeFetch({ postReservation: { body: created } }),
    });
    const r = await provider.callTool(
      'mcp_cloudbeds_create_reservation',
      validBooking,
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({ kind: 'success' });
    expect((r as { data: unknown }).data).toEqual(created);
  });

  it('list_reservations passes the external-reference filter through (consumer-side reconciliation)', async () => {
    let calledUrl = '';
    const capturingFetch = (async (url: string | URL) => {
      calledUrl = url.toString();
      return new Response(JSON.stringify({ success: true, data: [], total: 0 }), { status: 200 });
    }) as FetchLike;
    const provider = createCloudbedsProvider({ fetchImpl: capturingFetch });
    await provider.callTool(
      'mcp_cloudbeds_list_reservations',
      { page: 1, pageSize: 10, sourceReservationId: 'xtest-abc' },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(new URL(calledUrl).searchParams.get('sourceReservationId')).toBe('xtest-abc');
  });

  // --- modify_reservation (W3) -----------------------------------------------------------------

  // Observed: Cloudbeds maps the method-name prefix to the HTTP verb. `putReservation` sent as POST is
  // a router 404 (`{"status":false,"error":"Unknown method."}`); as PUT it validates and works. This
  // test pins the verb, because getting it wrong fails as "endpoint doesn't exist", not as a bad request.
  it('modify_reservation uses HTTP PUT (a POST is an Unknown-method 404 at Cloudbeds)', async () => {
    let method = '';
    let calledUrl = '';
    let body = '';
    const capturingFetch = (async (url: string | URL, init?: RequestInit) => {
      method = init?.method ?? 'GET';
      calledUrl = url.toString();
      body = init?.body?.toString() ?? '';
      return new Response(JSON.stringify({ success: true, data: { status: 'canceled' } }), {
        status: 200,
      });
    }) as FetchLike;
    const provider = createCloudbedsProvider({ fetchImpl: capturingFetch });
    const r = await provider.callTool(
      'mcp_cloudbeds_modify_reservation',
      { reservationID: 'R-1', status: 'canceled' },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({ kind: 'success' });
    expect(method).toBe('PUT');
    expect(calledUrl.endsWith('/putReservation')).toBe(true);
    const qs = new URLSearchParams(body);
    expect(qs.get('propertyID')).toBe('PROP1');
    expect(qs.get('reservationID')).toBe('R-1');
    // Cancel is a status transition: Reservation:Delete is not granted, so this is the only path.
    expect(qs.get('status')).toBe('canceled');
  });

  it('modify_reservation surfaces a rejected status transition as an error', async () => {
    const provider = createCloudbedsProvider({
      fetchImpl: fakeFetch({
        putReservation: {
          status: 200,
          body: { success: false, message: 'Incorrect status. You cannot change status' },
        },
      }),
    });
    const r = await provider.callTool(
      'mcp_cloudbeds_modify_reservation',
      { reservationID: 'R-1', status: 'bogus_status' },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({
      kind: 'error',
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: 'Incorrect status. You cannot change status',
    });
  });

  it('modify_reservation rejects the non-modifiable check-in date (strict schema)', async () => {
    const provider = createCloudbedsProvider({ fetchImpl: fakeFetch({}) });
    // Cloudbeds' mutable set is [customFields, estimatedArrivalTime, rooms, status, checkoutDate,
    // dateCreated] — `startDate` is NOT modifiable, so the schema must not accept it.
    const r = await provider.callTool(
      'mcp_cloudbeds_modify_reservation',
      { reservationID: 'R-1', startDate: '2026-10-06' },
      ctx({ propertyID: 'PROP1' }),
    );
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
  });

  it('publishes contextDiscovery in the manifest (propertyID via list_properties)', () => {
    const provider = createCloudbedsProvider();
    expect(provider.manifest.contextDiscovery).toEqual({
      key: 'propertyID',
      tool: 'mcp_cloudbeds_list_properties',
      resultPath: '0.propertyID',
    });
  });
});

// Webhook subscription tools (W4) were REMOVED from the published toolset (see tools.ts): the
// endpointUrl is a bearer credential, the URL schema was unconstrained, and the delete tool could
// unhook the consumer's own receiver — all unsafe as agent surface. Their wire-shaping tests went
// with them. Webhook wiring is the consumer's control-plane concern; re-exposure is tracked in
// docs/design/roadmap.md behind an https-allowlist + secret redaction + a consent gate.
