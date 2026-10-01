import { z } from 'zod';

import { toolFactory, type ToolDefinition } from '../../core/tool';
import type { ErbonClient } from './client';
import type { ErbonContext } from './context';
import { unwrapErbon } from './errors';
import { SLUG } from './manifest';

const tool = toolFactory<ErbonContext>();

/** No-argument input — the reference reads that take no filter (hotelID rides the call context). */
const noArgs = z.object({}).strict();

/**
 * Erbon takes stay dates as ISO calendar dates, `YYYY-MM-DD`. The shape check is not enough — a
 * syntactically valid but non-existent date (`2026-02-30`, `2026-13-45`) would otherwise be forwarded
 * to Erbon, and on the irreversible `create_booking` that is a booking on the wrong (or no) date with
 * no API undo. The refine confirms the date round-trips, i.e. it is a real calendar day.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD)')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real calendar date');

/**
 * The curated Erbon menu — money-free reads only. `hotelID` comes from the call context, never a tool
 * arg. Data is returned VERBATIM (Fidelity over Unification); no canonical DTO. Erbon filter params
 * travel in HEADERS, not the query string.
 *
 * The money read (`get_rate_prices`) is added in S3 as a `controlPlane` tool — routable by the backend
 * but withdrawn from this menu, so the agent can never narrate a raw, pre-tax price (AD-2). See
 * `docs/design/erbon-read-only-provider/implementation-plan.md`.
 */
export function buildErbonTools(
  client: ErbonClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, ErbonContext>> {
  return [
    tool({
      name: `mcp_${SLUG}_check_availability`,
      description:
        'Check room availability at the connected Erbon hotel for a stay window. Takes `checkinDate` ' +
        'and `checkoutDate` (YYYY-MM-DD). Returns a flat array (verbatim) of rows — each `{ date, ' +
        'roomTypeDescription, statusAvailability }` — where `statusAvailability` is the count of that ' +
        'room type free on that date. Does NOT return prices; use it to see what is available, then ' +
        'quote through the booking flow. The hotel is the connected one (no hotel id argument).',
      input: z.object({ checkinDate: isoDate, checkoutDate: isoDate }).strict(),
      handler: async (args, ctx) =>
        unwrapErbon(
          await client.get('availability', ctx.request, ctx.metadata, {
            checkinDate: args.checkinDate,
            checkoutDate: args.checkoutDate,
          }),
          'check availability',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_list_room_types`,
      description:
        'List the room types at the connected Erbon hotel. Returns a flat array (verbatim); each ' +
        'carries `id`, `code`, `description`, `minPax`, `maxPax`, `roomCount`. Use `description` to ' +
        'join with check_availability rows, and min/max pax to match a party size.',
      input: noArgs,
      handler: async (_args, ctx) =>
        unwrapErbon(
          await client.get('mapping/roomtype', ctx.request, ctx.metadata),
          'list room types',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_list_rates`,
      description:
        'List the rate plans at the connected Erbon hotel. Returns a flat array (verbatim); each ' +
        'carries `id`, `code`, `description` and meal-plan flags `allowRO`/`allowBB`/`allowHB`/' +
        '`allowFB`/`allowAI` (Room Only / Bed & Breakfast / Half / Full board / All Inclusive). Rate ' +
        'definitions only — not prices.',
      input: noArgs,
      handler: async (_args, ctx) =>
        unwrapErbon(await client.get('mapping/rates', ctx.request, ctx.metadata), 'list rates'),
    }),
    tool({
      name: `mcp_${SLUG}_get_hotel`,
      description:
        'Get the connected Erbon hotel profile (name, contact, currency), verbatim. Use it for the ' +
        'hotel name and contact details when handing a guest off to the hotel to complete a booking.',
      input: noArgs,
      handler: async (_args, ctx) =>
        unwrapErbon(await client.get('', ctx.request, ctx.metadata), 'get hotel'),
    }),
    tool({
      // BACKEND-ONLY (AD-2, the money guard): `controlPlane: true` keeps this OUT of `listTools()` — the
      // agent's menu — while it stays in `routableToolNames()`, callable by the backend. It is the only
      // Erbon read that returns money; the backend `erbon-stay-truth` adapter consumes it to compose a
      // tax-correct StayQuote. Off the menu, the agent can never narrate a raw, pre-tax price.
      name: `mcp_${SLUG}_get_rate_prices`,
      description:
        'BACKEND-ONLY (withdrawn from the agent menu). Rate prices for one rate + room type over a date ' +
        'range at the connected Erbon hotel. Consumed by the backend to compose a tax-correct quote — ' +
        'the agent never narrates a raw price. Returns a flat array (verbatim); params travel in headers.',
      controlPlane: true,
      input: z
        .object({
          dateFrom: isoDate,
          dateTo: isoDate,
          idRate: z.number().int().positive(),
          idRoomType: z.number().int().positive(),
        })
        .strict(),
      handler: async (args, ctx) =>
        unwrapErbon(
          await client.get('mapping/rateprices', ctx.request, ctx.metadata, {
            dateFrom: args.dateFrom,
            dateTo: args.dateTo,
            idRate: String(args.idRate),
            idRoomType: String(args.idRoomType),
          }),
          'get rate prices',
        ),
    }),
    tool({
      // BACKEND-ONLY WRITE (controlPlane, ADR 0013 + 0015): thin passthrough. Erbon has NO cancel/modify
      // — a created booking cannot be undone via API — so it is withdrawn from the agent menu; the
      // backend creates it behind its own availability-guard + voucher-idempotency + human-gated confirm.
      name: `mcp_${SLUG}_create_booking`,
      description:
        'BACKEND-ONLY. Create ONE reservation at the connected Erbon hotel (one room per call). Thin ' +
        'passthrough — the backend owns the availability check, idempotency (voucher) and confirmation; ' +
        'Erbon cannot cancel/modify via API. Returns Erbon’s create response verbatim.',
      controlPlane: true,
      input: z
        .object({
          checkInDate: isoDate,
          checkOutDate: isoDate,
          idRoomTypeReserved: z.number().int().positive(),
          idRoomTypeOccupied: z.number().int().positive(),
          idRate: z.number().int().positive(),
          idConfigPension: z.enum(['RO', 'BB', 'HB', 'FB', 'AI']),
          numberAdults: z.number().int().positive(),
          ratePrices: z
            .array(z.object({ date: isoDate, price: z.number().nonnegative() }).strict())
            .min(1),
          guests: z
            .array(
              z.object({ idGuest: z.number().int().positive(), isHolder: z.boolean() }).strict(),
            )
            .min(1),
          // optional passthrough — the backend fills or omits these (voucher = idempotency, ADR 0015)
          voucher: z.string().optional(),
          idBookingStatus: z.string().optional(),
          numberChildren: z.number().int().nonnegative().optional(),
          numberChildren2: z.number().int().nonnegative().optional(),
          numberBabies: z.number().int().nonnegative().optional(),
          isDirect: z.boolean().optional(),
          isCompany: z.boolean().optional(),
          idCompany: z.number().int().optional(),
          idAgency: z.number().int().optional(),
          idSource: z.number().int().optional(),
          idSegment: z.number().int().optional(),
          isRateDefault: z.boolean().optional(),
          commentsBooking: z.string().optional(),
        })
        .strict()
        // Irreversible write (no Erbon cancel/modify): reject a reversed or zero-night range here
        // rather than let Erbon create an un-undoable booking. ISO YYYY-MM-DD compares as dates.
        .refine((v) => v.checkOutDate > v.checkInDate, {
          message: 'checkOutDate must be after checkInDate',
          path: ['checkOutDate'],
        }),
      handler: async (args, ctx) =>
        unwrapErbon(
          await client.post('booking/new', ctx.request, ctx.metadata, args),
          'create booking',
        ),
    }),
    tool({
      name: `mcp_${SLUG}_search_guest`,
      description:
        'BACKEND-ONLY. Find a guest at the connected Erbon hotel by `guestID`, or by `documentType` + ' +
        '`documentNumber`. Resolves an existing guest before a booking (idGuest is required). Verbatim.',
      controlPlane: true,
      input: z
        .object({
          guestID: z.number().int().positive().optional(),
          documentType: z.string().min(1).optional(),
          documentNumber: z.string().min(1).optional(),
        })
        .strict()
        .refine(
          (v) =>
            v.guestID !== undefined ||
            (v.documentType !== undefined && v.documentNumber !== undefined),
          'Provide guestID, or both documentType and documentNumber',
        ),
      handler: async (args, ctx) => {
        const headers: Record<string, string> = {};
        if (args.guestID !== undefined) headers.guestID = String(args.guestID);
        if (args.documentType !== undefined) headers.documenttype = args.documentType;
        if (args.documentNumber !== undefined) headers.documentnumber = args.documentNumber;
        return unwrapErbon(
          await client.get('guest/search', ctx.request, ctx.metadata, headers),
          'search guest',
        );
      },
    }),
    tool({
      name: `mcp_${SLUG}_create_guest`,
      description:
        'BACKEND-ONLY. Create (or update, when `id` is present) a guest at the connected Erbon hotel — ' +
        'the prerequisite for a booking. A correctable write (editable via Erbon). Returns it verbatim.',
      controlPlane: true,
      // Bounded allow-list of Erbon's documented `guest/new` fields (swagger AE23) + `.strict()` — same
      // tightness as create_booking, so a stray/misnamed field is rejected here instead of silently
      // reaching Erbon. Extend this list when Erbon documents a new guest field.
      input: z
        .object({
          name: z.string().min(1),
          id: z.number().int().positive().optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
          birthDate: isoDate.optional(),
          genderID: z.number().int().optional(),
          nationality: z.string().optional(),
          professionID: z.number().int().optional(),
          profession: z.string().optional(),
          vehicleRegistration: z.string().optional(),
          isClient: z.boolean().optional(),
          isProvider: z.boolean().optional(),
          address: z.unknown().optional(),
          documents: z.array(z.record(z.unknown())).optional(),
        })
        .strict(),
      handler: async (args, ctx) =>
        unwrapErbon(
          await client.post('guest/new', ctx.request, ctx.metadata, args),
          'create guest',
        ),
    }),
    tool({
      // BACKEND-ONLY read: the backend looks a reservation up by id and reconciles a create whose
      // response was lost. Withdrawn from the agent menu (a booking read is not the agent's to make).
      name: `mcp_${SLUG}_get_booking`,
      description:
        'BACKEND-ONLY. Get one booking at the connected Erbon hotel by its internal ID. Returns the ' +
        'booking verbatim. Used by the backend for reservation lookup and reconcile.',
      controlPlane: true,
      input: z.object({ bookingInternalID: z.union([z.string().min(1), z.number()]) }).strict(),
      handler: async (args, ctx) =>
        unwrapErbon(
          await client.get(
            `booking/${encodeURIComponent(String(args.bookingInternalID))}`,
            ctx.request,
            ctx.metadata,
          ),
          'get booking',
        ),
    }),
    tool({
      // BACKEND-ONLY read: Erbon has NO server-side voucher filter, so reconcile lists a window
      // (check-in/out or created-at) and matches the stamped `voucher` CLIENT-SIDE (anti-duplicate,
      // since Erbon has no cancel). Filters travel in HEADERS. Withdrawn from the agent menu.
      name: `mcp_${SLUG}_search_booking`,
      description:
        'BACKEND-ONLY. Search bookings at the connected Erbon hotel by a window (checkin/checkout or ' +
        'bookingCreatedAtStart/End), by `bookingNumber`, or by `onlineSaleChannelNumber` (the ' +
        'caller-stamped voucher — the reconcile filter, Observed to match server-side). Returns a flat ' +
        'array verbatim; the backend still confirms the voucher client-side.',
      controlPlane: true,
      input: z
        .object({
          checkin: isoDate.optional(),
          checkout: isoDate.optional(),
          bookingCreatedAtStart: isoDate.optional(),
          bookingCreatedAtEnd: isoDate.optional(),
          status: z.string().optional(),
          bookingNumber: z.string().optional(),
          // The caller-stamped voucher, round-tripped on reads; filters bookings server-side (Observed).
          onlineSaleChannelNumber: z.string().optional(),
          mainguestEmail: z.string().optional(),
          mainguestTel: z.string().optional(),
        })
        .strict(),
      handler: async (args, ctx) => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(args)) {
          if (v !== undefined) headers[k] = String(v);
        }
        return unwrapErbon(
          await client.post('booking/search', ctx.request, ctx.metadata, {}, headers),
          'search booking',
        );
      },
    }),
  ];
}
