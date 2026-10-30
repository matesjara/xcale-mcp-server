import { z } from 'zod';

import { toolFactory, type ToolDefinition } from '../../core/tool';
import type { HotelSyncClient } from './client';
import type { HotelSyncContext } from './context';
import { unwrapHotelSync } from './errors';
import { SLUG } from './manifest';

const tool = toolFactory<HotelSyncContext>();

/** No-argument input — the reads that take no filter (the property rides the call context). */
const noArgs = z.object({}).strict();

/**
 * HotelSync takes dates as ISO calendar dates, `YYYY-MM-DD`. The refine confirms the date is a real
 * calendar day, so `2026-02-30` never reaches a write.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD)')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real calendar date');

/** A `dfrom`/`dto` range, `dto` not before `dfrom` (ISO dates compare as strings). */
const dateRange = { dfrom: isoDate, dto: isoDate };
const rangeOrdered = (v: { dfrom: string; dto: string }) => v.dto >= v.dfrom;
const rangeMessage = { message: 'dto must not be before dfrom', path: ['dto'] };

const id = z.number().int().positive();
const count = z.number().int().nonnegative();

/**
 * The HotelSync tools. Every endpoint is a JSON POST; the property comes from the call context and the
 * session key and partner token are placed by the core. Data is returned verbatim.
 *
 * The agent's menu holds the money-free reads. Prices, reservations and webhooks are `controlPlane`
 * (ADR 0013): the consumer's booking flow composes the quote — the agent never narrates a raw, pre-tax
 * price — and performs every reservation change behind its own checks of who is asking (the Cloudbeds and
 * Erbon model). Endpoint names and fields are HotelSync's OpenAPI (2026-10-28); see
 * `docs/design/hotelsync-provider/api-contract.md` for what is still to be observed.
 */
export function buildHotelSyncTools(
  client: HotelSyncClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, HotelSyncContext>> {
  return [
    // ── Agent menu: money-free reads ─────────────────────────────────────────────────────────────
    tool({
      name: `mcp_${SLUG}_get_property`,
      description:
        "Read the connected HotelSync property's details (name, type, contact, address, check-in and " +
        'check-out times, currency, policies), verbatim. No room types or prices — use list_room_types ' +
        'and the booking flow for those. Takes no arguments.',
      input: noArgs,
      handler: async (_args, ctx) =>
        unwrapHotelSync(
          await client.post('/api/property/data/property', ctx.request, ctx.metadata),
          'get property',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_list_room_types`,
      description:
        'List the room types (units) of the connected HotelSync property, verbatim: each carries ' +
        '`id_room_types`, `name`, `type`, `occupancy`, `bathrooms`, `area` and, with `details: true`, its ' +
        'description and amenities. Use `id_room_types` to read availability and to book.',
      input: z
        .object({
          details: z.boolean().optional().describe('Include descriptions and amenities.'),
          type: z.string().min(1).optional().describe('Only room types of this category.'),
        })
        .strict(),
      handler: async (args, ctx) =>
        unwrapHotelSync(
          await client.post('/api/room/data/rooms', ctx.request, ctx.metadata, {
            ...(args.details !== undefined ? { details: args.details ? 1 : 0 } : {}),
            ...(args.type !== undefined ? { type: args.type } : {}),
          }),
          'list room types',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_list_rate_plans`,
      description:
        "List the property's rate plans (pricing plans), verbatim: each carries `id_pricing_plans`, " +
        '`name`, `id_boards` (meal plan), `id_policies` and `id_restriction_plans` (use it with ' +
        'list_restrictions). Plan definitions only — not prices.',
      input: noArgs,
      handler: async (_args, ctx) =>
        unwrapHotelSync(
          await client.post('/api/pricingPlan/data/pricing_plans', ctx.request, ctx.metadata),
          'list rate plans',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_check_availability`,
      description:
        'How many units of each room type are free per night, for `dfrom`..`dto` (YYYY-MM-DD). Returns ' +
        'an object keyed by `id_room_types`, then by date, with the count free (verbatim). No prices. ' +
        "Check the plan's restrictions too (list_restrictions) before offering a stay.",
      input: z.object(dateRange).strict().refine(rangeOrdered, rangeMessage),
      handler: async (args, ctx) =>
        unwrapHotelSync(
          await client.post('/api/avail/data/avail', ctx.request, ctx.metadata, args),
          'check availability',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_list_restrictions`,
      description:
        "The property's own stay rules for a restriction plan over `dfrom`..`dto`: per room type and " +
        'date, `min_stay`, `max_stay`, `min_stay_arrival`, `closed`, `closed_arrival`, ' +
        '`closed_departure` (verbatim). A rate plan names its `id_restriction_plans` (list_rate_plans). ' +
        'A stay the rules close is one the property does not sell.',
      input: z
        .object({ id_restriction_plans: id, ...dateRange })
        .strict()
        .refine(rangeOrdered, rangeMessage),
      handler: async (args, ctx) =>
        unwrapHotelSync(
          await client.post('/api/restrictions/data/restrictions', ctx.request, ctx.metadata, args),
          'list restrictions',
        ),
    }),

    // ── Backend-only: money ──────────────────────────────────────────────────────────────────────
    tool({
      // controlPlane (the money guard): the consumer composes the quote; the agent never sees this.
      name: `mcp_${SLUG}_get_prices`,
      description:
        'BACKEND-ONLY. The price matrix of a rate plan over `dfrom`..`dto`: per `id_room_types`, per ' +
        'date, the nightly price (verbatim). Whether taxes are included is not yet observed.',
      controlPlane: true,
      input: z
        .object({ id_pricing_plans: id, ...dateRange })
        .strict()
        .refine(rangeOrdered, rangeMessage),
      handler: async (args, ctx) =>
        unwrapHotelSync(
          await client.post('/api/prices/data/prices', ctx.request, ctx.metadata, args),
          'get prices',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_quote_room_type`,
      description:
        'BACKEND-ONLY. HotelSync computes the price of one room type and rate plan for a stay ' +
        '(`dfrom` check-in, `dto` check-out) and a guest composition: per night and total (verbatim). ' +
        'The consumer composes the quote from it.',
      controlPlane: true,
      input: z
        .object({
          id_room_types: id,
          id_pricing_plans: id,
          ...dateRange,
          adults: z.number().int().positive(),
          children_1: count.optional(),
          children_2: count.optional(),
          children_3: count.optional(),
          seniors: count.optional(),
        })
        .strict()
        .refine((v) => v.dto > v.dfrom, {
          message: 'dto (check-out) must be after dfrom (check-in)',
          path: ['dto'],
        }),
      handler: async (args, ctx) =>
        unwrapHotelSync(
          await client.post(
            '/api/prices/data/reservation_room_type_prices',
            ctx.request,
            ctx.metadata,
            args,
          ),
          'quote room type',
        ),
    }),

    // ── Backend-only: reservations ───────────────────────────────────────────────────────────────
    tool({
      name: `mcp_${SLUG}_get_reservation`,
      description:
        'BACKEND-ONLY. One reservation of the connected property by `id_reservations`: status, dates, ' +
        'rooms, guests, prices, payments (verbatim). The consumer checks who is asking before it shows ' +
        'or changes it.',
      controlPlane: true,
      input: z.object({ id_reservations: id }).strict(),
      handler: async (args, ctx) =>
        unwrapHotelSync(
          await client.post('/api/reservation/data/reservation', ctx.request, ctx.metadata, args),
          'get reservation',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_search_reservations`,
      description:
        "BACKEND-ONLY. Search the property's reservations, 20 per page (verbatim): free text `search` " +
        '(name, email, phone, reference), a date range applied to `filter_by`, a `status`. Used to find ' +
        'a reservation for the person asking, and to reconcile what webhooks missed (`last_modified_*`).',
      controlPlane: true,
      input: z
        .object({
          search: z.string().trim().min(1).optional(),
          dfrom: isoDate.optional(),
          dto: isoDate.optional(),
          filter_by: z
            .enum(['date_received', 'date_arrival', 'date_departure', 'date_canceled'])
            .optional(),
          last_modified_from: isoDate.optional(),
          last_modified_to: isoDate.optional(),
          status: z.enum(['confirmed', 'modified', 'canceled']).optional(),
          show_rooms: z.boolean().optional(),
          page: z.number().int().positive().optional(),
        })
        .strict(),
      handler: async (args, ctx) => {
        const { show_rooms, ...rest } = args;
        return unwrapHotelSync(
          await client.post('/api/reservation/data/reservations', ctx.request, ctx.metadata, {
            ...rest,
            ...(show_rooms !== undefined ? { show_rooms: show_rooms ? 1 : 0 } : {}),
          }),
          'search reservations',
        );
      },
    }),
    tool({
      // BACKEND-ONLY WRITE (ADR 0013 + 0015): thin passthrough. The consumer composes the reservation —
      // prices from its quote, the guest, the channel — behind its own confirmation and idempotency.
      name: `mcp_${SLUG}_create_reservation`,
      description:
        'BACKEND-ONLY. Create one reservation at the connected property. Thin passthrough of ' +
        "HotelSync's reservation body: the dates, the rate plan, at least one room and one guest are " +
        'checked here; every other field (prices, `id_channels`, `pending_until`, notes, payments) goes ' +
        "through as given. Returns HotelSync's create response verbatim.",
      controlPlane: true,
      input: z
        .object({
          date_arrival: isoDate,
          date_departure: isoDate,
          id_pricing_plans: z.union([id, z.string().min(1)]),
          status: z.enum(['confirmed', 'pending', 'offer']).optional(),
          rooms: z
            .array(
              z.object({ id_room_types: id, adults: z.number().int().positive() }).passthrough(),
            )
            .min(1),
          guests: z
            .array(
              z
                .object({ first_name: z.string().min(1), last_name: z.string().min(1) })
                .passthrough(),
            )
            .min(1),
        })
        .passthrough()
        .refine((v) => v.date_departure > v.date_arrival, {
          message: 'date_departure must be after date_arrival',
          path: ['date_departure'],
        }),
      handler: async (args, ctx) =>
        unwrapHotelSync(
          await client.post('/api/reservation/insert/reservation', ctx.request, ctx.metadata, args),
          'create reservation',
          { write: true },
        ),
    }),
    tool({
      name: `mcp_${SLUG}_modify_reservation`,
      description:
        'BACKEND-ONLY. Save changes to a reservation (dates, status, notes, prices): `reservation` is the ' +
        'record as get_reservation returned it, with the changes applied. Thin passthrough; returns ' +
        "HotelSync's response verbatim.",
      controlPlane: true,
      input: z
        .object({
          reservation: z
            .object({ id_reservations: z.union([id, z.string().min(1)]) })
            .passthrough(),
        })
        .strict(),
      handler: async (args, ctx) =>
        unwrapHotelSync(
          await client.post('/api/reservation/edit/basics_new', ctx.request, ctx.metadata, args),
          'modify reservation',
          { write: true },
        ),
    }),
    tool({
      name: `mcp_${SLUG}_cancel_reservation`,
      description:
        'BACKEND-ONLY. Cancel a reservation of the connected property, with a `reason`. HotelSync ' +
        'documents this endpoint as "cancel or permanently delete"; which one it does is not yet ' +
        "observed. Returns HotelSync's response verbatim.",
      controlPlane: true,
      input: z.object({ id_reservations: id, reason: z.string().trim().min(1) }).strict(),
      handler: async (args, ctx) =>
        unwrapHotelSync(
          await client.post('/api/reservation/delete/delete', ctx.request, ctx.metadata, args),
          'cancel reservation',
          { write: true },
        ),
    }),

    // ── Backend-only: webhooks (the consumer registers at connect, removes at disconnect) ────────
    tool({
      name: `mcp_${SLUG}_register_webhook`,
      description:
        'BACKEND-ONLY. Register an https URL HotelSync POSTs change events to (reservations, invoices). ' +
        'Active at once; at most 20 per property; requests are NOT signed, so the URL must carry its own ' +
        'secret and the receiver must re-read what an event names. Returns `{ id_webhooks }`.',
      controlPlane: true,
      input: z
        .object({
          url: z
            .string()
            .url()
            .refine((u) => u.startsWith('https://'), 'The webhook URL must be https'),
        })
        .strict(),
      handler: async (args, ctx) =>
        unwrapHotelSync(
          await client.post('/api/webhooks/insert/webhook', ctx.request, ctx.metadata, args),
          'register webhook',
          { write: true },
        ),
    }),
    tool({
      name: `mcp_${SLUG}_list_webhooks`,
      description:
        "BACKEND-ONLY. The property's active webhooks, verbatim: `id_webhooks`, `url`, `date_created`.",
      controlPlane: true,
      input: noArgs,
      handler: async (_args, ctx) =>
        unwrapHotelSync(
          await client.post('/api/webhooks/data/webhooks', ctx.request, ctx.metadata),
          'list webhooks',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_delete_webhook`,
      description:
        'BACKEND-ONLY. Unregister a webhook by `id_webhooks`; HotelSync stops posting to it.',
      controlPlane: true,
      input: z.object({ id_webhooks: id }).strict(),
      handler: async (args, ctx) =>
        unwrapHotelSync(
          await client.post('/api/webhooks/delete/webhook', ctx.request, ctx.metadata, args),
          'delete webhook',
          { write: true },
        ),
    }),
  ];
}
