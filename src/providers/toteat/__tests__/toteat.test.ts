import { describe, expect, it, vi } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { createToteatProvider } from '../provider';

import getMenu from '../__fixtures__/getMenu.json';
import getShiftStatus from '../__fixtures__/getShiftStatus.json';
import getTables from '../__fixtures__/getTables.json';
import listOpenOrders from '../__fixtures__/listOpenOrders.json';
import invalidDateFormat from '../__fixtures__/errors/invalidDateFormat.json';
import invalidOrderNumber from '../__fixtures__/errors/invalidOrderNumber.json';
import notAuthorized from '../__fixtures__/errors/notAuthorized.json';
import rateLimited from '../__fixtures__/errors/rateLimited.json';

const TOKEN = 'super-secret-api-token';

const CTX: ProviderCallContext = {
  credential: { secret: new SecretString(TOKEN) },
  metadata: { xir: '1234567890123456', xil: '1', xiu: '1001' },
};

/** A fetch double that records the URL it was asked for and answers with a fixture. */
function fakeFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { impl: impl as unknown as typeof globalThis.fetch, calls };
}

/** Narrow a ToolResult to its success payload; fails loudly instead of silently reading undefined. */
function successData(result: ToolResult): unknown {
  if (result.kind !== 'success') throw new Error(`expected success, got: ${result.message}`);
  return result.data;
}

/** Narrow a ToolResult to its error code. */
function errorCode(result: ToolResult): ProviderErrorCode {
  if (result.kind !== 'error') throw new Error('expected an error result');
  return result.code;
}

function provider(body: unknown, status = 200) {
  const { impl, calls } = fakeFetch(body, status);
  return { provider: createToteatProvider({ fetchImpl: impl }), calls };
}

describe('toteat provider — catalog surface', () => {
  it('publishes an api_key descriptor placing the single secret in the query string', () => {
    const p = createToteatProvider();

    expect(p.auth.type).toBe('api_key');
    if (p.auth.type === 'api_key') {
      expect(p.auth.fields).toHaveLength(1);
      expect(p.auth.fields[0]).toMatchObject({ key: 'xapitoken', placement: 'query' });
    }
  });

  it('publishes the (xir, xil, xiu) context so a consumer knows what to forward', () => {
    const p = createToteatProvider();
    const required = (p.contextSchema as { required?: string[] } | undefined)?.required ?? [];

    expect(required).toEqual(expect.arrayContaining(['xir', 'xil', 'xiu']));
  });

  it('declares a connection probe so a credential can be validated generically', () => {
    expect(createToteatProvider().manifest.connectionProbe?.tool).toBe(
      'mcp_toteat_get_shift_status',
    );
  });

  it('names every tool under the mcp_toteat_ prefix', () => {
    const names = createToteatProvider()
      .listTools()
      .map((t) => t.name);

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name.startsWith('mcp_toteat_')).toBe(true);
  });

  it('withdraws the venue-wide tools from the agent surface but keeps them callable', async () => {
    const p = createToteatProvider();
    const published = p.listTools().map((t) => t.name);

    // `get_menu` spends the venue's entire 3-per-minute budget on one diner if a model can reach
    // it; `list_open_orders` returns every other diner's order. Neither is a move an agent may
    // make, and a tool absent from tools/list can never be chosen, hallucinated into a plan, or
    // reached through prompt injection — the consumer builds its basket from this list.
    expect(published).not.toContain('mcp_toteat_get_menu');
    expect(published).not.toContain('mcp_toteat_list_open_orders');
    expect(published).toContain('mcp_toteat_get_shift_status');
    expect(published).toContain('mcp_toteat_create_order');

    // Still dispatchable by name — that is what makes it a control plane rather than a deletion.
    const { provider: withFixture } = provider(getMenu);
    const result = await withFixture.callTool('mcp_toteat_get_menu', {}, CTX);
    expect(result.kind).toBe('success');
  });
});

describe('toteat provider — request shaping', () => {
  it('sends the three identifiers as query params and lets the core append the token', async () => {
    const { provider: p, calls } = provider(getShiftStatus);

    await p.callTool('mcp_toteat_get_shift_status', {}, CTX);

    const url = new URL(calls[0]!);
    expect(url.searchParams.get('xir')).toBe('1234567890123456');
    expect(url.searchParams.get('xil')).toBe('1');
    expect(url.searchParams.get('xiu')).toBe('1001');
    expect(url.searchParams.get('xapitoken')).toBe(TOKEN);
  });

  it('never targets a legacy appspot host', async () => {
    const { provider: p, calls } = provider(getShiftStatus);

    await p.callTool('mcp_toteat_get_shift_status', {}, CTX);

    // The legacy hosts return incomplete data for migrated venues — and Toteat's own OpenAPI
    // `servers:` block still points at one, which is exactly why this is asserted.
    expect(calls[0]).not.toContain('appspot');
    expect(calls[0]).toContain('api.toteat.com/mw/or/1.0');
  });

  it('rejects context that is missing the venue id before any request is made', async () => {
    const { provider: p, calls } = provider(getShiftStatus);

    const result = await p.callTool(
      'mcp_toteat_get_shift_status',
      {},
      {
        credential: { secret: new SecretString(TOKEN) },
        metadata: { xir: '1234567890123456', xiu: '1001' },
      },
    );

    expect(result.kind).toBe('error');
    // Fail closed: without (xir, xil) there is no venue to scope to, and guessing is a cross-venue
    // answer. Nothing may go out on the wire.
    expect(calls).toHaveLength(0);
  });
});

describe('toteat provider — reads', () => {
  it('returns the menu payload verbatim', async () => {
    const { provider: p } = provider(getMenu);

    const result = await p.callTool('mcp_toteat_get_menu', {}, CTX);

    expect(result.kind).toBe('success');
    const data = successData(result) as unknown[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it('asks orderstatus for a listing when listing open orders', async () => {
    const { provider: p, calls } = provider(listOpenOrders);

    const result = await p.callTool('mcp_toteat_list_open_orders', {}, CTX);

    expect(new URL(calls[0]!).searchParams.get('listing')).toBe('1');
    // The reconciliation primitive: every open order carries the caller's own reference.
    const data = successData(result) as Array<Record<string, unknown>>;
    expect(data[0]).toHaveProperty('orderReference');
  });

  it('surfaces live table occupancy', async () => {
    const { provider: p } = provider(getTables);

    const result = await p.callTool('mcp_toteat_get_tables', {}, CTX);

    const data = successData(result) as Array<Record<string, unknown>>;
    expect(data.some((t) => t.available === false)).toBe(true);
  });
});

describe('toteat provider — date windows', () => {
  it('rejects a window wider than 15 days WITHOUT spending a request', async () => {
    const { provider: p, calls } = provider(getShiftStatus);

    const result = await p.callTool(
      'mcp_toteat_get_sales',
      { startDate: '2026-06-01', endDate: '2026-07-01' },
      CTX,
    );

    expect(result.kind).toBe('error');
    expect(errorCode(result)).toBe(ProviderErrorCode.INVALID_INPUT);
    // The point of validating locally: a rejected call still consumes one of the three requests
    // that endpoint allows per minute.
    expect(calls).toHaveLength(0);
  });

  it('rejects an end date before the start date', async () => {
    const { provider: p, calls } = provider(getShiftStatus);

    const result = await p.callTool(
      'mcp_toteat_get_sales',
      { startDate: '2026-06-10', endDate: '2026-06-01' },
      CTX,
    );

    expect(result.kind).toBe('error');
    expect(calls).toHaveLength(0);
  });

  it('uses each endpoint its own parameter names and date format', async () => {
    // Three namings and two formats across seven endpoints — all confirmed against the live API.
    const cases = [
      { tool: 'mcp_toteat_get_sales', from: 'ini', to: 'end', value: '20260801' },
      {
        tool: 'mcp_toteat_get_sales_by_waiter',
        from: 'initial_date',
        to: 'final_date',
        value: '20260801',
      },
      {
        tool: 'mcp_toteat_get_cancellation_report',
        from: 'start_date',
        to: 'end_date',
        value: '2026-08-01', // the lone dashed endpoint
      },
      {
        tool: 'mcp_toteat_get_accounting_movements',
        from: 'initial_date',
        to: 'final_date',
        value: '20260801',
      },
    ];

    for (const c of cases) {
      const { provider: p, calls } = provider({ ok: true, data: [] });
      await p.callTool(c.tool, { startDate: '2026-08-01', endDate: '2026-08-05' }, CTX);
      const params = new URL(calls[0]!).searchParams;
      expect(params.get(c.from), `${c.tool} start param`).toBe(c.value);
      expect(params.get(c.to), `${c.tool} end param`).not.toBeNull();
    }
  });
});

describe('toteat provider — order creation', () => {
  it('flattens modifiers positionally into the wire payload', async () => {
    const { impl, calls } = fakeFetch({ ok: true, msg: { texto: 'ORDER: Received' } });
    void calls;
    const p = createToteatProvider({ fetchImpl: impl });

    await p.callTool(
      'mcp_toteat_create_order',
      {
        orderReference: 'xcale-intent-42',
        type: 'delivery',
        lines: [
          {
            productCode: 'SB020',
            quantity: 1,
            modifiers: [{ productCode: 'SBEX046', quantity: 1 }],
          },
          { productCode: 'SB144', quantity: 2 },
        ],
      },
      CTX,
    );

    const body = JSON.parse(
      (impl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1]!
        .body as string,
    );
    expect(body.document.line.map((l: { productCode: string }) => l.productCode)).toEqual([
      'SB020',
      'SBEX046',
      'SB144',
    ]);
  });

  it('sends orderId 0 when creating, and the real id when appending to a table order', async () => {
    const { impl } = fakeFetch({ ok: true, msg: { texto: 'ORDER: Received' } });
    const p = createToteatProvider({ fetchImpl: impl });
    const mock = impl as unknown as { mock: { calls: [string, RequestInit][] } };

    await p.callTool(
      'mcp_toteat_create_order',
      {
        orderReference: 'ref-1',
        type: 'takeaway',
        lines: [{ productCode: 'SB144', quantity: 1 }],
      },
      CTX,
    );
    expect(JSON.parse(mock.mock.calls[0]![1]!.body as string).orderId).toBe(0);

    await p.callTool(
      'mcp_toteat_create_order',
      {
        orderReference: 'ref-2',
        type: 'order',
        tableId: 3,
        orderId: 1785875733117687,
        lines: [{ productCode: 'SB144', quantity: 1 }],
      },
      CTX,
    );
    expect(JSON.parse(mock.mock.calls[1]![1]!.body as string).orderId).toBe(1785875733117687);
  });

  it('refuses a table order with no tableId, before any request', async () => {
    const { provider: p, calls } = provider({ ok: true });

    const result = await p.callTool(
      'mcp_toteat_create_order',
      {
        orderReference: 'ref-3',
        type: 'order',
        lines: [{ productCode: 'SB144', quantity: 1 }],
      },
      CTX,
    );

    expect(result.kind).toBe('error');
    expect(calls).toHaveLength(0);
  });

  it('requires an orderReference — it is the only handle reconciliation has', async () => {
    const { provider: p } = provider({ ok: true });

    const result = await p.callTool(
      'mcp_toteat_create_order',
      { type: 'takeaway', lines: [{ productCode: 'SB144', quantity: 1 }] },
      CTX,
    );

    expect(result.kind).toBe('error');
    expect(errorCode(result)).toBe(ProviderErrorCode.INVALID_INPUT);
  });
});

describe('toteat provider — order tracking', () => {
  it('asks orderstatus for ONE order by `ic`, defaulting the detail level, never the listing', async () => {
    const { provider: p, calls } = provider({ ok: true, data: [] });

    await p.callTool('mcp_toteat_get_order_status', { orderId: '1785875733117687' }, CTX);

    const url = new URL(calls[0]!);
    expect(url.pathname).toBe('/mw/or/1.0/orderstatus');
    expect(url.searchParams.get('ic')).toBe('1785875733117687');
    expect(url.searchParams.get('body_detail_type')).toBe('ONLY_STATUS');
    // `listing` is what turns this endpoint into the venue-wide read — it must never appear here.
    expect(url.searchParams.get('listing')).toBeNull();
  });

  it('maps an INVALID ORDER NUMBER envelope to INVALID_INPUT', async () => {
    const { provider: p } = provider(invalidOrderNumber);

    const result = await p.callTool('mcp_toteat_get_order_status', { orderId: 'no-such' }, CTX);

    expect(errorCode(result)).toBe(ProviderErrorCode.INVALID_INPUT);
  });
});

describe('toteat provider — dispatch', () => {
  it('POSTs the courier to orders/dispatch exactly as declared', async () => {
    const { impl } = fakeFetch({ ok: true, msg: { texto: 'OK' } });
    const p = createToteatProvider({ fetchImpl: impl });
    const mock = impl as unknown as { mock: { calls: [string, RequestInit][] } };

    await p.callTool(
      'mcp_toteat_dispatch_order',
      {
        orderId: '1785875733117687',
        dispatcher: {
          name: 'Ana Rider',
          phoneNumber: '+56911112222',
          vehicle: { type: 'motorbike', licensePlate: 'AB1234' },
        },
      },
      CTX,
    );

    const [url, init] = mock.mock.calls[0]!;
    expect(new URL(url).pathname).toBe('/mw/or/1.0/orders/dispatch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      orderId: '1785875733117687',
      dispatcher: {
        name: 'Ana Rider',
        phoneNumber: '+56911112222',
        vehicle: { type: 'motorbike', licensePlate: 'AB1234' },
      },
    });
  });

  it("surfaces a migrated venue's refusal as PROVIDER_ERROR", async () => {
    // Legacy-only endpoint: a migrated environment answers with a provider error, not a success.
    const { provider: p } = provider(notAuthorized);

    const result = await p.callTool(
      'mcp_toteat_dispatch_order',
      { orderId: '1', dispatcher: { name: 'Ana Rider' } },
      CTX,
    );

    expect(errorCode(result)).toBe(ProviderErrorCode.PROVIDER_ERROR);
  });
});

describe('toteat provider — owner reporting', () => {
  it("asks collection for one day's takings in the compact wire format", async () => {
    const { provider: p, calls } = provider({ ok: true, data: [] });

    await p.callTool('mcp_toteat_get_collection', { date: '2026-08-05' }, CTX);

    const url = new URL(calls[0]!);
    expect(url.pathname).toBe('/mw/or/1.0/collection');
    expect(url.searchParams.get('date')).toBe('20260805');
  });

  it('surfaces a rate-limit envelope on collection as RATE_LIMITED', async () => {
    const { provider: p } = provider(rateLimited);

    const result = await p.callTool('mcp_toteat_get_collection', { date: '2026-08-05' }, CTX);

    expect(errorCode(result)).toBe(ProviderErrorCode.RATE_LIMITED);
  });

  it('threads doc_type through fiscaldocuments along with the compact window', async () => {
    const { provider: p, calls } = provider({ ok: true, data: [] });

    await p.callTool(
      'mcp_toteat_get_fiscal_documents',
      { startDate: '2026-08-01', endDate: '2026-08-05', docType: 'BOLETA' },
      CTX,
    );

    const url = new URL(calls[0]!);
    expect(url.pathname).toBe('/mw/or/1.0/fiscaldocuments');
    expect(url.searchParams.get('ini')).toBe('20260801');
    expect(url.searchParams.get('end')).toBe('20260805');
    expect(url.searchParams.get('doc_type')).toBe('BOLETA');
  });

  it('keeps the disabled-route refusal on fiscaldocuments away from AUTH_EXPIRED', async () => {
    // The live case behind the whole "Not Authorized" policy: this exact route refused with a
    // VALID token because the venue's POS security tab has not enabled it.
    const { provider: p } = provider(notAuthorized);

    const result = await p.callTool(
      'mcp_toteat_get_fiscal_documents',
      { startDate: '2026-08-01', endDate: '2026-08-05' },
      CTX,
    );

    expect(errorCode(result)).toBe(ProviderErrorCode.PROVIDER_ERROR);
    expect(errorCode(result)).not.toBe(ProviderErrorCode.AUTH_EXPIRED);
  });

  it('reads inventorystate with its own parameter names and the compact format', async () => {
    const { provider: p, calls } = provider({ ok: true, data: [] });

    await p.callTool(
      'mcp_toteat_get_inventory_state',
      { startDate: '2026-08-01', endDate: '2026-08-05' },
      CTX,
    );

    const url = new URL(calls[0]!);
    expect(url.pathname).toBe('/mw/or/1.0/inventorystate');
    expect(url.searchParams.get('initial_date')).toBe('20260801');
    expect(url.searchParams.get('final_date')).toBe('20260805');
  });
});

describe('toteat provider — purchase movements', () => {
  it('POSTs the invoice with the venue identity and the compact date', async () => {
    const { impl } = fakeFetch({ ok: true, msg: { texto: 'OK' } });
    const p = createToteatProvider({ fetchImpl: impl });
    const mock = impl as unknown as { mock: { calls: [string, RequestInit][] } };

    await p.callTool(
      'mcp_toteat_create_purchase_movement',
      {
        documentNumber: 'F-000123',
        date: '2026-08-05',
        supplier: { name: 'Proveedor Sur', fiscalId: '76123456-7' },
        lines: [{ productCode: 'ING001', quantity: 12.5, unitCost: 990 }],
      },
      CTX,
    );

    const [url, init] = mock.mock.calls[0]!;
    expect(new URL(url).pathname).toBe('/mw/or/1.0/purchasemovements');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      // The venue identity travels in the body too — numeric, straight from the call context.
      restaurantId: 1234567890123456,
      localNumber: 1,
      documentNumber: 'F-000123',
      date: '20260805',
      supplier: { name: 'Proveedor Sur', fiscalId: '76123456-7' },
      lines: [{ productCode: 'ING001', quantity: 12.5, unitCost: 990 }],
    });
  });

  it('maps a date rejection on purchasemovements to INVALID_INPUT', async () => {
    const { provider: p } = provider(invalidDateFormat);

    const result = await p.callTool(
      'mcp_toteat_create_purchase_movement',
      {
        documentNumber: 'F-000124',
        date: '2026-08-05',
        supplier: { name: 'Proveedor Sur' },
        lines: [{ productCode: 'ING001', quantity: 1, unitCost: 500 }],
      },
      CTX,
    );

    expect(errorCode(result)).toBe(ProviderErrorCode.INVALID_INPUT);
  });
});

describe('toteat provider — credential containment', () => {
  it('keeps the token out of a transport-failure result', async () => {
    // Undici puts the request URL in fetch-failure messages, and for Toteat the URL IS the
    // credential. This is the leak that would otherwise reach the agent prompt and the user's chat.
    const failing = vi.fn(async (url: string | URL) => {
      throw new Error(`fetch failed for ${String(url)}`);
    }) as unknown as typeof globalThis.fetch;
    const p = createToteatProvider({ fetchImpl: failing });

    const result = await p.callTool('mcp_toteat_get_shift_status', {}, CTX);

    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('keeps the token out of an error-body result', async () => {
    const echoing = vi.fn(
      async (url: string | URL) =>
        new Response(`upstream rejected ${String(url)}`, { status: 502 }),
    ) as unknown as typeof globalThis.fetch;
    const p = createToteatProvider({ fetchImpl: echoing });

    const result = await p.callTool('mcp_toteat_get_shift_status', {}, CTX);

    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('keeps the token out of a provider "Not Authorized" result', async () => {
    const { provider: p } = provider(notAuthorized);

    const result = await p.callTool('mcp_toteat_get_shift_status', {}, CTX);

    expect(result.kind).toBe('error');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
