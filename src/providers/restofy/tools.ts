import { z } from 'zod';

import { defineTool, ok, type ToolDefinition } from '../../core/tool';
import type { RestofyClient } from './client';
import { refusedWith, toOutcome } from './errors';
import { idempotencyKey, quoteReference } from './idempotency';
import { SLUG } from './manifest';
import { orderDraft, toCreateOrderBody } from './order-body';
import { uuid } from './schemas';

const NO_ARGS = z.object({}).strict();

/** Restofy's sentence for an order it cannot find (observed): "No encontramos ese pedido. …". */
const ORDER_NOT_FOUND = 'No encontramos ese pedido';

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

    defineTool({
      name: `mcp_${SLUG}_quote_order`,
      description:
        'Price an order WITHOUT placing it: Restofy validates every line, option and the delivery ' +
        'data, and computes the totals in cents (`subtotalCents`, `deliveryFeeCents`, ' +
        '`grandTotalCents`) on the given channel. Nothing is saved. Quote on the channel the diner ' +
        'chose (delivery or takeout) and confirm THIS total, never one added up from the menu. A ' +
        'refusal names what is missing (a required option, the delivery address) in a sentence for ' +
        'a person. Delivery needs `customer.name`, `customer.phone` (E.164) and ' +
        '`delivery.addressLine`. The order goes in unpaid; how it is paid is the restaurant’s.',
      input: orderDraft,
      readOnly: true,
      audience: 'customer',
      handler: async (draft, ctx) => {
        const unreferenced = toCreateOrderBody(draft, true);
        const ref = quoteReference(unreferenced);
        const body = { externalReference: ref, ...unreferenced };
        return toOutcome(
          await client.call('integration/create-order', ctx.request, body, {
            'Idempotency-Key': idempotencyKey(ref, body),
          }),
        );
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_get_order`,
      description:
        'Follow one order by its `orderUuid`: `lifecycleStatus` (e.g. `open`), `paymentStatus` (e.g. ' +
        '`unpaid`) and, on delivery, `deliveryStatus` (`pending`, `in_transit`, `delivered`, `failed`, ' +
        '`cancelled`), with its lines and totals in cents, as Restofy returns them. Restofy does NOT ' +
        'expose kitchen stages to integrations: an order being cooked or ready still reads `open`, ' +
        'so never tell a diner it is being prepared or ready from this alone.',
      input: z.object({ orderUuid: uuid }).strict(),
      readOnly: true,
      audience: 'customer',
      identityPolicy: {
        mode: 'subject-bound',
        identityFields: [],
        recordOwnershipField: 'orderUuid',
        recordOwnershipKind: `${SLUG}:order`,
        recordAction: 'read',
      },
      handler: async (args, ctx) =>
        toOutcome(await client.call('integration/get-order', ctx.request, { ...args })),
    }),

    defineTool({
      name: `mcp_${SLUG}_find_order_by_reference`,
      description:
        'Find the order the caller placed under its own `externalReference`, to reconcile a create ' +
        'whose answer was lost. `{ found: false }` means it never landed.',
      input: z.object({ externalReference: z.string().min(1).max(60) }).strict(),
      readOnly: true,
      // Withdrawn from tools/list: reconciliation by the caller's own reference is the consumer's job.
      controlPlane: true,
      handler: async (args, ctx) => {
        const result = await client.call('integration/get-order', ctx.request, { ...args });
        if (refusedWith(result, ORDER_NOT_FOUND)) return ok({ found: false });
        const outcome = toOutcome(result);
        return outcome.ok ? ok({ found: true, ...(outcome.data as object) }) : outcome;
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_create_order`,
      description:
        'Place an order in the restaurant’s POS under the caller’s own `externalReference`. Restofy ' +
        'creates it atomically and AT MOST ONCE per reference: a reference already used returns the ' +
        'existing order with `isExistingOrder: true` — possibly with other contents than this call ' +
        'sent — never a second order. The order goes in `open` and `unpaid`; the channel’s rules ' +
        'decide whether it goes straight to the kitchen. Restofy prices it from the menu; no amount ' +
        'is sent except `delivery.deliveryFeeCents` in the manual fee mode.',
      input: orderDraft.extend({ externalReference: z.string().min(1).max(60) }).strict(),
      // Withdrawn from tools/list [CTO 2026-11-18, #224]: the backend's commerce materialization owns
      // the confirm and the reference. Restofy blocks duplicates only per `externalReference`, so an
      // agent calling this with its own reference while commerce calls it with another could send one
      // diner's order to the kitchen twice. The agent still orders, through the commerce tools.
      controlPlane: true,
      handler: async ({ externalReference, ...draft }, ctx) => {
        const body = { externalReference, ...toCreateOrderBody(draft, false) };
        return toOutcome(
          await client.call('integration/create-order', ctx.request, body, {
            'Idempotency-Key': idempotencyKey(externalReference, body),
          }),
        );
      },
    }),
  ];
}
