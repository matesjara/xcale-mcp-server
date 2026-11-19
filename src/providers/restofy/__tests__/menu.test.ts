import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { createRestofyProvider } from '../provider';
import catalog from '../__fixtures__/catalog.json';
import catalogPage2 from '../__fixtures__/catalogPage2.json';
import fulfillments from '../__fixtures__/fulfillments.json';
import fulfillmentsEmpty from '../__fixtures__/fulfillmentsEmpty.json';
import { type Captured, ctx, fakeRestofy, sentBody } from './helpers';

const TAKEOUT = 'e921fb7a-eee7-4836-b61c-c966ec6d0105';

describe('restofy menu — S3 list_fulfillments', () => {
  it("returns the restaurant's delivery channels verbatim", async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({ 'integration/list-fulfillments': { body: fulfillments } }, capture),
    });

    const r = await provider.callTool('mcp_restofy_list_fulfillments', {}, ctx);

    expect(r).toMatchObject({ kind: 'success', data: fulfillments.data });
    expect(sentBody(capture[0])).toEqual({});
  });

  it('a restaurant with no delivery or takeout channel answers an empty list, not an error', async () => {
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({ 'integration/list-fulfillments': { body: fulfillmentsEmpty } }),
    });

    const r = await provider.callTool('mcp_restofy_list_fulfillments', {}, ctx);

    expect(r).toMatchObject({ kind: 'success', data: { fulfillments: [] } });
  });

  it('passes a sales channel through when one is named', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({ 'integration/list-fulfillments': { body: fulfillments } }, capture),
    });

    await provider.callTool(
      'mcp_restofy_list_fulfillments',
      { channelCode: 'channel.staff.pos' },
      ctx,
    );

    expect(sentBody(capture[0])).toEqual({ channelCode: 'channel.staff.pos' });
  });
});

describe('restofy menu — S3 list_catalog', () => {
  it('reads the menu of one channel, a whole page of 100 by default, verbatim', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy({ 'integration/list-catalog-products': { body: catalog } }, capture),
    });

    const r = await provider.callTool(
      'mcp_restofy_list_catalog',
      { fulfillmentUuid: TAKEOUT },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'success', data: catalog.data });
    expect(sentBody(capture[0])).toEqual({ fulfillmentUuid: TAKEOUT, limit: 100 });
  });

  it('passes a page through, with its modifier groups', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy(
        { 'integration/list-catalog-products': { body: catalogPage2 } },
        capture,
      ),
    });

    const r = await provider.callTool(
      'mcp_restofy_list_catalog',
      { fulfillmentUuid: TAKEOUT, page: 2, limit: 2 },
      ctx,
    );

    expect(r).toMatchObject({ kind: 'success', data: catalogPage2.data });
    expect(sentBody(capture[0])).toEqual({ fulfillmentUuid: TAKEOUT, page: 2, limit: 2 });
  });

  it.each([
    ['no channel', {}],
    ['a channel that is not a UUID', { fulfillmentUuid: 'takeout' }],
    ['a page larger than Restofy serves', { fulfillmentUuid: TAKEOUT, limit: 101 }],
  ])('refuses %s before reaching Restofy', async (_label, args) => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({ fetchImpl: fakeRestofy({}, capture) });

    const r = await provider.callTool('mcp_restofy_list_catalog', args, ctx);

    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(0);
  });
});
