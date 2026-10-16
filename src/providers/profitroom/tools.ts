import { z } from 'zod';

import { ProviderErrorCode } from '../../core/errors';
import { err, ok, toolFactory, type ToolDefinition } from '../../core/tool';
import type { ClientResult, ProfitroomClient, SendRequest } from './client';
import { bookingEngineUrlContext, hotelKeyFrom, type ProfitroomContext } from './context';
import { resolveLocale, toHotel, toOffer, toRoom } from './mappers';
import { SLUG } from './manifest';
import { runStay } from './stay';
import { calendarSchema, type Details, detailsSchema, offersSchema, roomsSchema } from './schemas';

const tool = toolFactory<ProfitroomContext>();

/** Active offers only — the engine's own page asks `offers?status=1` (Observed). */
const ACTIVE_OFFERS = { query: { status: '1' } } as const;

/** A guest-facing language code; checked against the hotel's live locales per call. */
const locale = z
  .string()
  .regex(/^[a-z]{2}$/, 'Use a two-letter language code, e.g. es')
  .optional()
  .describe("Two-letter language for names and descriptions; defaults to the hotel's language.");

/**
 * A hotel-local calendar date, `YYYY-MM-DD`. The shape check alone would let `2026-02-30` through, so
 * the refine confirms it round-trips to a real calendar day (the same guard Erbon uses).
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD)')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real calendar date');

const DAY_MS = 86_400_000;
/** Whole days from `a` to `b` (both `YYYY-MM-DD`). */
function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS;
}

/** One calendar call covers at most this many days (contract §C.1) — bounds payload and upstream load. */
const MAX_CALENDAR_DAYS = 60;

/** One room's party. Children by age; the hotel's own child age range is checked per call. */
const roomParty = z
  .object({
    adults: z.number().int().min(1).max(10),
    childrenAges: z.array(z.number().int().min(0).max(17)).max(6).optional(),
  })
  .strict();

/** A stay to quote. v1 quotes exactly one room (`rooms` max 1 — raising it later is additive). */
const stayInput = z
  .object({
    checkIn: isoDate,
    checkOut: isoDate,
    rooms: z.array(roomParty).min(1).max(1),
    locale,
  })
  .strict()
  .refine((a) => daysBetween(a.checkIn, a.checkOut) >= 1, {
    message: '`checkOut` must be at least one night after `checkIn`',
  });

/**
 * The Profitroom menu (contract §C.1): money-free reads over the hotel's public booking engine. The
 * hotel comes from the call context (`bookingEngineUrl`), never from a tool argument. Every tool is
 * guest-safe (`audience: 'customer'`) and read-only.
 */
export function buildProfitroomTools(
  client: ProfitroomClient,
  now: () => number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, ProfitroomContext>> {
  return [
    tool({
      name: `mcp_${SLUG}_get_hotel`,
      description:
        "Get the connected hotel's profile from its Profitroom booking engine: name, description, " +
        'currency, time zone, languages, address, guest types (child age range) and check-in/check-out ' +
        'times, plus its public booking-engine address. No prices.',
      input: z.object({ locale }).strict(),
      readOnly: true,
      audience: 'customer',
      handler: async (args, ctx) => {
        // Probe + discovery tool: the core did not validate this context (see context.ts).
        const connectContext = bookingEngineUrlContext.safeParse(ctx.metadata);
        if (!connectContext.success) {
          return err(
            ProviderErrorCode.INVALID_INPUT,
            'bookingEngineUrl is not a Profitroom booking engine address',
          );
        }
        const hotel = await loadHotel(client, ctx.request, connectContext.data, args.locale);
        if (!hotel.ok) return err(hotel.code, hotel.message);
        return ok(toHotel(hotel.data.details, hotel.data.locale, hotel.data.hotelKey));
      },
    }),
    tool({
      name: `mcp_${SLUG}_list_room_types`,
      description:
        'List the room types of the connected Profitroom hotel: name, description, beds, view, area, ' +
        'occupancy limits (`limits.max.occupancy`: adults and children by age range), total rooms ' +
        'and the rate ids (`offerIds`) sold for each. No prices and no availability.',
      input: z.object({ locale }).strict(),
      readOnly: true,
      audience: 'customer',
      handler: async (args, ctx) => {
        const hotel = await loadHotel(client, ctx.request, ctx.metadata, args.locale);
        if (!hotel.ok) return err(hotel.code, hotel.message);
        const { hotelKey, details, locale: loc } = hotel.data;
        const rooms = await client.get(ctx.request, hotelKey, 'rooms', roomsSchema);
        if (!rooms.ok) return err(rooms.code, rooms.message);
        return ok(rooms.data.map((room) => toRoom(room, loc, details.defaultLocale)));
      },
    }),
    tool({
      name: `mcp_${SLUG}_list_rates`,
      description:
        'List the rates (offers) of the connected Profitroom hotel: name, description (what the rate ' +
        'includes, e.g. breakfast), the room type ids it applies to (`roomIds`), its payment and ' +
        'cancellation profiles (`profiles`: deposit %, `cancelTime`/`cancelUnit` before arrival, when ' +
        'the rest is paid) and its date restrictions. Definitions only — no prices.',
      input: z.object({ locale }).strict(),
      readOnly: true,
      audience: 'customer',
      handler: async (args, ctx) => {
        const hotel = await loadHotel(client, ctx.request, ctx.metadata, args.locale);
        if (!hotel.ok) return err(hotel.code, hotel.message);
        const { hotelKey, details, locale: loc } = hotel.data;
        const offers = await client.get(
          ctx.request,
          hotelKey,
          'offers',
          offersSchema,
          ACTIVE_OFFERS,
        );
        if (!offers.ok) return err(offers.code, offers.message);
        return ok(offers.data.map((offer) => toOffer(offer, loc, details.defaultLocale)));
      },
    }),
    tool({
      name: `mcp_${SLUG}_get_availability_calendar`,
      description:
        'Hotel-wide open nights at the connected Profitroom hotel between `from` and `to` (YYYY-MM-DD, ' +
        `at most ${MAX_CALENDAR_DAYS} days). Each date carries \`availability\` (at least one room type ` +
        'can be sold that night), `minLOS`/`maxLOS` (minimum/maximum nights for a stay starting then) ' +
        'and `CTD` (closed to departure). Use it to suggest dates; quote a stay with check_availability.',
      input: z
        .object({ from: isoDate, to: isoDate })
        .strict()
        .refine((a) => daysBetween(a.from, a.to) >= 0, {
          message: '`to` must not be before `from`',
        })
        .refine((a) => daysBetween(a.from, a.to) <= MAX_CALENDAR_DAYS, {
          message: `The range may span at most ${MAX_CALENDAR_DAYS} days`,
        }),
      readOnly: true,
      audience: 'customer',
      handler: async (args, ctx) => {
        const hotelKey = hotelKeyFrom(ctx.metadata.bookingEngineUrl);
        const calendar = await client.get(ctx.request, hotelKey, 'calendar', calendarSchema, {
          query: { from: args.from, to: args.to },
        });
        if (!calendar.ok) return err(calendar.code, calendar.message);
        return ok(calendar.data);
      },
    }),
    tool({
      name: `mcp_${SLUG}_check_availability`,
      description:
        'What can be booked at the connected Profitroom hotel for a stay: `checkIn`/`checkOut` ' +
        '(YYYY-MM-DD) and ONE room with `adults` and optional `childrenAges`. Each proposal names the ' +
        'room (`room`), the rate (`offer`, whose description says what it includes) and its payment ' +
        'and cancellation terms (`profile`), plus `roomCount`, the engine value — its meaning is not confirmed ' +
        '(it is NOT a verified count of rooms left), so never tell the guest how many remain. It carries NO ' +
        'price: the price reaches the guest only through the booking flow. `available: false` means ' +
        'nothing can be sold for that stay and party.',
      input: stayInput,
      readOnly: true,
      audience: 'customer',
      handler: async (args, ctx) => {
        const hotel = await loadHotel(client, ctx.request, ctx.metadata, args.locale);
        if (!hotel.ok) return err(hotel.code, hotel.message);
        return runStay(client, { request: ctx.request, now, ...hotel.data }, args, false);
      },
    }),
    tool({
      // BACKEND-ONLY (`controlPlane`, the money guard — as Erbon's get_rate_prices): out of `listTools()`,
      // in `routableToolNames()`. The consumer turns this into its `StayQuote`; the agent never narrates
      // a raw, pre-tax engine price (feature design §6.2, contract §C.2).
      name: `mcp_${SLUG}_get_stay_prices`,
      description:
        'BACKEND-ONLY. The check_availability proposals with money: each adds `price` (whole stay, this ' +
        'party, verbatim), `originalPrice`, `discounts` and a `bookingUrl` that opens the hotel engine ' +
        'with the stay pre-filled. Top level adds `currency`, the verbatim `taxesPresentationMode` and ' +
        '`taxesIncluded` (false when the engine shows prices net of taxes it adds at checkout).',
      controlPlane: true,
      input: stayInput,
      readOnly: true,
      handler: async (args, ctx) => {
        const hotel = await loadHotel(client, ctx.request, ctx.metadata, args.locale);
        if (!hotel.ok) return err(hotel.code, hotel.message);
        return runStay(client, { request: ctx.request, now, ...hotel.data }, args, true);
      },
    }),
  ];
}

interface HotelScope {
  readonly hotelKey: string;
  readonly details: Details;
  readonly locale: string;
}

/** Every tool starts here: the hotel key from the context, its (cached) details, the call's locale. */
async function loadHotel(
  client: ProfitroomClient,
  request: SendRequest,
  metadata: { readonly bookingEngineUrl: string },
  requestedLocale: string | undefined,
): Promise<ClientResult<HotelScope>> {
  const hotelKey = hotelKeyFrom(metadata.bookingEngineUrl);
  const details = await client.get(request, hotelKey, 'details', detailsSchema);
  if (!details.ok) return details;
  const loc = resolveLocale(details.data, requestedLocale);
  if (!loc.ok) return loc;
  return { ok: true, data: { hotelKey, details: details.data, locale: loc.data } };
}
