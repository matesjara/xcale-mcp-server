import { z } from 'zod';

import { toolFactory, type ToolDefinition } from '../../core/tool';
import { seg, type LobbypmsClient } from './client';
import type { LobbypmsContext } from './context';
import { unwrapLobby } from './errors';
import { SLUG } from './manifest';

const tool = toolFactory<LobbypmsContext>();

/**
 * LobbyPMS takes dates as ISO calendar dates, `YYYY-MM-DD`. The shape check is not enough: a
 * syntactically valid but non-existent date (`2026-02-30`) would reach a booking write, which has no
 * modify. The refine confirms the date round-trips — a real calendar day.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD)')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real calendar date');

/** A LobbyPMS numeric id (category, booking, block, channel…). */
const id = z.number().int().positive();
/** A result page, 1-based. */
const page = z.number().int().positive().optional();
/** Records per page — LobbyPMS caps it at 50. */
const paginate = z.number().int().min(1).max(50).optional();

/** A stay window: check-out after check-in. */
function stayWindow<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ start_date: isoDate, end_date: isoDate })
    .extend(shape)
    .strict()
    .refine((a) => String(a.end_date) > String(a.start_date), {
      message: 'end_date must be after start_date',
      path: ['end_date'],
    });
}

/**
 * The curated LobbyPMS menu. Payloads are VERBATIM (Fidelity over Unification). The property is the
 * token's — no tool takes a property argument.
 *
 * The agent's menu: `list_room_types`, `check_availability`, `get_availability_rates` — prices
 * included (Mateo, 2026-10-17, #147: a hotel's agent may read its PMS's prices; filtering what the
 * credential allows is not this server's decision). Guest data and writes are `controlPlane`
 * (ADR 0013): routable by the consumer, withdrawn from `tools/list`.
 *
 * Not exposed (curated out): rooms/status, occupancy and daily-occupancy (front-office statistics),
 * products and add-product-service (upsells — no consumer flow yet). LobbyPMS has NO endpoint to
 * modify a booking, list bookings or list guests (LobbyPMS, 2026-10-13/14).
 */
export function buildLobbypmsTools(
  client: LobbypmsClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, LobbypmsContext>> {
  return [
    tool({
      name: `mcp_${SLUG}_list_room_types`,
      description:
        "List the connected LobbyPMS property's room types (categories), verbatim. Each carries " +
        '`category_id`, `name`, `type`, `capacity` (max guests), `quantity` (rooms of that type), ' +
        '`descriptions` (per language), `photos` (URLs) and its `rooms`. Paginated (`meta`). Use ' +
        '`category_id` to read availability for one type and `capacity` to match a party.',
      input: z.object({ page }).strict(),
      handler: async (args, ctx) =>
        unwrapLobby(
          await client.get('v1/rooms', ctx.request, { page: args.page }),
          'list room types',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_check_availability`,
      description:
        'Check which room types are free at the connected LobbyPMS property, night by night, and at ' +
        'what price, for a stay window (`start_date`, `end_date`, YYYY-MM-DD; optional ' +
        '`category_id`). Returns `data[]` — one entry per date with `categories[]`: `{ category_id, ' +
        'name, available_rooms, plans: [{ id, name, prices: [{ people, value }] }], restrictions: ' +
        '{ min_stay, max_stay, lead_days } }`. `plans` are the rate plans on sale that night; the ' +
        'standard rate is `{ id: null, name: "STANDARD_RATE" }`. `value` is the price per night for ' +
        "that number of people, in the property's currency; the payload does not say whether it " +
        'includes taxes. Paginated (`meta`, `page`, `paginate` up to 50).',
      input: stayWindow({ category_id: id.optional(), page, paginate }),
      handler: async (args, ctx) =>
        unwrapLobby(
          await client.get('v2/available-rooms', ctx.request, args),
          'check availability',
        ),
    }),
    tool({
      // The same read as `check_availability`, under the name consumers already route to.
      name: `mcp_${SLUG}_get_availability_rates`,
      description:
        'Availability, prices and restrictions per night and room type for a stay window, verbatim ' +
        'from `GET v2/available-rooms` — the same payload as `check_availability`: `data[]` per date ' +
        '→ `categories[]` with `available_rooms`, `plans[]` (`{ id, name, prices: [{ people, value ' +
        '}] }`; the standard rate is the plan named `STANDARD_RATE`, `id: null`) and `restrictions`. ' +
        'Paginated.',
      input: stayWindow({ category_id: id.optional(), page, paginate }),
      handler: async (args, ctx) =>
        unwrapLobby(
          await client.get('v2/available-rooms', ctx.request, args),
          'get availability rates',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_list_rate_plans`,
      description:
        "BACKEND-ONLY. The property's rate plans, verbatim: `{ id, plan, adjustment: { type, value }, " +
        'min_stay, check_in_date_restriction }`. Adjustment types: 1 = +%, 2 = +fixed, 3 = −%, ' +
        '4 = −fixed, relative to the standard rate.',
      controlPlane: true,
      input: z.object({ page, paginate }).strict(),
      handler: async (args, ctx) =>
        unwrapLobby(await client.get('v1/rate-plans', ctx.request, args), 'list rate plans'),
    }),
    tool({
      name: `mcp_${SLUG}_list_channels`,
      description:
        "BACKEND-ONLY. The property's sales channels, verbatim: `{ channels: [{ channel_id, name }] }`. " +
        'A booking may name its `channel`.',
      controlPlane: true,
      input: z.object({}).strict(),
      handler: async (_args, ctx) =>
        unwrapLobby(await client.get('v1/channels', ctx.request), 'list channels'),
    }),
    tool({
      name: `mcp_${SLUG}_list_document_types`,
      description:
        'BACKEND-ONLY. The identity document types the property accepts, verbatim: `[{ id, name }]` ' +
        '(e.g. Cédula de ciudadanía, Pasaporte). A customer may name its `document_id`.',
      controlPlane: true,
      input: z.object({}).strict(),
      handler: async (_args, ctx) =>
        unwrapLobby(await client.get('v1/documents', ctx.request), 'list document types'),
    }),
    tool({
      name: `mcp_${SLUG}_create_customer`,
      description:
        'BACKEND-ONLY write. Register a customer (guest) at the property: `type` 1 = person, ' +
        '2 = company. Requires `customer_document`, `customer_nationality` (ISO 3166-1 country code) ' +
        'and `name`; `surname` is required for a person. Returns `{ status: "success" }` — no id.',
      controlPlane: true,
      input: z
        .object({
          type: z.union([z.literal(1), z.literal(2)]),
          customer_document: z.string().trim().min(1),
          customer_nationality: z.string().trim().min(2).max(3),
          name: z.string().trim().min(1),
          surname: z.string().trim().min(1).optional(),
          second_surname: z.string().trim().min(1).optional(),
          document_id: id.optional(),
          birthdate: isoDate.optional(),
          gender: z.enum(['male', 'female']).optional(),
          phone: z.string().trim().min(1).optional(),
          email: z.string().trim().min(1).optional(),
          activities: z.string().trim().min(1).optional(),
          address: z.string().trim().min(1).optional(),
          note: z.string().optional(),
        })
        .strict()
        .refine((a) => a.type === 2 || a.surname !== undefined, {
          message: 'surname is required for a person',
          path: ['surname'],
        }),
      handler: async ({ type, ...body }, ctx) =>
        unwrapLobby(
          await client.post(`v1/customer/${seg(type)}`, ctx.request, body),
          'create customer',
        ),
    }),
    tool({
      // Irreversible but cancellable: LobbyPMS has no modify. One call = one booking request; the
      // consumer owns idempotency (ADR 0015) — this server never retries a write.
      name: `mcp_${SLUG}_create_booking`,
      description:
        'BACKEND-ONLY write. Create a booking for one room type and stay. Requires `category_id`, ' +
        '`start_date`, `end_date`, `total_adults`; the holder is `holder_name` (new guest) or ' +
        '`customer_document` + `customer_nationality` (a registered customer). Optional ' +
        '`total_children`, `rates_per_day` ([{ date, price }]), `note`, `payment` (≤ the total), ' +
        "`channel`. Returns LobbyPMS's answer verbatim — observed `{ booking: { booking_id, room_id } }` " +
        '(the docs say `data: [{ idBooking, idRoom }]`). A booking created with `holder_name` keeps ' +
        "the holder's email and phone empty: put the guest's contact in `note`.",
      controlPlane: true,
      input: stayWindow({
        category_id: id,
        total_adults: z.number().int().min(1),
        total_children: z.number().int().min(0).optional(),
        holder_name: z.string().trim().min(1).optional(),
        customer_document: z.string().trim().min(1).optional(),
        customer_nationality: z.string().trim().min(2).max(3).optional(),
        rates_per_day: z
          .array(z.object({ date: isoDate, price: z.number().min(0) }).strict())
          .min(1)
          .optional(),
        note: z.string().optional(),
        payment: z.number().min(0).optional(),
        channel: id.optional(),
      })
        .refine((a) => a.holder_name !== undefined || a.customer_document !== undefined, {
          message: 'name the holder: holder_name, or customer_document + customer_nationality',
          path: ['holder_name'],
        })
        .refine((a) => a.customer_document === undefined || a.customer_nationality !== undefined, {
          message: 'customer_nationality is required with customer_document',
          path: ['customer_nationality'],
        }),
      handler: async (args, ctx) =>
        unwrapLobby(await client.post('v1/bookings', ctx.request, args), 'create booking'),
    }),
    tool({
      name: `mcp_${SLUG}_get_booking`,
      description:
        "BACKEND-ONLY. One booking's detail by its numeric id, verbatim (Spanish field names): " +
        '`id_reserva`, `estatus`, `fecha_ingreso`/`fecha_salida`, `checkin_realizado`, ' +
        '`checkout_realizado`, `numero_personas`, `tarifas_por_dia`, `impuesto_alojamiento`, ' +
        '`categoria`, `cuarto`, `cliente`, `huespedes`, `grupo` (sibling booking ids), `deleted_at`, ' +
        '`nota`. A cancelled booking is no longer readable: RECORD_NOT_FOUND (observed).',
      controlPlane: true,
      input: z.object({ booking_id: id }).strict(),
      handler: async (args, ctx) =>
        unwrapLobby(
          await client.get(`v1/bookings/${seg(args.booking_id)}`, ctx.request),
          'get booking',
          { byId: true },
        ),
    }),
    tool({
      name: `mcp_${SLUG}_cancel_booking`,
      description:
        'BACKEND-ONLY write. Cancel a booking. `cancellation_reason`: NS no show, RC room change, RE ' +
        'registration error, TTC timely customer cancellation, CC customer unreachable, OTH other; ' +
        'optional `description`. LobbyPMS refuses (error code in the message) a booking not created ' +
        'through the API (UNAUTHORIZED_BOOKING), already checked in (BOOKING_CHECK_IN_COMPLETE), ' +
        'with payments or extra charges (RESTRICTED_RESERVATION) or unknown (RECORD_NOT_FOUND).',
      controlPlane: true,
      input: z
        .object({
          booking_id: id,
          cancellation_reason: z.string().regex(/^[A-Z]{2,4}$/, 'A LobbyPMS reason code, e.g. TTC'),
          description: z.string().optional(),
        })
        .strict(),
      handler: async ({ booking_id, ...body }, ctx) =>
        unwrapLobby(
          await client.post(`v1/cancel-booking/${seg(booking_id)}`, ctx.request, body),
          'cancel booking',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_create_block`,
      description:
        'BACKEND-ONLY write. Hold rooms of one type for a stay window: `category_id`, `start_date`, ' +
        '`end_date`, optional `number_rooms` (default 1), `time` (minutes held, default 60), `note`. ' +
        'Returns `{ blocked_ids, rooms: [{ room_id, block_id }] }`, verbatim.',
      controlPlane: true,
      input: stayWindow({
        category_id: id,
        number_rooms: z.number().int().min(1).optional(),
        time: z.number().int().min(1).optional(),
        note: z.string().optional(),
      }),
      handler: async (args, ctx) =>
        unwrapLobby(await client.post('v1/block', ctx.request, args), 'create block'),
    }),
    tool({
      name: `mcp_${SLUG}_delete_block`,
      description: 'BACKEND-ONLY write. Release a hold created by create_block, by its `block_id`.',
      controlPlane: true,
      input: z.object({ block_id: id }).strict(),
      handler: async (args, ctx) =>
        unwrapLobby(
          await client.delete(`v1/block/${seg(args.block_id)}`, ctx.request),
          'delete block',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_create_payment_link`,
      description:
        "BACKEND-ONLY write. Create a payment link for a booking in the property's own payment " +
        'system: `booking_id`, `amount` (≥ 6, ≤ the outstanding balance), optional `expire_in` ' +
        '(YYYY-MM-DD, property time; default 24 h). Returns `{ id, booking_id, amount, currency, ' +
        'status, expire_in, url, ttl_hours }`. One OPEN link per booking.',
      controlPlane: true,
      input: z
        .object({ booking_id: id, amount: z.number().min(6), expire_in: isoDate.optional() })
        .strict(),
      handler: async (args, ctx) =>
        unwrapLobby(await client.post('v1/payment/link', ctx.request, args), 'create payment link'),
    }),
    tool({
      name: `mcp_${SLUG}_list_payment_links`,
      description:
        "BACKEND-ONLY. A booking's payment links (`booking_id`) or one link (`id`), optionally by " +
        '`status` (OPEN, DELETED, EXPIRED, APROVED, REJECTED — spelled as LobbyPMS spells them).',
      controlPlane: true,
      input: z
        .object({
          booking_id: id.optional(),
          id: z.string().trim().min(1).optional(),
          status: z.string().trim().min(1).optional(),
        })
        .strict()
        .refine((a) => a.booking_id !== undefined || a.id !== undefined, {
          message: 'name a booking_id or a link id',
          path: ['booking_id'],
        }),
      handler: async (args, ctx) =>
        unwrapLobby(await client.get('v1/payment/link', ctx.request, args), 'list payment links'),
    }),
  ];
}
