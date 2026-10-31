import { z } from 'zod';

import { ok, toolFactory, type ToolDefinition } from '../../core/tool';
import type { ToolIdentityPolicy } from '../../core/types';
import type { AviratoClient } from './client';
import type { AviratoContext } from './context';
import { aviratoErrorCode, NOT_FOUND_CODE, unwrapAvirato } from './errors';
import { SLUG } from './manifest';

const tool = toolFactory<AviratoContext>();

/** No-argument input — the catalog reads that take no filter (`web_code` rides the call context). */
const noArgs = z.object({}).strict();

/**
 * An ISO calendar date, `YYYY-MM-DD`. The shape is not enough: a syntactically valid but non-existent
 * day (`2027-02-30`) would otherwise reach Avirato, so the refine confirms the date round-trips.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD)')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real calendar date');

/** A positive integer id (Avirato's `space_subtype_id`, `rate_id`, `reservation_id`). */
const id = z.number().int().positive();

/** An ISO 8601 datetime with an offset or `Z` (`2027-02-16T17:00:00.000Z`), as Avirato's create takes. */
const isoDateTime = z.iso.datetime({ offset: true });

/**
 * One room of a reservation to create — the observed create body (contract §A.9) minus what the
 * provider fills. `status` accepts only the value observed on create (`RESERVATION`); which status a
 * hotel books in is its choice, so another value joins additively once it is observed (design AD-6).
 */
const reservationRoom = z
  .object({
    space_subtype_id: id,
    quantity: z.number().int().min(1),
    adults: z.number().int().min(1),
    children: z.number().int().min(0),
    check_in: isoDateTime,
    check_out: isoDateTime,
    regime: z.string().trim().min(1).max(16),
    rate_id: id,
    status: z.literal('RESERVATION'),
    client: z
      .object({
        client_doc: z.string().trim().min(1).max(64),
        name: z.string().trim().min(1).max(100),
        surname: z.string().trim().min(1).max(100),
        email: z.email().optional(),
        phone: z.string().trim().min(1).max(32).optional(),
        // Observed 2026-10-31: the sandbox refuses a reservation whose client has no `state` and
        // `country` — a bare `ERROR_ON_INSERT` — while production accepted one without them on
        // 2026-10-30. Optional here, so Avirato stays the judge; a consumer should send them.
        state: z.string().trim().min(1).max(100).optional(),
        country: z
          .string()
          .regex(/^[A-Z]{3}$/, 'ISO 3166-1 alpha-3, upper case (e.g. COL)')
          .optional(),
        city: z.string().trim().min(1).max(100).optional(),
        address: z.string().trim().min(1).max(200).optional(),
        zip_code: z.string().trim().min(1).max(16).optional(),
      })
      .strict(),
    payment: z
      .object({
        payment_type: z.enum(['CASH', 'CARD', 'TRANSFER', 'CREDIT', 'OTHER']),
        is_paid: z.boolean(),
      })
      .strict(),
    observations: z.string().max(500).optional(),
    additional_beds: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((r) => Date.parse(r.check_out) > Date.parse(r.check_in), {
    message: '`check_out` must be after `check_in`',
    path: ['check_out'],
  });

/** The id space of Avirato reservation ids, so they never compare with another provider's or kind's. */
const RESERVATION_KIND = `${SLUG}:reservation`;

/**
 * A tool that names one reservation by id and acts with the hotel's token: bound to the reservation's
 * owner. No person field is in the input, so the consumer authorizes it by ownership of the record.
 */
const reservationOwner: ToolIdentityPolicy = {
  mode: 'subject-bound',
  identityFields: [],
  recordOwnershipField: 'reservation_id',
  recordOwnershipKind: RESERVATION_KIND,
};

/**
 * A quote's rows without exact duplicates, in Avirato's order. Avirato was observed returning every
 * rate's row twice, identical (2026-10-30); a duplicate carries no information and would double-count a
 * rate for any consumer that lists them.
 */
function withoutExactDuplicates(rows: unknown): unknown[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = JSON.stringify(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The catalog reads that take no argument: tool verb, Avirato path, what the description says. */
const CATALOG_LISTS = [
  {
    verb: 'list_room_types',
    path: 'space',
    description:
      'List the connected hotel’s room types: each space type with its subtypes — the subtype is what ' +
      'a guest books (`space_subtype_id`) — their name, capacity (maximum, adults, standard), check-in ' +
      'and check-out times, and the individual rooms (`spaces`). Returned verbatim.',
  },
  {
    verb: 'list_rates',
    path: 'rate',
    description:
      'List the hotel’s rates (`rate_id`, `rate_name`, minimum and maximum stay, refundable or not). ' +
      'The list can include channel rates (e.g. "Booking", "AIRBNB"); which rate is offered to a guest ' +
      'is the hotel’s choice. Returned verbatim.',
  },
  {
    verb: 'list_regimes',
    path: 'regime',
    description:
      'List the hotel’s board regimes (`regime_id`, `name`, `active`). The `name` (e.g. "BB", bed and ' +
      'breakfast) is the code a reservation carries. Returned verbatim.',
  },
  {
    verb: 'list_extras',
    path: 'extra',
    description:
      'List the extras the hotel sells with a stay: cost, VAT, stock, the room subtypes and rates each ' +
      'applies to, and its name and description per language. Returned verbatim.',
  },
] as const;

/**
 * The Avirato tools. `web_code` comes from the call context, never a tool argument, and data is returned
 * VERBATIM (Fidelity over Unification). The full set, and which of them are control plane, is the
 * contract's §C (`docs/design/avirato-provider/api-contract.md`).
 */
export function buildAviratoTools(
  client: AviratoClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, AviratoContext>> {
  return [
    tool({
      name: `mcp_${SLUG}_get_establishment`,
      readOnly: true,
      description:
        'Read the connected Avirato hotel: name, address, contact, currency, default VAT, and its ' +
        'online-booking texts (legal, information, refundable and non-refundable terms) per language. ' +
        'Use it to answer questions about the hotel itself and its booking conditions.',
      input: noArgs,
      handler: async (_args, ctx) =>
        unwrapAvirato(
          await client.get('establishment', ctx.request, ctx.metadata),
          'get_establishment',
        ),
    }),

    ...CATALOG_LISTS.map(({ verb, path, description }) =>
      tool({
        name: `mcp_${SLUG}_${verb}`,
        readOnly: true,
        description,
        input: noArgs,
        handler: async (_args, ctx) =>
          unwrapAvirato(await client.get(path, ctx.request, ctx.metadata), verb),
      }),
    ),

    tool({
      name: `mcp_${SLUG}_check_availability`,
      readOnly: true,
      description:
        'Check room availability at the connected hotel, night by night, for `start_date` to ' +
        '`end_date` (YYYY-MM-DD, both inclusive), optionally for one room subtype. Returns ' +
        '`{ space_subtypes: [{ space_subtype_id, days: [{ day, available_rooms, is_available }] }] }`, ' +
        'verbatim. It does not return prices.',
      input: z
        .object({ start_date: isoDate, end_date: isoDate, space_subtype_id: id.optional() })
        .strict()
        .refine((a) => a.end_date >= a.start_date, {
          message: '`end_date` must not be before `start_date`',
          path: ['end_date'],
        }),
      handler: async (args, ctx) =>
        unwrapAvirato(
          await client.get('availability', ctx.request, ctx.metadata, {
            start_date: args.start_date,
            end_date: args.end_date,
            space_subtype_id: args.space_subtype_id,
          }),
          'check_availability',
        ),
    }),

    tool({
      name: `mcp_${SLUG}_validate_promotional_code`,
      readOnly: true,
      description:
        'Check whether a promotional code exists at the connected hotel before it is promised to a ' +
        'guest. Returns `{ valid: false }` when the hotel has no such code, or `{ valid: true, code }` ' +
        'with Avirato’s record of it.',
      input: z.object({ code: z.string().trim().min(1).max(64) }).strict(),
      handler: async (args, ctx) => {
        const outcome = unwrapAvirato(
          await client.get(
            `promotional_codes/${encodeURIComponent(args.code)}`,
            ctx.request,
            ctx.metadata,
          ),
          'validate_promotional_code',
        );
        if (!outcome.ok) return outcome;
        // Observed: an unknown code is `200 { data: "" }`, not an error.
        return outcome.data === '' || outcome.data == null
          ? ok({ valid: false })
          : ok({ valid: true, code: outcome.data });
      },
    }),

    // ── Reservation reads ──────────────────────────────────────────────────────────────────────────
    //
    // Each reaches one guest's stay with the hotel's token, so each declares whose record it is: by
    // reservation id, bound to the reservation's owner (a guest sees the stay they booked, a guessed id
    // is refused); by document, bound to the person that document names, with each row's id marking
    // its owner. The consumer enforces; this server declares (ADR 0019).

    tool({
      name: `mcp_${SLUG}_get_reservation`,
      readOnly: true,
      identityPolicy: reservationOwner,
      description:
        'Get one reservation by its `reservation_id`: status, stay dates, room subtype, rate, regime, ' +
        'party, price, whether it is paid, and the client. A cancelled reservation can no longer be ' +
        'read by id: it answers "not found or cancelled".',
      input: z.object({ reservation_id: id }).strict(),
      handler: async (args, ctx) => {
        const outcome = unwrapAvirato(
          await client.get(`reservation/${args.reservation_id}`, ctx.request, ctx.metadata),
          'get_reservation',
        );
        // Observed: Avirato answers a one-element array for one id.
        return outcome.ok && Array.isArray(outcome.data) ? ok(outcome.data[0]) : outcome;
      },
    }),

    tool({
      name: `mcp_${SLUG}_find_reservations_by_guest`,
      readOnly: true,
      identityPolicy: {
        mode: 'subject-bound',
        identityFields: ['client_doc'],
        ownedResultField: 'reservation_id',
        recordOwnershipKind: RESERVATION_KIND,
      },
      description:
        'Find a guest’s reservations by their identity document (`client_doc`, as the hotel recorded ' +
        'it). Returns `{ items }`, cancelled reservations included; an unknown document returns no ' +
        'items. Avirato was observed returning one reservation of several under the same document, so ' +
        'when the guest has their reservation id, `get_reservation` is the reliable read.',
      input: z.object({ client_doc: z.string().trim().min(1).max(64) }).strict(),
      handler: async (args, ctx) => {
        const res = await client.get(
          `reservation/client/${encodeURIComponent(args.client_doc)}`,
          ctx.request,
          ctx.metadata,
        );
        // Observed: an unknown document is `400 ERROR_RETRIEVING_RESERVATIONS`, which for a search
        // means "nothing found".
        if (!res.ok && aviratoErrorCode(res.body) === NOT_FOUND_CODE) return ok({ items: [] });
        const outcome = unwrapAvirato(res, 'find_reservations_by_guest');
        return outcome.ok
          ? ok({ items: Array.isArray(outcome.data) ? outcome.data : [] })
          : outcome;
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_reservation_links`,
      readOnly: true,
      identityPolicy: reservationOwner,
      description:
        'Get one of a reservation’s guest links: `AutoCheck` (online check-in), `Guest` (the guest ' +
        'area) or `Shop` (the hotel’s online shop). Returns `{ type, url }` as Avirato gives it — the ' +
        '`Shop` URL may be plain `http://`. Which link takes payment for the stay is not stated by ' +
        'Avirato. A cancelled reservation has no links.',
      input: z
        .object({ reservation_id: id, type: z.enum(['AutoCheck', 'Guest', 'Shop']) })
        .strict(),
      handler: async (args, ctx) => {
        const outcome = unwrapAvirato(
          await client.get(`reservation/urls/${args.reservation_id}`, ctx.request, ctx.metadata, {
            type: args.type,
          }),
          'get_reservation_links',
        );
        if (!outcome.ok) return outcome;
        const url = (outcome.data as { url?: unknown } | null)?.url;
        return ok({ type: args.type, url });
      },
    }),

    // ── Control plane ──────────────────────────────────────────────────────────────────────────────
    //
    // Routable by name, withdrawn from the agent's menu (ADR 0013). The quote is the number the agent
    // narrates, so the consumer composes it (its `stay-truth`) rather than the model reading a raw price
    // (feature design AD-4).

    tool({
      name: `mcp_${SLUG}_quote_stay`,
      readOnly: true,
      controlPlane: true,
      description:
        'CONTROL PLANE — quote a stay at the connected hotel: `start_date` to `end_date` (YYYY-MM-DD, ' +
        'check-out after check-in), one entry per room with its subtype and party, optionally limited ' +
        'to `rate_ids`. Returns `{ items }`, one row per rate — `price` is the total for the stay in the ' +
        'hotel’s currency — with Avirato’s exact duplicate rows removed. Creates nothing.',
      input: z
        .object({
          start_date: isoDate,
          end_date: isoDate,
          rooms: z
            .array(
              z
                .object({
                  space_subtype_id: id,
                  adults: z.number().int().min(1),
                  children: z.number().int().min(0),
                })
                .strict(),
            )
            .min(1)
            .max(10),
          rate_ids: z.array(id).min(1).optional(),
        })
        .strict()
        .refine((a) => a.end_date > a.start_date, {
          message: '`end_date` must be after `start_date`',
          path: ['end_date'],
        }),
      handler: async (args, ctx) => {
        const outcome = unwrapAvirato(
          await client.post('price/price_for_reservation', ctx.request, ctx.metadata, args),
          'quote_stay',
        );
        return outcome.ok ? ok({ items: withoutExactDuplicates(outcome.data) }) : outcome;
      },
    }),

    tool({
      name: `mcp_${SLUG}_create_reservation`,
      controlPlane: true,
      // Intentionally NO identityPolicy: creating a reservation neither reads nor changes anyone's
      // existing record (the HiMed `create_appointment` precedent). What it creates is owned by its
      // creator — the consumer records the returned `reservation_id` — and every read or cancel of it
      // afterwards is bound to that owner.
      description:
        'CONTROL PLANE — create a reservation at the connected hotel. Thin passthrough (ADR 0015): one ' +
        'call is at most one reservation request, never retried here, so a consumer that retries first ' +
        'looks for its `external_code` (Avirato returns it as `promotional_package`). No amount is ' +
        'sent: Avirato prices the stay itself, as its quote does; `payment` only says how it is paid. ' +
        'Send the full client — Avirato creates or updates it inline. Returns Avirato’s reservation ' +
        'rows verbatim, with their charges and draft bill.',
      input: z
        .object({
          external_code: z.string().trim().min(1).max(64).optional(),
          promotional_code: z.string().trim().min(1).max(64).optional(),
          rooms: z.array(reservationRoom).min(1).max(10),
        })
        .strict(),
      handler: async (args, ctx) => {
        const body = {
          ...(args.external_code ? { external_code: args.external_code } : {}),
          ...(args.promotional_code ? { promotional_code: args.promotional_code } : {}),
          rooms: args.rooms.map(({ payment, observations, additional_beds, ...room }) => ({
            ...room,
            // Avirato names it `price`; it is how the stay is paid, never an amount (observed).
            price: payment,
            // Required by Avirato, not the consumer's to choose: no operator, no advance, no extras.
            operator_reservation_id: '0',
            advance: { total_advance: 0, advance_type: payment.payment_type },
            observations: observations ?? '',
            additional_beds: additional_beds ?? 0,
            extras: [],
            predefinedCharges: [],
          })),
        };
        return unwrapAvirato(
          await client.post('reservation', ctx.request, ctx.metadata, body),
          'create_reservation',
        );
      },
    }),

    tool({
      name: `mcp_${SLUG}_cancel_reservation`,
      controlPlane: true,
      identityPolicy: reservationOwner,
      description:
        'CONTROL PLANE — cancel a reservation by its `reservation_id`. Avirato keeps it with status ' +
        '"Reserva cancelada" (it is not erased) and returns it; its charges and draft bill stay. One ' +
        'call is one request, never retried here.',
      input: z.object({ reservation_id: id }).strict(),
      handler: async (args, ctx) =>
        unwrapAvirato(
          await client.del(`reservation/${args.reservation_id}`, ctx.request, ctx.metadata),
          'cancel_reservation',
        ),
    }),
  ];
}
