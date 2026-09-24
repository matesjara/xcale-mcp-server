import { z } from 'zod';

import { ProviderErrorCode } from '../../core/errors';
import { definePaginatedList } from '../../core/pagination';
import { err, ok, type ToolDefinition, type ToolOutcome, toolFactory } from '../../core/tool';
import { segment, type SiteminderClient } from './client';
import type { SiteminderContext } from './context';
import { unwrapSiteminder, type Unwrapped } from './errors';
import { SLUG } from './manifest';
import { buildBookingEngineLink, MAX_QUOTE_NIGHTS, nightsBetween, StayError } from './stay';

const tool = toolFactory<SiteminderContext>();

const NO_ARGS = z.object({}).strict();

/** SiteMinder's own page-size ceiling on list endpoints (`perPage` 1–50). */
const MAX_PER_PAGE = 50;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const roomTypeUuid = z
  .string()
  .min(1)
  .describe('A room type id (`uuid`) from mcp_siteminder_list_room_types.');
const occupants = z.number().int().min(0).max(50);

function toOutcome(result: Unwrapped): ToolOutcome {
  return result.ok ? ok(result.data) : err(result.code, result.message);
}

/** A stay the API would refuse, refused here instead — before it costs one of 100 calls a minute. */
function stayGuard(checkIn: string, checkOut: string, maxNights?: number): ToolOutcome | undefined {
  try {
    const nights = nightsBetween(checkIn, checkOut);
    if (maxNights !== undefined && nights > maxNights) {
      return err(
        ProviderErrorCode.INVALID_INPUT,
        `SiteMinder quotes at most ${maxNights} nights per request; this stay is ${nights}. ` +
          'Quote it in parts.',
      );
    }
    return undefined;
  } catch (e) {
    if (e instanceof StayError) return err(ProviderErrorCode.INVALID_INPUT, e.message);
    throw e;
  }
}

/**
 * SiteMinder's list envelope. The reference pages name the list `results`; the quick start shows
 * `items` (design-notes D6) — read either, never guess a third.
 */
interface SiteminderPage {
  readonly results?: unknown;
  readonly items?: unknown;
  readonly pagination?: { readonly total?: unknown; readonly totalPages?: unknown };
}

function readPage(data: unknown):
  | {
      readonly items: readonly unknown[];
      readonly totalPages?: number;
      readonly totalResults?: number;
    }
  | undefined {
  const body = data as SiteminderPage;
  const list = Array.isArray(body.results)
    ? body.results
    : Array.isArray(body.items)
      ? body.items
      : undefined;
  if (!list) return undefined;
  const { total, totalPages } = body.pagination ?? {};
  return {
    items: list,
    ...(typeof totalPages === 'number' ? { totalPages } : {}),
    ...(typeof total === 'number' ? { totalResults: total } : {}),
  };
}

/** Room types and room rates are the same paginated read against a different path. */
function propertyList(opts: {
  readonly verb: string;
  readonly path: string;
  readonly description: string;
  readonly client: SiteminderClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
}): ToolDefinition<any, SiteminderContext> {
  return definePaginatedList<typeof NO_ARGS, unknown, SiteminderContext>({
    name: `mcp_${SLUG}_${opts.verb}`,
    description: opts.description,
    input: NO_ARGS,
    handler: async (args, ctx) => {
      if (args.pageSize > MAX_PER_PAGE) {
        return {
          ok: false,
          code: ProviderErrorCode.INVALID_INPUT,
          message: `SiteMinder returns at most ${MAX_PER_PAGE} per page; ask for pageSize ${MAX_PER_PAGE} or less.`,
        };
      }
      const res = await opts.client.getProperty(ctx.metadata.propertyUuid, opts.path, ctx.request, {
        page: args.page,
        perPage: args.pageSize,
      });
      const unwrapped = unwrapSiteminder(res, opts.verb.replace(/_/g, ' '));
      if (!unwrapped.ok) return unwrapped;
      const page = readPage(unwrapped.data);
      if (!page) {
        return {
          ok: false,
          code: ProviderErrorCode.PROVIDER_ERROR,
          message: `SiteMinder ${opts.verb.replace(/_/g, ' ')} returned an unrecognized list shape`,
        };
      }
      return { ok: true, ...page };
    },
  });
}

/** A per-room-type read (`/room-types/{uuid}/…`). */
function roomTypeRead(opts: {
  readonly verb: string;
  readonly sub: string;
  readonly description: string;
  readonly client: SiteminderClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
}): ToolDefinition<any, SiteminderContext> {
  return tool({
    name: `mcp_${SLUG}_${opts.verb}`,
    description: opts.description,
    input: z.object({ roomTypeUuid }).strict(),
    handler: async (args, ctx) =>
      toOutcome(
        unwrapSiteminder(
          await opts.client.getProperty(
            ctx.metadata.propertyUuid,
            `/room-types/${segment(args.roomTypeUuid)}${opts.sub}`,
            ctx.request,
          ),
          opts.verb.replace(/_/g, ' '),
        ),
      ),
  });
}

export function buildSiteminderTools(
  client: SiteminderClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, SiteminderContext>> {
  return [
    // -----------------------------------------------------------------------
    // The property
    // -----------------------------------------------------------------------
    tool({
      name: `mcp_${SLUG}_get_property`,
      description:
        'The hotel as SiteMinder holds it: name, address and coordinates, timezone, the currency every ' +
        'price is in (`currencyIsoCode`), check-in and check-out times, smoking policy, facilities, ' +
        'parking and transport, terms and conditions, directions (`instructionsToLocation`), photos, ' +
        'and `bookingEngineUrl` — the page where a guest books and pays. This is also the cheapest ' +
        'call that proves the connection works.',
      input: NO_ARGS,
      handler: async (_args, ctx) =>
        toOutcome(
          unwrapSiteminder(
            await client.getProperty(ctx.metadata.propertyUuid, '', ctx.request),
            'get property',
          ),
        ),
    }),

    propertyList({
      verb: 'list_room_types',
      path: '/room-types',
      description:
        'The room types the hotel sells: name, description, category, size, bathrooms, and maximum ' +
        'occupancy in total and for adults, children and infants. Quotes name a room type only by its ' +
        '`uuid` (`roomTypeUuid`); this is where that uuid gets its name.',
      client,
    }),

    propertyList({
      verb: 'list_room_rates',
      path: '/room-rates',
      description:
        'The rates the hotel sells, each for one room type (`roomTypeUuid`): name, description, the ' +
        "hotel's cancellation policy in its own words (`cancellationPolicy`, free text), and " +
        '`promotionOnly` — a rate offered only with a promo code. Quotes name a rate only by its ' +
        '`uuid` (`roomRateUuid`); this is where that uuid gets its name and its conditions.',
      client,
    }),

    roomTypeRead({
      verb: 'get_room_type_photos',
      sub: '/photos',
      description:
        'Photos of one room type (`url`, `caption`, `sortOrder`). Floor plans are not included.',
      client,
    }),

    roomTypeRead({
      verb: 'get_room_type_amenities',
      sub: '/amenities',
      description:
        'The amenities of one room type — air conditioning, minibar, desk and the like (`name`).',
      client,
    }),

    roomTypeRead({
      verb: 'get_room_type_bedrooms',
      sub: '/bedrooms',
      description: 'The bedrooms of one room type and the beds in each: bed type and how many.',
      client,
    }),

    // -----------------------------------------------------------------------
    // Price and availability
    // -----------------------------------------------------------------------
    tool({
      name: `mcp_${SLUG}_get_quotes`,
      description:
        'Live price and availability for a stay: one entry per rate that can be booked for those ' +
        'dates and guests. Each entry has `roomTypeUuid` and `roomRateUuid` (names and conditions ' +
        'come from mcp_siteminder_list_room_types and mcp_siteminder_list_room_rates), ' +
        '`availability` (rooms left for the whole stay), and `price` for the whole stay: `gross` ' +
        '(with taxes and service charge), `net`, `tax` and `serviceCharge`, in the currency of ' +
        'mcp_siteminder_get_property. An empty list means nothing can be booked for that stay. ' +
        `At most ${MAX_QUOTE_NIGHTS} nights per request. A quote holds no room and reserves nothing.`,
      input: z
        .object({
          checkIn: isoDate,
          checkOut: isoDate,
          adults: occupants.min(1),
          children: occupants.optional(),
          infants: occupants.optional(),
          promoCode: z.string().trim().min(1).max(64).optional(),
          withBreakdown: z
            .boolean()
            .optional()
            .describe('Include the price of each night, with any discount or promo applied to it.'),
        })
        .strict(),
      handler: async (args, ctx) => {
        const guard = stayGuard(args.checkIn, args.checkOut, MAX_QUOTE_NIGHTS);
        if (guard) return guard;
        const res = await client.getProperty(ctx.metadata.propertyUuid, '/quotes', ctx.request, {
          checkIn: args.checkIn,
          checkOut: args.checkOut,
          adults: args.adults,
          children: args.children,
          infants: args.infants,
          // The reference page's name; the older YAML says `promoCode` (design-notes D4, Q1).
          promocode: args.promoCode,
          withBreakdown: args.withBreakdown,
        });
        return toOutcome(unwrapSiteminder(res, 'get quotes'));
      },
    }),

    // -----------------------------------------------------------------------
    // Where the guest books
    // -----------------------------------------------------------------------
    tool({
      name: `mcp_${SLUG}_build_booking_link`,
      description:
        "A link to the hotel's own booking engine with the guest's dates, guests and rooms already " +
        "filled in. The guest chooses the rate and pays there, under the hotel's own rules. The link " +
        'holds no room and creates no reservation, and nothing tells us afterwards whether the guest ' +
        'booked. The rate cannot be pre-selected.',
      input: z
        .object({
          checkIn: isoDate,
          checkOut: isoDate,
          adults: occupants.min(1),
          children: occupants.default(0),
          infants: occupants.default(0),
          rooms: z.number().int().min(1).max(20).default(1),
          promoCode: z.string().trim().min(1).max(64).optional(),
          locale: z
            .string()
            .regex(/^[a-z]{2}$/, 'expected an ISO 639-1 language code, e.g. "es"')
            .optional()
            .describe('The language the booking engine opens in, e.g. "es".'),
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/, 'expected an ISO 4217 currency code, e.g. "COP"')
            .optional()
            .describe(
              "The currency prices are shown in on the engine; the hotel's own when omitted.",
            ),
        })
        .strict(),
      handler: async (args, ctx) => {
        const guard = stayGuard(args.checkIn, args.checkOut);
        if (guard) return guard;
        const property = unwrapSiteminder(
          await client.getProperty(ctx.metadata.propertyUuid, '', ctx.request),
          'build booking link',
        );
        if (!property.ok) return err(property.code, property.message);
        const engine = (property.data as { bookingEngineUrl?: unknown }).bookingEngineUrl;
        if (typeof engine !== 'string' || engine.length === 0) {
          return err(
            ProviderErrorCode.PROVIDER_ERROR,
            'This hotel has no booking engine URL in SiteMinder, so there is no page to send the guest to.',
          );
        }
        const stay = {
          checkIn: args.checkIn,
          checkOut: args.checkOut,
          adults: args.adults,
          children: args.children,
          infants: args.infants,
          rooms: args.rooms,
          promoCode: args.promoCode,
          locale: args.locale,
          currency: args.currency,
        };
        const url = buildBookingEngineLink(engine, stay);
        if (!url) {
          return err(
            ProviderErrorCode.PROVIDER_ERROR,
            "The hotel's booking engine URL in SiteMinder is not a secure web address, so it is not sent to a guest.",
          );
        }
        return ok({ url, prefilled: stay, holdsRoom: false, createsReservation: false });
      },
    }),
  ];
}
