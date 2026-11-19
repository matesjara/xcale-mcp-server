import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { idempotencyKey } from '../idempotency';
import { createRestofyProvider } from '../provider';
import order from '../__fixtures__/order.json';
import orderExisting from '../__fixtures__/orderExisting.json';
import orderRead from '../__fixtures__/orderRead.json';
import orderNotFound from '../__fixtures__/errors/orderNotFound.json';
import quote from '../__fixtures__/quote.json';
import { type Captured, ctx, fakeRestofy, sentBody, sentHeader } from './helpers';

const DELIVERY = 'd859037e-2d9e-4ef3-a943-5bb9fcf28d97';

/** The draft of a delivery order: 2 burgers medium with extra cheese, and a lemonade. */
const draft = {
  fulfillmentUuid: DELIVERY,
  items: [
    {
      productId: 2,
      menuId: 1,
      qty: 2,
      modifiers: [
        { modifierGroupId: 1, modifierId: 3, quantity: 1 },
        { modifierGroupId: 2, modifierId: 4, quantity: 1 },
      ],
    },
    { productId: 4, menuId: 1, qty: 1 },
  ],
  customer: { name: 'Comensal Prueba', phone: '+573001112233' },
  delivery: { addressLine: 'Calle 10 # 43-20', addressDetail: 'Apto 501' },
};

describe('restofy order — S4 quote_order', () => {
  it("prices the draft with Restofy's dry run and returns its totals verbatim", async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({ 'integration/create-order': { body: quote } }, capture),
    });

    const r = await provider.callTool('mcp_restofy_quote_order', draft, ctx);

    expect(r).toMatchObject({ kind: 'success', data: quote.data });
    const body = sentBody(capture[0]);
    expect(body).toMatchObject({
      dryRun: true,
      fulfillmentUuid: DELIVERY,
      items: draft.items,
      customerName: 'Comensal Prueba',
      customerPhone: '+573001112233',
      addressLine: 'Calle 10 # 43-20',
      addressDetail: 'Apto 501',
    });
    expect(body).not.toHaveProperty('customer');
    expect(body).not.toHaveProperty('delivery');
    expect(String(body.externalReference)).toMatch(/^quote-[0-9a-f]{32}$/);
  });

  it('sends the Idempotency-Key Restofy requires, derived from what it sends', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({ 'integration/create-order': { body: quote } }, capture),
    });

    await provider.callTool('mcp_restofy_quote_order', draft, ctx);

    const body = sentBody(capture[0]);
    expect(sentHeader(capture[0], 'idempotency-key')).toBe(
      idempotencyKey(String(body.externalReference), body),
    );
  });

  it("refuses a customer phone that is not E.164, the format Restofy's lookups match", async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({ fetchImpl: fakeRestofy({}, capture) });

    const r = await provider.callTool(
      'mcp_restofy_quote_order',
      { ...draft, customer: { name: 'X', phone: '3001112233' } },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(0);
  });
});

describe('restofy order — S4 get_order', () => {
  const ORDER = 'a7716445-7138-48cd-b9e2-9ef0d7c0dcb9';

  it('reads one order by its id and returns its statuses verbatim', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({ 'integration/get-order': { body: orderRead } }, capture),
    });

    const r = await provider.callTool('mcp_restofy_get_order', { orderUuid: ORDER }, ctx);

    expect(r).toMatchObject({ kind: 'success', data: orderRead.data });
    expect(sentBody(capture[0])).toEqual({ orderUuid: ORDER });
  });

  it('publishes that it reads one record its owner may see: the order the diner placed', () => {
    const tool = createRestofyProvider()
      .listTools()
      .find((t) => t.name === 'mcp_restofy_get_order');
    expect(tool?.identityPolicy).toEqual({
      mode: 'subject-bound',
      identityFields: [],
      recordOwnershipField: 'orderUuid',
      recordOwnershipKind: 'restofy:order',
      recordAction: 'read',
    });
  });
});

describe('restofy order — S4 find_order_by_reference (control plane)', () => {
  it('finds the order the caller placed under its own reference', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({ 'integration/get-order': { body: orderRead } }, capture),
    });

    const r = await provider.callTool(
      'mcp_restofy_find_order_by_reference',
      { externalReference: 'xcale-test-001' },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'success', data: { found: true, ...orderRead.data } });
    expect(sentBody(capture[0])).toEqual({ externalReference: 'xcale-test-001' });
  });

  it('a reference that never landed is { found: false }, a fact, not an error', async () => {
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({
        'integration/get-order': { status: 400, body: orderNotFound },
      }),
    });

    const r = await provider.callTool(
      'mcp_restofy_find_order_by_reference',
      { externalReference: 'never-sent' },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'success', data: { found: false } });
  });

  it('any other refusal stays an error', async () => {
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({
        'integration/get-order': {
          status: 401,
          body: { success: false, message: 'Token de autorización no es válido', data: [] },
        },
      }),
    });

    const r = await provider.callTool(
      'mcp_restofy_find_order_by_reference',
      { externalReference: 'x' },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
  });

  it("is withdrawn from the agent's menu", () => {
    expect(
      createRestofyProvider()
        .listTools()
        .map((t) => t.name),
    ).not.toContain('mcp_restofy_find_order_by_reference');
  });
});

describe('restofy order — S4 create_order (control plane)', () => {
  const takeout = {
    fulfillmentUuid: 'e921fb7a-eee7-4836-b61c-c966ec6d0105',
    items: [
      {
        productId: 2,
        menuId: 1,
        qty: 1,
        modifiers: [{ modifierGroupId: 1, modifierId: 1, quantity: 1 }],
      },
    ],
    externalReference: 'xcale-test-001',
  };

  it("places the order under the caller's reference, with no dry run, and returns it verbatim", async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({ 'integration/create-order': { body: order } }, capture),
    });

    const r = await provider.callTool('mcp_restofy_create_order', takeout, ctx);

    expect(r).toMatchObject({ kind: 'success', data: order.data });
    const body = sentBody(capture[0]);
    expect(body).toMatchObject({ externalReference: 'xcale-test-001', items: takeout.items });
    expect(body).not.toHaveProperty('dryRun');
    expect(sentHeader(capture[0], 'idempotency-key')).toBe(idempotencyKey('xcale-test-001', body));
  });

  it('a reference already used comes back as the existing order, flagged, never a second one', async () => {
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({ 'integration/create-order': { body: orderExisting } }),
    });

    const r = await provider.callTool('mcp_restofy_create_order', takeout, ctx);

    expect(r).toMatchObject({ kind: 'success', data: { isExistingOrder: true } });
  });

  it('requires a reference: it is the only handle that keeps an order from landing twice', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({ fetchImpl: fakeRestofy({}, capture) });
    const { externalReference: _omitted, ...withoutRef } = takeout;

    const r = await provider.callTool('mcp_restofy_create_order', withoutRef, ctx);

    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(0);
  });

  it("is routable but withdrawn from the agent's menu", () => {
    const provider = createRestofyProvider();
    expect(provider.routableToolNames()).toContain('mcp_restofy_create_order');
    expect(provider.listTools().map((t) => t.name)).not.toContain('mcp_restofy_create_order');
  });
});
