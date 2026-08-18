import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { ProviderErrorCode } from '../../core/errors';
import { err, ok, type ToolDefinition, type ToolOutcome, toolFactory } from '../../core/tool';
import {
  assertDateWindow,
  type QueryParams,
  toCompactDate,
  ToteatDateError,
  type ToteatClient,
} from './client';
import type { ToteatContext } from './context';
import { unwrapToteat } from './errors';
import { buildOrderLines, toteatTimestamp } from './order-payload';
import { SLUG } from './manifest';

const tool = toolFactory<ToteatContext>();

const NO_ARGS = z.object({}).strict();

/**
 * A refused order, in full, where a human can actually find it.
 *
 * Toteat's envelope says only `Invalid Parameters` — no field, no reason — so the exact body we sent
 * next to its raw answer is the only thing that turns "it does not work" into a diagnosis. Two
 * destinations on purpose: the console for whoever is watching the process, and a file for whoever
 * is not, because the person debugging is rarely the one who started the gateway.
 *
 * Failure-only, and never on a read path, so this stays a rare line rather than a log of every order.
 *
 * The file is skipped in production: there the console goes to the platform's log aggregator, and a
 * gateway writing to its own container's disk is a leak nobody is watching.
 */
function reportRefusedOrder(message: string, sent: unknown, received: unknown): void {
  const block =
    `[toteat] create_order refused: ${message}
` +
    `  sent    : ${JSON.stringify(sent)}
` +
    `  received: ${JSON.stringify(received)}`;
  console.warn(block);

  if (process.env.NODE_ENV === 'production') return;
  try {
    appendFileSync(
      join(tmpdir(), 'toteat-order-refusals.log'),
      `${block}
`,
    );
  } catch {
    // Diagnostics must never take down the call they were describing.
  }
}

/** ISO calendar date on the tool boundary; each endpoint's own wire format is applied inside. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/**
 * Every period tool is the same three steps — validate the window locally, call, unwrap — differing
 * only in the path and in what the endpoint calls its date params. Toteat uses three different
 * namings and two formats across seven endpoints, so the *names* are data passed in here, never
 * derived. `dashed` marks the lone endpoint that wants `YYYY-MM-DD`.
 */
function periodTool(opts: {
  readonly verb: string;
  readonly path: string;
  readonly description: string;
  readonly from: string;
  readonly to: string;
  readonly dashed?: boolean;
  readonly extra?: z.ZodRawShape;
  readonly extraParams?: (args: Record<string, unknown>) => QueryParams;
  readonly client: ToteatClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
}): ToolDefinition<any, ToteatContext> {
  const input = z.object({ startDate: isoDate, endDate: isoDate, ...(opts.extra ?? {}) }).strict();

  return tool({
    name: `mcp_${SLUG}_${opts.verb}`,
    description: opts.description,
    input,
    handler: async (args, ctx) => {
      const guard = guardWindow(args.startDate, args.endDate);
      if (guard) return guard;
      const fmt = opts.dashed === true ? (d: string) => d : toCompactDate;
      const params: QueryParams = {
        [opts.from]: fmt(args.startDate),
        [opts.to]: fmt(args.endDate),
        ...(opts.extraParams ? opts.extraParams(args) : {}),
      };
      const res = await opts.client.get(opts.path, ctx.request, ctx.metadata, params);
      return toOutcome(unwrapToteat(res, opts.verb));
    },
  });
}

/** Reject an impossible window before it costs one of the endpoint's three requests per minute. */
function guardWindow(start: string, end: string): ToolOutcome | undefined {
  try {
    assertDateWindow(start, end);
    return undefined;
  } catch (e) {
    if (e instanceof ToteatDateError) return err(ProviderErrorCode.INVALID_INPUT, e.message);
    throw e;
  }
}

function toOutcome(result: ReturnType<typeof unwrapToteat>): ToolOutcome {
  return result.ok ? ok(result.data) : err(result.code, result.message);
}

export function buildToteatTools(
  client: ToteatClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, ToteatContext>> {
  return [
    // -----------------------------------------------------------------------
    // Serving a customer
    // -----------------------------------------------------------------------
    tool({
      name: `mcp_${SLUG}_get_shift_status`,
      description:
        'Check whether the venue currently has an open shift. A closed shift means the venue is ' +
        'not serving and no order can be placed — that is a business answer, not an error. This is ' +
        'also the cheapest call that proves a credential works.',
      input: NO_ARGS,
      handler: async (_args, ctx) =>
        toOutcome(
          unwrapToteat(await client.get('shiftstatus', ctx.request, ctx.metadata), 'shift status'),
        ),
    }),

    tool({
      name: `mcp_${SLUG}_get_tables`,
      description:
        'List the venue tables with capacity, section and live occupancy. `available` is occupancy ' +
        'RIGHT NOW, not a calendar: Toteat has no reservations endpoint, so this answers "is there a ' +
        'table free" and can never answer "hold a table for Friday at 9".',
      input: NO_ARGS,
      handler: async (_args, ctx) =>
        toOutcome(unwrapToteat(await client.get('tables', ctx.request, ctx.metadata), 'tables')),
    }),

    tool({
      name: `mcp_${SLUG}_get_menu`,
      description:
        'Read the full menu: products, prices, categories and modifier groups. This is a ' +
        'SYNCHRONISATION read capped at 3 requests per minute for the whole venue — it is meant to ' +
        'populate a cache, not to answer one diner. Products and modifiers come back in one flat ' +
        'list discriminated by `isModifier`; a product references modifier CATEGORIES, so the ' +
        'options for a group are the modifiers whose `categoryId` equals the group `id`.',
      input: z.object({ activeProducts: z.boolean().optional() }).strict(),
      // Withdrawn from tools/list. 3 requests per minute is the whole VENUE's budget, shared by
      // every conversation it is handling — an agent that can reach this tool will spend it on one
      // diner and mute the venue for everyone else. The consumer mirrors the menu and reads from
      // that; this stays callable BY NAME for the ingest, which is exactly what a control plane is.
      controlPlane: true,
      handler: async (args, ctx) => {
        const params: QueryParams =
          args.activeProducts === undefined ? {} : { activeProducts: args.activeProducts };
        return toOutcome(
          unwrapToteat(await client.get('products', ctx.request, ctx.metadata, params), 'menu'),
        );
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_order_status`,
      description:
        'Follow one order by its Toteat order id. Returns the general status (OPEN / CANCELLED / ' +
        'CLOSED) and the kitchen/delivery step in `deliveryStatusId` (40 new, 100 preparing, 110 ' +
        'ready, 120 out for delivery, 180 delivered).',
      input: z
        .object({
          orderId: z.string().min(1),
          detail: z
            .enum(['ONLY_STATUS', 'ALL_INFORMATION', 'DELIVERY_INFORMATION'])
            .default('ONLY_STATUS'),
        })
        .strict(),
      handler: async (args, ctx) =>
        toOutcome(
          unwrapToteat(
            await client.get('orderstatus', ctx.request, ctx.metadata, {
              ic: args.orderId,
              body_detail_type: args.detail,
            }),
            'order status',
          ),
        ),
    }),

    tool({
      name: `mcp_${SLUG}_list_open_orders`,
      description:
        'List every order currently OPEN at the venue, each with the `orderReference` the caller ' +
        'supplied when creating it. This is how a caller discovers whether an order it never got a ' +
        'response for actually landed — read this before retrying a create, never retry blind.',
      input: z
        .object({
          detail: z
            .enum(['ONLY_STATUS', 'ALL_INFORMATION', 'DELIVERY_INFORMATION'])
            .default('ONLY_STATUS'),
        })
        .strict(),
      // Withdrawn from tools/list: this returns EVERY open order in the venue, including other
      // diners' — not a move an agent may make on one customer's behalf. It exists so a caller can
      // reconcile its own `orderReference` after a create it never got an answer for.
      controlPlane: true,
      handler: async (args, ctx) =>
        toOutcome(
          unwrapToteat(
            await client.get('orderstatus', ctx.request, ctx.metadata, {
              listing: 1,
              body_detail_type: args.detail,
            }),
            'open orders',
          ),
        ),
    }),

    tool({
      name: `mcp_${SLUG}_create_order`,
      description:
        'Create an order, or append products to an existing table order. `orderReference` is the ' +
        "CALLER's own id and is required: it is the only handle by which a failed call can later be " +
        'reconciled against `list_open_orders`. Extras are declared nested inside their product — ' +
        'this tool flattens them into the positional format Toteat expects. Send each ' +
        "line's `amountAfterTax` (unit price × quantity, tax included) with its `productName` " +
        'and `category`: a venue rejects an order that names dishes without pricing them. ' +
        'Payment is create-time only; an open order cannot be paid through the API. ' +
        'A shift must be open.',
      input: z
        .object({
          orderReference: z.string().min(1),
          type: z.enum(['order', 'delivery', 'takeaway', 'pickup']),
          channel: z
            .enum(['webstore', 'crm', 'erp', 'pos', 'marketplace', 'app'])
            .default('webstore'),
          /** Who is sending the order. Printed by the venue to tell integrations apart. */
          vendorName: z.string().min(1).optional(),
          /** Required by Toteat on create; `new` is the only honest value for an order we just took. */
          status: z
            .enum(['new', 'created', 'preparing', 'ready', 'ondelivery', 'delivered'])
            .default('new'),
          /** Required when `type` is `order` (a physical table). Ids come from `get_tables`. */
          tableId: z.number().int().positive().optional(),
          /** Append to an existing TABLE order. Omit to create a new one. */
          orderId: z.number().int().positive().optional(),
          comment: z.string().optional(),
          lines: z
            .array(
              z
                .object({
                  productCode: z.string().min(1),
                  quantity: z.number().int().positive(),
                  comment: z.string().optional(),
                  /** Line total, tax included — unit price × quantity, not a unit price. */
                  amountAfterTax: z.number().nonnegative().optional(),
                  productName: z.string().min(1).optional(),
                  category: z.string().min(1).optional(),
                  /** Itemized taxes. Sent as `[]` when unknown — Toteat requires the key. */
                  tax: z
                    .array(z.object({ name: z.string().min(1), value: z.number() }).strict())
                    .optional(),
                  modifiers: z
                    .array(
                      z
                        .object({
                          productCode: z.string().min(1),
                          quantity: z.number().int().positive(),
                          amountAfterTax: z.number().nonnegative().optional(),
                          productName: z.string().min(1).optional(),
                          category: z.string().min(1).optional(),
                          tax: z
                            .array(
                              z.object({ name: z.string().min(1), value: z.number() }).strict(),
                            )
                            .optional(),
                        })
                        .strict(),
                    )
                    .default([]),
                })
                .strict(),
            )
            .min(1),
          customer: z
            .object({
              name: z.string().min(1),
              lastName: z.string().optional(),
              phoneNumber: z.string().optional(),
              email: z.string().optional(),
              fiscalId: z.string().optional(),
              delivery: z
                .object({
                  address: z.string().min(1),
                  city: z.string().optional(),
                  country: z.string().optional(),
                  cityArea: z.string().optional(),
                  floor: z.string().optional(),
                  comment: z.string().optional(),
                })
                .strict()
                .optional(),
            })
            .strict()
            .optional(),
          /**
           * Required by Toteat: it refuses an order with no payments block at all
           * (`Field 'document.payments' - Field required`, observed 2026-08-18). Use `pending: true`
           * for an order the diner settles at the venue or with the courier.
           */
          payment: z
            .object({
              amount: z.number(),
              /**
               * What the diner has actually handed over. Defaults to 0 — for an order settled at the
               * venue or with the courier, nothing has been paid yet, and claiming otherwise tells a
               * till it is square when it is not.
               */
              amountPaid: z.number().default(0),
              tip: z.number().optional(),
              /** 1000 cash, 2000 credit, 3000 debit, 9001 transfer; venues may define their own. */
              paymentType: z.number().int(),
              /** `true` records the full payment for the till to confirm, rather than as settled. */
              pending: z.boolean().default(false),
            })
            .strict()
            .optional(),
        })
        .strict(),
      handler: async (args, ctx) => {
        if (args.type === 'order' && args.tableId === undefined) {
          return err(
            ProviderErrorCode.INVALID_INPUT,
            'A table order requires `tableId`. Read the ids from get_tables.',
          );
        }

        // Toteat requires all three inside the payment and documents none of them as required
        // (`document.payments.0.{id,amountPaid,operationDate}`, observed 2026-08-18). `id: 0` is its
        // stated convention for "this is new", the same one `orderId` uses. The payment is stamped
        // with the order's own moment: they are the same event.
        const stampedAt = toteatTimestamp(new Date());
        const payments =
          args.payment === undefined
            ? undefined
            : [{ id: 0, operationDate: stampedAt, ...args.payment }];

        const body: Record<string, unknown> = {
          restaurantId: Number(ctx.metadata.xir),
          localNumber: Number(ctx.metadata.xil),
          orderReference: args.orderReference,
          type: args.type,
          channel: args.channel,
          ...(args.vendorName !== undefined ? { vendorName: args.vendorName } : {}),
          // Toteat wants 0 for "create"; a real id means "append to this table order".
          orderId: args.orderId ?? 0,
          ...(args.tableId !== undefined ? { tableId: args.tableId } : {}),
          status: args.status,
          // Required by Toteat. Stamped HERE, at the moment of the call, because that is when the
          // order reaches the venue — and because idempotency rests on `orderReference`, not on this,
          // so a retry seconds later is still the same order.
          operationDate: stampedAt,
          ...(args.comment !== undefined ? { comment: args.comment } : {}),
          document: {
            line: buildOrderLines(args.lines),
            ...(args.customer !== undefined ? { customer: args.customer } : {}),
            ...(payments !== undefined ? { payments } : {}),
          },
        };

        const res = await client.post('orders', ctx.request, ctx.metadata, body);
        const unwrapped = unwrapToteat(res, 'create order');

        // A refused order is the one failure a venue cannot shrug off, and Toteat's envelope says
        // only `Invalid Parameters` — no field, no reason. Its RAW answer, next to the exact body we
        // sent, is the only thing that turns "it does not work" into a diagnosis. Logged on failure
        // only, and never on the read paths, so this stays a rare line and not a firehose of orders.
        if (!unwrapped.ok) {
          reportRefusedOrder(unwrapped.message, body, res.ok ? res.data : res.body);
        }

        return toOutcome(unwrapped);
      },
    }),

    tool({
      name: `mcp_${SLUG}_dispatch_order`,
      description:
        'Attach external dispatch information (courier, vehicle) to a delivery order. Legacy Toteat ' +
        'environments only — a migrated venue answers with a provider error.',
      input: z
        .object({
          orderId: z.string().min(1),
          dispatcher: z
            .object({
              name: z.string().min(1),
              phoneNumber: z.string().optional(),
              email: z.string().optional(),
              vehicle: z
                .object({ type: z.string().min(1), licensePlate: z.string().optional() })
                .strict()
                .optional(),
            })
            .strict(),
        })
        .strict(),
      handler: async (args, ctx) =>
        toOutcome(
          unwrapToteat(
            await client.post('orders/dispatch', ctx.request, ctx.metadata, {
              orderId: args.orderId,
              dispatcher: args.dispatcher,
            }),
            'dispatch order',
          ),
        ),
    }),

    // -----------------------------------------------------------------------
    // Answering the owner — every one of these is capped at 3 requests/minute
    // -----------------------------------------------------------------------
    periodTool({
      client,
      verb: 'get_sales',
      path: 'sales',
      from: 'ini',
      to: 'end',
      description: 'Sales for a period (max 15 days). Owner-facing reporting, not diner-facing.',
      extra: { includeCancelled: z.boolean().optional() },
      extraParams: (a) =>
        a.includeCancelled === undefined
          ? {}
          : { detail_cancel_order: a.includeCancelled as boolean },
    }),

    periodTool({
      client,
      verb: 'get_sales_by_waiter',
      path: 'salesbywaiter',
      from: 'initial_date',
      to: 'final_date',
      description: 'Sales broken down by waiter for a period. Owner-facing reporting.',
    }),

    periodTool({
      client,
      verb: 'get_cancellation_report',
      path: 'orders/cancellation-report',
      from: 'start_date',
      to: 'end_date',
      dashed: true,
      description: 'Orders cancelled during a period. Owner-facing reporting.',
    }),

    periodTool({
      client,
      verb: 'get_fiscal_documents',
      path: 'fiscaldocuments',
      from: 'ini',
      to: 'end',
      description:
        'Fiscal documents issued during a period (max 15 days). Owner-facing; requires the route to ' +
        'be enabled in the venue POS security tab.',
      extra: { docType: z.string().optional() },
      extraParams: (a) => (a.docType === undefined ? {} : { doc_type: a.docType as string }),
    }),

    periodTool({
      client,
      verb: 'get_inventory_state',
      path: 'inventorystate',
      from: 'initial_date',
      to: 'final_date',
      description: 'Inventory state and stock movements for a period. Owner-facing.',
    }),

    periodTool({
      client,
      verb: 'get_accounting_movements',
      path: 'accountingmovements',
      from: 'initial_date',
      to: 'final_date',
      description: 'Accounting movements for a period. Owner-facing.',
      extra: { includeSales: z.boolean().optional() },
      extraParams: (a) =>
        a.includeSales === undefined ? {} : { include_sales: a.includeSales as boolean },
    }),

    tool({
      name: `mcp_${SLUG}_get_collection`,
      description: "One day's takings, broken down by shift. Owner-facing.",
      input: z.object({ date: isoDate }).strict(),
      handler: async (args, ctx) =>
        toOutcome(
          unwrapToteat(
            await client.get('collection', ctx.request, ctx.metadata, {
              date: toCompactDate(args.date),
            }),
            'collection',
          ),
        ),
    }),

    tool({
      name: `mcp_${SLUG}_create_purchase_movement`,
      description:
        "Register an ingredient purchase invoice against the venue's inventory and accounting. This " +
        'is a write into the books — owner-facing, never a diner-facing action.',
      input: z
        .object({
          documentNumber: z.string().min(1),
          date: isoDate,
          supplier: z.object({ name: z.string().min(1), fiscalId: z.string().optional() }).strict(),
          lines: z
            .array(
              z
                .object({
                  productCode: z.string().min(1),
                  quantity: z.number().positive(),
                  unitCost: z.number(),
                })
                .strict(),
            )
            .min(1),
        })
        .strict(),
      handler: async (args, ctx) =>
        toOutcome(
          unwrapToteat(
            await client.post('purchasemovements', ctx.request, ctx.metadata, {
              restaurantId: Number(ctx.metadata.xir),
              localNumber: Number(ctx.metadata.xil),
              documentNumber: args.documentNumber,
              date: toCompactDate(args.date),
              supplier: args.supplier,
              lines: args.lines,
            }),
            'create purchase movement',
          ),
        ),
    }),
  ];
}
