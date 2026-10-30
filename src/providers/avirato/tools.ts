import { z } from 'zod';

import { ok, toolFactory, type ToolDefinition } from '../../core/tool';
import type { AviratoClient } from './client';
import type { AviratoContext } from './context';
import { unwrapAvirato } from './errors';
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
  ];
}
