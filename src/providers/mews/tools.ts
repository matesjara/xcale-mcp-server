import { z } from 'zod';

import { ProviderErrorCode } from '../../core/errors';
import { err, ok, type ToolDefinition, type ToolOutcome, toolFactory } from '../../core/tool';
import type { AuthedRequest, MewsClient } from './client';
import type { MewsContext } from './context';
import {
  assertStay,
  assertTimeZone,
  localMidnightUtc,
  localOffsetUtc,
  MewsDateError,
  parseServiceOffset,
  previousDate,
} from './dates';
import { unwrapMews, type Unwrapped } from './errors';
import { SLUG } from './manifest';

/**
 * The Mews tools. Evidence, decisions and what is left out: `docs/design/mews-provider/design-notes.md`.
 *
 * Reads return Mews' own payload (Fidelity over Unification); only `list_services` and
 * `get_configuration` project, because their raw answers are mostly accounting and POS set-up the
 * agent has no use for. Date-taking tools accept the hotel's local dates and convert them (§4).
 */

const tool = toolFactory<MewsContext>();

const NO_ARGS = z.object({}).strict();
const uuid = z.string().uuid();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const cursor = z
  .string()
  .min(1)
  .optional()
  .describe('The `Cursor` of the previous page, to read the next one.');
const limit = z.number().int().min(1).max(100).default(100).describe('Page size (1-100).');
const categoryId = uuid.describe('A room type id, from mcp_mews_list_resource_categories.');
const rateId = uuid.describe('A rate id, from mcp_mews_list_rates (active and enabled).');
const customerId = uuid.describe(
  'A guest id, from mcp_mews_search_customers or mcp_mews_add_customer.',
);

const stay = {
  checkIn: localDate.describe('First night, in the hotel’s local calendar (YYYY-MM-DD).'),
  checkOut: localDate.describe('Departure day, in the hotel’s local calendar (YYYY-MM-DD).'),
};

const personCounts = z
  .array(z.object({ ageCategoryId: uuid, count: z.number().int().min(1).max(50) }).strict())
  .min(1)
  .describe(
    'How many guests of each age category (ids from mcp_mews_list_age_categories), e.g. two adults.',
  );

/** Fail closed, before any request: without our `ClientToken` Mews answers nothing anyway. */
const NOT_CONFIGURED: Unwrapped = {
  ok: false,
  code: ProviderErrorCode.PROVIDER_ERROR,
  message: 'Mews is not configured on this server (no partner ClientToken)',
};

type Fields = Readonly<Record<string, unknown>>;

function asOutcome(u: Unwrapped): ToolOutcome {
  return u.ok ? ok(u.data) : err(u.code, u.message);
}

function dateError(e: unknown): ToolOutcome {
  if (e instanceof MewsDateError) return err(ProviderErrorCode.INVALID_INPUT, e.message);
  return err(ProviderErrorCode.PROVIDER_ERROR, 'Mews date conversion failed');
}

/** The hotel's calendar: its zone, and when a night of this service starts and ends. */
interface ServiceCalendar {
  readonly timeZone: string;
  readonly startOffsetMs: number;
  readonly endOffsetMs: number;
}

export function buildMewsTools(client: MewsClient) {
  async function call(
    operation: string,
    fields: Fields,
    request: AuthedRequest,
  ): Promise<Unwrapped> {
    if (!client.configured) return NOT_CONFIGURED;
    return unwrapMews(await client.call(operation, fields, request), operation);
  }

  async function timeZoneOf(request: AuthedRequest): Promise<Unwrapped> {
    const res = await call('configuration/get', {}, request);
    if (!res.ok) return res;
    const zone = (res.data as { Enterprise?: { TimeZoneIdentifier?: unknown } }).Enterprise
      ?.TimeZoneIdentifier;
    try {
      return { ok: true, data: assertTimeZone(zone) };
    } catch (e) {
      return {
        ok: false,
        code: ProviderErrorCode.PROVIDER_ERROR,
        message: e instanceof Error ? `Mews configuration/get: ${e.message}` : 'Mews timezone',
      };
    }
  }

  async function calendarOf(serviceId: string, request: AuthedRequest): Promise<Unwrapped> {
    const zone = await timeZoneOf(request);
    if (!zone.ok) return zone;
    const res = await call(
      'services/getAll',
      { ServiceIds: [serviceId], Limitation: { Count: 10 } },
      request,
    );
    if (!res.ok) return res;
    // By id, not by position: the answer is filtered by `ServiceIds`, but a calendar read from the
    // wrong service would put every check-in at another service's hour.
    const service = (res.data as { Services?: ReadonlyArray<ServiceShape> }).Services?.find(
      (s) => s.Id === serviceId,
    );
    if (!service) {
      return {
        ok: false,
        code: ProviderErrorCode.PROVIDER_ERROR,
        message: 'Mews services/getAll: the connected service no longer exists',
      };
    }
    try {
      const calendar: ServiceCalendar = {
        timeZone: zone.data as string,
        startOffsetMs: parseServiceOffset(service.Data?.Value?.StartOffset),
        endOffsetMs: parseServiceOffset(service.Data?.Value?.EndOffset),
      };
      return { ok: true, data: calendar };
    } catch (e) {
      return {
        ok: false,
        code: ProviderErrorCode.PROVIDER_ERROR,
        message: e instanceof Error ? `Mews services/getAll: ${e.message}` : 'Mews service',
      };
    }
  }

  /** A stay's `StartUtc`/`EndUtc`: check-in and check-out as the service defines them. */
  function stayInstants(checkIn: string, checkOut: string, c: ServiceCalendar) {
    return {
      StartUtc: localOffsetUtc(checkIn, c.startOffsetMs, c.timeZone),
      EndUtc: localOffsetUtc(checkOut, c.endOffsetMs, c.timeZone),
    };
  }

  const toPersonCounts = (pc: ReadonlyArray<{ ageCategoryId: string; count: number }>) =>
    pc.map((p) => ({ AgeCategoryId: p.ageCategoryId, Count: p.count }));

  return [
    tool({
      name: `mcp_${SLUG}_list_services`,
      description:
        'List the hotel’s active bookable Mews services (a stay, parking, a restaurant…), nightly ' +
        'services first and then in the hotel’s own order, with each service’s id, name and when ' +
        'its nights start and end. Used to pick which service is the accommodation.',
      input: NO_ARGS,
      handler: async (_args, ctx) => {
        const res = await call('services/getAll', { Limitation: { Count: 1000 } }, ctx.request);
        if (!res.ok) return asOutcome(res);
        const services = ((res.data as { Services?: ServiceShape[] }).Services ?? [])
          .filter((s) => s.IsActive === true && s.Data?.Discriminator === 'Bookable')
          // Nightly services first: a stay is sold by the night, so an hourly service (a restaurant,
          // parking, a tour) is never the default binding. In the demo the restaurant has Ordering 0
          // and the accommodation 666 — by Ordering alone, discovery would bind the restaurant.
          .sort(
            (a, b) =>
              Number(b.Data?.Value?.TimeUnitPeriod === 'Day') -
                Number(a.Data?.Value?.TimeUnitPeriod === 'Day') ||
              (a.Ordering ?? 0) - (b.Ordering ?? 0),
          )
          .map((s) => ({
            Id: s.Id,
            Name: s.Name,
            Names: s.Names,
            Ordering: s.Ordering,
            TimeUnitPeriod: s.Data?.Value?.TimeUnitPeriod,
            StartOffset: s.Data?.Value?.StartOffset,
            EndOffset: s.Data?.Value?.EndOffset,
          }));
        return ok(services);
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_configuration`,
      description:
        'The hotel as Mews knows it: name, timezone, default language, currencies, address, contact ' +
        'details and whether its prices are gross or net.',
      input: NO_ARGS,
      handler: async (_args, ctx) => {
        const res = await call('configuration/get', {}, ctx.request);
        if (!res.ok) return asOutcome(res);
        const e = (res.data as { Enterprise?: Record<string, unknown> }).Enterprise ?? {};
        const pick = (k: string) => (k in e ? { [k]: e[k] } : {});
        return ok({
          Enterprise: {
            ...pick('Id'),
            ...pick('Name'),
            ...pick('TimeZoneIdentifier'),
            ...pick('DefaultLanguageCode'),
            ...pick('Currencies'),
            ...pick('Pricing'),
            ...pick('Address'),
            ...pick('Email'),
            ...pick('Phone'),
            ...pick('WebsiteUrl'),
          },
        });
      },
    }),

    tool({
      name: `mcp_${SLUG}_list_resource_categories`,
      description:
        'The room types (resource categories) of the connected service: names and descriptions per ' +
        'language, type, capacity and extra capacity. Use their ids for availability and prices.',
      input: z.object({ cursor, limit }).strict(),
      handler: async (args, ctx) =>
        asOutcome(
          await call(
            'resourceCategories/getAll',
            {
              ServiceIds: [ctx.metadata.serviceId],
              ActivityStates: ['Active'],
              Limitation: { Count: args.limit, ...(args.cursor ? { Cursor: args.cursor } : {}) },
            },
            ctx.request,
          ),
        ),
    }),

    tool({
      name: `mcp_${SLUG}_list_age_categories`,
      description:
        'The age categories of the connected service (adults, children and their ages). A ' +
        'reservation counts its guests by these ids.',
      input: NO_ARGS,
      handler: async (_args, ctx) =>
        asOutcome(
          await call(
            'ageCategories/getAll',
            { ServiceIds: [ctx.metadata.serviceId], Limitation: { Count: 100 } },
            ctx.request,
          ),
        ),
    }),

    tool({
      name: `mcp_${SLUG}_list_rates`,
      description:
        'The rates of the connected service, with whether each is active, enabled and public, and the ' +
        'base rate it derives from. Only an active, enabled rate can be booked.',
      input: z.object({ cursor, limit }).strict(),
      handler: async (args, ctx) =>
        asOutcome(
          await call(
            'rates/getAll',
            {
              ServiceIds: [ctx.metadata.serviceId],
              Limitation: { Count: args.limit, ...(args.cursor ? { Cursor: args.cursor } : {}) },
            },
            ctx.request,
          ),
        ),
    }),

    tool({
      name: `mcp_${SLUG}_get_availability`,
      description:
        'Availability of every room type of the connected service for each night of a stay. ' +
        'TimeUnitStartsUtc lists the nights in order, from checkIn to the night before checkOut ' +
        '(UTC instants of the hotel’s local midnight), and each metric array has one value per night. ' +
        'UsableResources are the rooms that can be sold, Occupied those already booked, ' +
        'OutOfOrderBlocks those closed for maintenance, and PublicAvailabilityAdjustment the hotel’s ' +
        'own adjustment to what it shows publicly. A room type is sold out on a night when nothing ' +
        'usable is left after the occupied and closed ones.',
      input: z.object(stay).strict(),
      handler: async (args, ctx) => {
        let first: string;
        let last: string;
        try {
          assertStay(args.checkIn, args.checkOut);
        } catch (e) {
          return dateError(e);
        }
        const zone = await timeZoneOf(ctx.request);
        if (!zone.ok) return asOutcome(zone);
        try {
          first = localMidnightUtc(args.checkIn, zone.data as string);
          last = localMidnightUtc(previousDate(args.checkOut), zone.data as string);
        } catch (e) {
          return dateError(e);
        }
        return asOutcome(
          await call(
            'services/getAvailability/2024-01-22',
            {
              ServiceId: ctx.metadata.serviceId,
              FirstTimeUnitStartUtc: first,
              LastTimeUnitStartUtc: last,
              Metrics: [
                'ActiveResources',
                'Occupied',
                'OutOfOrderBlocks',
                'UsableResources',
                'PublicAvailabilityAdjustment',
              ],
            },
            ctx.request,
          ),
        );
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_rate_pricing`,
      description:
        'Nightly prices of one rate for every room type, for each night of a stay, in the rate’s ' +
        'currency (CategoryPrices[].AmountPrices, one per night).',
      input: z.object({ rateId, ...stay }).strict(),
      handler: async (args, ctx) => {
        try {
          assertStay(args.checkIn, args.checkOut);
        } catch (e) {
          return dateError(e);
        }
        const zone = await timeZoneOf(ctx.request);
        if (!zone.ok) return asOutcome(zone);
        let first: string;
        let last: string;
        try {
          first = localMidnightUtc(args.checkIn, zone.data as string);
          last = localMidnightUtc(previousDate(args.checkOut), zone.data as string);
        } catch (e) {
          return dateError(e);
        }
        return asOutcome(
          await call(
            'rates/getPricing',
            { RateId: args.rateId, FirstTimeUnitStartUtc: first, LastTimeUnitStartUtc: last },
            ctx.request,
          ),
        );
      },
    }),

    tool({
      name: `mcp_${SLUG}_price_reservation`,
      description:
        'The exact total Mews would charge for one candidate stay (room type, rate, dates, guests), ' +
        'before booking it. This is the quote to give a guest.',
      input: z.object({ categoryId, rateId, ...stay, personCounts }).strict(),
      handler: async (args, ctx) => {
        try {
          assertStay(args.checkIn, args.checkOut);
        } catch (e) {
          return dateError(e);
        }
        const cal = await calendarOf(ctx.metadata.serviceId, ctx.request);
        if (!cal.ok) return asOutcome(cal);
        let instants: { StartUtc: string; EndUtc: string };
        try {
          instants = stayInstants(args.checkIn, args.checkOut, cal.data as ServiceCalendar);
        } catch (e) {
          return dateError(e);
        }
        // `StartUtc`/`EndUtc`, not the documented `Scheduled*`: observed 2026-09-23, this operation
        // rejects `ScheduledStartUtc` with "Invalid StartUtc." (design-notes E6).
        return asOutcome(
          await call(
            'reservations/price',
            {
              ServiceId: ctx.metadata.serviceId,
              Reservations: [
                {
                  Identifier: 'quote',
                  ...instants,
                  RequestedCategoryId: args.categoryId,
                  RateId: args.rateId,
                  PersonCounts: toPersonCounts(args.personCounts),
                },
              ],
            },
            ctx.request,
          ),
        );
      },
    }),

    tool({
      name: `mcp_${SLUG}_search_customers`,
      description:
        'Find guests (customers) of the hotel by email or by id, to reuse an existing guest instead of ' +
        'creating a duplicate.',
      input: z
        .object({
          emails: z.array(z.string().email()).min(1).max(20).optional(),
          customerIds: z.array(uuid).min(1).max(20).optional(),
        })
        .strict()
        .refine((a) => a.emails !== undefined || a.customerIds !== undefined, {
          message: 'give emails or customerIds',
        }),
      handler: async (args, ctx) =>
        asOutcome(
          await call(
            'customers/getAll',
            {
              ...(args.emails ? { Emails: args.emails } : {}),
              ...(args.customerIds ? { CustomerIds: args.customerIds } : {}),
              Limitation: { Count: 20 },
            },
            ctx.request,
          ),
        ),
    }),

    tool({
      name: `mcp_${SLUG}_add_customer`,
      description:
        'Create a guest (customer) in the hotel’s Mews. A reservation needs one. Search first: ' +
        'this never overwrites an existing guest.',
      input: z
        .object({
          lastName: z.string().min(1).max(255),
          firstName: z.string().min(1).max(255).optional(),
          email: z.string().email().optional(),
          phone: z.string().min(3).max(50).optional(),
          languageCode: z
            .string()
            .regex(/^[a-z]{2}-[A-Z]{2}$/, 'expected a culture code such as es-ES')
            .optional()
            .describe(
              'The language Mews writes to the guest in: a culture code such as es-ES or en-US (the ' +
                'hotel’s own is the DefaultLanguageCode of mcp_mews_get_configuration).',
            ),
          nationalityCode: z
            .string()
            .regex(/^[A-Z]{2}$/, 'expected an ISO 3166-1 alpha-2 country code such as CO')
            .optional()
            .describe(
              'The guest’s nationality, as an ISO 3166-1 alpha-2 country code (CO, US, ES).',
            ),
        })
        .strict(),
      handler: async (args, ctx) =>
        asOutcome(
          await call(
            'customers/add',
            {
              LastName: args.lastName,
              ...(args.firstName ? { FirstName: args.firstName } : {}),
              ...(args.email ? { Email: args.email } : {}),
              ...(args.phone ? { Phone: args.phone } : {}),
              ...(args.languageCode ? { LanguageCode: args.languageCode } : {}),
              ...(args.nationalityCode ? { NationalityCode: args.nationalityCode } : {}),
              OverwriteExisting: false,
            },
            ctx.request,
          ),
        ),
    }),

    tool({
      name: `mcp_${SLUG}_list_reservations`,
      description:
        'Reservations of the connected service by id, by reservation number or by guest (customer ' +
        'id), with their state (Confirmed, Canceled…), dates, room type and rate.',
      input: z
        .object({
          reservationIds: z.array(uuid).min(1).max(100).optional(),
          numbers: z.array(z.string().min(1)).min(1).max(100).optional(),
          customerIds: z.array(uuid).min(1).max(100).optional(),
          cursor,
          limit,
        })
        .strict()
        .refine(
          (a) =>
            a.reservationIds !== undefined ||
            a.numbers !== undefined ||
            a.customerIds !== undefined,
          { message: 'give reservationIds, numbers or customerIds' },
        ),
      handler: async (args, ctx) =>
        asOutcome(
          await call(
            'reservations/getAll/2023-06-06',
            {
              ServiceIds: [ctx.metadata.serviceId],
              ...(args.reservationIds ? { ReservationIds: args.reservationIds } : {}),
              ...(args.numbers ? { Numbers: args.numbers } : {}),
              ...(args.customerIds ? { AccountIds: args.customerIds } : {}),
              Limitation: { Count: args.limit, ...(args.cursor ? { Cursor: args.cursor } : {}) },
            },
            ctx.request,
          ),
        ),
    }),

    tool({
      name: `mcp_${SLUG}_create_reservation`,
      description:
        'Book one stay in the hotel’s Mews for an existing guest. Mews checks availability and the ' +
        'rate itself and refuses what it cannot sell. Never retry a create blindly: Mews has no ' +
        'idempotency key, so look the guest’s reservations up first.',
      input: z
        .object({
          customerId,
          categoryId,
          rateId,
          ...stay,
          personCounts,
          state: z
            .enum(['Confirmed', 'Optional', 'Inquired', 'Requested'])
            .default('Confirmed')
            .describe('Confirmed books the stay; Optional holds it; Inquired and Requested ask.'),
          notes: z.string().max(1000).optional(),
          sendConfirmationEmail: z
            .boolean()
            .optional()
            .describe('Whether Mews emails the guest a confirmation. Omitted: Mews’ own default.'),
        })
        .strict(),
      handler: async (args, ctx) => {
        try {
          assertStay(args.checkIn, args.checkOut);
        } catch (e) {
          return dateError(e);
        }
        const cal = await calendarOf(ctx.metadata.serviceId, ctx.request);
        if (!cal.ok) return asOutcome(cal);
        let instants: { StartUtc: string; EndUtc: string };
        try {
          instants = stayInstants(args.checkIn, args.checkOut, cal.data as ServiceCalendar);
        } catch (e) {
          return dateError(e);
        }
        return asOutcome(
          await call(
            'reservations/add',
            {
              ServiceId: ctx.metadata.serviceId,
              ...(args.sendConfirmationEmail !== undefined
                ? { SendConfirmationEmail: args.sendConfirmationEmail }
                : {}),
              Reservations: [
                {
                  State: args.state,
                  ...instants,
                  CustomerId: args.customerId,
                  RequestedCategoryId: args.categoryId,
                  RateId: args.rateId,
                  PersonCounts: toPersonCounts(args.personCounts),
                  ...(args.notes ? { Notes: args.notes } : {}),
                },
              ],
            },
            ctx.request,
          ),
        );
      },
    }),

    tool({
      name: `mcp_${SLUG}_cancel_reservation`,
      description:
        'Cancel one reservation, with the reason Mews requires. Whether a cancellation fee is posted ' +
        'follows the hotel’s Mews set-up unless postCancellationFee says otherwise.',
      input: z
        .object({
          reservationId: uuid,
          reason: z.string().min(1).max(1000),
          postCancellationFee: z
            .boolean()
            .optional()
            .describe(
              'Whether Mews charges the rate’s cancellation fee to the guest’s bill. Omitted: the hotel’s ' +
                'Mews set-up decides.',
            ),
          sendEmail: z
            .boolean()
            .optional()
            .describe(
              'Whether Mews emails the guest about the cancellation. Omitted: Mews’ own default.',
            ),
        })
        .strict(),
      handler: async (args, ctx) =>
        asOutcome(
          await call(
            'reservations/cancel',
            {
              ReservationIds: [args.reservationId],
              Notes: args.reason,
              ...(args.postCancellationFee !== undefined
                ? { PostCancellationFee: args.postCancellationFee }
                : {}),
              ...(args.sendEmail !== undefined ? { SendEmail: args.sendEmail } : {}),
            },
            ctx.request,
          ),
        ),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
  ] as ToolDefinition<any, MewsContext>[];
}

/** The fields of a Mews service this provider reads (observed `services/getAll`). */
interface ServiceShape {
  readonly Id?: string;
  readonly Name?: string;
  readonly Names?: Record<string, string>;
  readonly IsActive?: boolean;
  readonly Ordering?: number;
  readonly Data?: {
    readonly Discriminator?: string;
    readonly Value?: {
      readonly TimeUnitPeriod?: string;
      readonly StartOffset?: string;
      readonly EndOffset?: string;
    };
  };
}
