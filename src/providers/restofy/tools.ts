import { z } from 'zod';

import { defineTool, type ToolDefinition } from '../../core/tool';
import type { RestofyClient } from './client';
import { toOutcome } from './errors';
import { SLUG } from './manifest';

const NO_ARGS = z.object({}).strict();

/**
 * A Restofy UUID (36 characters), as every `*Uuid` field is. Shape only, no version check: Restofy mixes
 * MySQL v1 ids (`c3778dbb-e3b0-11f1-…`) with v4 ones (observed).
 */
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'a 36-character UUID');

export function buildRestofyTools(client: RestofyClient): ToolDefinition[] {
  return [
    defineTool({
      name: `mcp_${SLUG}_get_business_profile`,
      description:
        "The restaurant's public profile, its weekly opening schedule, its timezone and whether it is " +
        'open right now (`isOpenNow`). Read it before promising a delivery or a time.',
      input: NO_ARGS,
      readOnly: true,
      audience: 'customer',
      handler: async (_args, ctx) =>
        toOutcome(await client.call('business-profile/get-business-profile', ctx.request)),
    }),

    defineTool({
      name: `mcp_${SLUG}_list_fulfillments`,
      description:
        "The restaurant's delivery channels for orders taken by an integration (delivery, takeout, " +
        'curbside…), each with its `fulfillmentUuid` — the id the menu and every order need — its fee ' +
        'mode and, for delivery by zone, `deliveryZones`. Dine-in is never listed. An EMPTY ' +
        '`fulfillments` means the restaurant has not created a delivery or takeout channel in Restofy, ' +
        'so no menu can be read and no order placed until it does.',
      input: z.object({ channelCode: z.string().min(1).max(60).optional() }).strict(),
      readOnly: true,
      audience: 'customer',
      handler: async (args, ctx) =>
        toOutcome(await client.call('integration/list-fulfillments', ctx.request, { ...args })),
    }),

    defineTool({
      name: `mcp_${SLUG}_list_catalog`,
      description:
        "The restaurant's menu for ONE delivery channel (`fulfillmentUuid` from list_fulfillments — " +
        'prices may differ between channels): menus, categories, products with `basePriceCents`, ' +
        'alternate prices and their options, modifier groups with `minSelections`/`maxSelections` ' +
        '(a group with minSelections ≥ 1 must be chosen; such products have `requiresConfig: true`), ' +
        'modifiers with their price, and allergens. Every amount is an integer in CENTS of the ' +
        "restaurant's currency (COP 32.000 is 3200000). Paged at up to 100 products; groups and " +
        'modifiers come with the page of products they belong to. The total to confirm comes from ' +
        'quote_order, never from adding up this menu.',
      input: z
        .object({
          fulfillmentUuid: uuid,
          menuId: z.number().int().positive().optional(),
          page: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).default(100),
        })
        .strict(),
      readOnly: true,
      audience: 'customer',
      handler: async (args, ctx) =>
        toOutcome(await client.call('integration/list-catalog-products', ctx.request, { ...args })),
    }),
  ];
}
