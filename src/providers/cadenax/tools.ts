import { z } from 'zod';

import { ProviderErrorCode } from '../../core/errors';
import { definePaginatedList, type PaginatedHandlerResult } from '../../core/pagination';
import { err, ok, toolFactory, type ToolDefinition } from '../../core/tool';
import type { ToolIdentityPolicy } from '../../core/types';
import type { CadenaxClient, CadenaxQuery } from './client';
import type { CadenaxContext } from './context';
import { cadenaxFailure, unwrapCadenax } from './errors';
import { SLUG } from './manifest';

const tool = toolFactory<CadenaxContext>();

const noArgs = z.object({}).strict();

/** A Cadenax document id (a MongoDB ObjectId). One path segment, and never anything else. */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'A 24-character Cadenax id');

/** Free-text search, as Cadenax's `q`. */
const q = z.string().trim().min(1).max(200).optional();

const order = z.enum(['asc', 'desc']).optional();

/** An ISO calendar date, `YYYY-MM-DD`, that exists. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO calendar date (YYYY-MM-DD)')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real calendar date');

/**
 * Every published tool is `operator`: Cadenax is Cofinet's internal book, read by its own staff. The
 * consumer decides who that is (the closed-audience gate) — this is the declaration it reads.
 */
const AUDIENCE = 'operator' as const;

/**
 * The records of Cofinet's clients (who reserved, contracted and received what, and their contacts)
 * are returned without the caller naming a person: the broadest read each tool offers.
 */
const CLIENT_RECORDS: ToolIdentityPolicy = { mode: 'subject-scoped' };

/**
 * Cadenax's list envelope — `{ success, data: [...], pagination: { page, limit, total, totalPages } }`
 * — into the uniform page. The items are Cadenax's rows, untouched.
 */
async function listPage(
  client: CadenaxClient,
  segments: readonly string[],
  ctx: { readonly request: Parameters<CadenaxClient['get']>[1] },
  query: CadenaxQuery,
  operation: string,
): Promise<PaginatedHandlerResult<unknown>> {
  const res = await client.get(segments, ctx.request, query);
  if (!res.ok) {
    const failure = cadenaxFailure(res, operation);
    // `cadenaxFailure` only ever builds a failure; the guard is for the type.
    return failure.ok
      ? {
          ok: false,
          code: ProviderErrorCode.PROVIDER_ERROR,
          message: `Cadenax ${operation} failed`,
        }
      : failure;
  }
  const body = res.data as {
    data?: unknown;
    pagination?: { total?: unknown; totalPages?: unknown };
  } | null;
  if (!body || !Array.isArray(body.data)) {
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: `Cadenax ${operation} returned an unrecognized response shape`,
    };
  }
  const { total, totalPages } = body.pagination ?? {};
  return {
    ok: true,
    items: body.data,
    ...(typeof totalPages === 'number' ? { totalPages } : {}),
    ...(typeof total === 'number' ? { totalResults: total } : {}),
  };
}

export function buildCadenaxTools(
  client: CadenaxClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, CadenaxContext>> {
  return [
    // -----------------------------------------------------------------------
    // Control plane — the consumer's, never on an agent's menu
    // -----------------------------------------------------------------------
    tool({
      name: `mcp_${SLUG}_whoami`,
      description:
        'Identify the API key: its name, role, purpose (`agent` writes on behalf of a named ' +
        'person, `sync` is read-only), environment, expiry, and the office it reaches with that ' +
        "office's migration state and default currency. The cheapest call that proves a key, and " +
        'the one that names the office a connection works in. Refuses a key that reaches more ' +
        'than one office: a connection is one key in one office.',
      input: noArgs,
      controlPlane: true,
      readOnly: true,
      handler: async (_args, ctx) => {
        const outcome = unwrapCadenax(await client.get(['auth', 'me'], ctx.request), 'whoami');
        if (!outcome.ok) return outcome;

        const profile = outcome.data as { kind?: unknown; assignedOffices?: unknown };
        // A human session answers this endpoint with a user profile; only a key connects.
        if (profile.kind !== 'api_key' || !Array.isArray(profile.assignedOffices)) {
          return err(
            ProviderErrorCode.PROVIDER_ERROR,
            'Cadenax whoami did not describe an API key',
          );
        }
        const codes = profile.assignedOffices
          .map((office) => (office as { code?: unknown } | null)?.code)
          .filter((code): code is string => typeof code === 'string');
        if (codes.length !== 1 || profile.assignedOffices.length !== 1) {
          // Cadenax expands "every office" to the concrete list, so "all" and "several" are the same
          // answer and neither names one office to work in.
          return err(
            ProviderErrorCode.PROVIDER_ERROR,
            `This Cadenax key reaches ${profile.assignedOffices.length} offices` +
              (codes.length > 0 ? ` (${codes.join(', ')})` : '') +
              '; a connection needs a key scoped to exactly one office.',
          );
        }
        return ok(profile);
      },
    }),

    tool({
      name: `mcp_${SLUG}_resolve_staff_by_phone`,
      description:
        "Answer whether a phone number belongs to an active staff member of the connection's " +
        'office. The number may be in any format; Cadenax normalizes it. `found: false` covers ' +
        'every "no" — unknown number, another office, a deactivated account — and is an answer, ' +
        'not an error. `found: true` carries the staff member (`id`, `name`, `role`, `isActive`, ' +
        '`assignedOffices`); the `id` is what a write names as its acting user.',
      input: z.object({ phone: z.string().trim().min(3).max(40) }).strict(),
      controlPlane: true,
      readOnly: true,
      identityPolicy: {
        mode: 'subject-bound',
        identityFields: ['phone'],
        identityFieldKinds: { phone: 'phone' },
      },
      handler: async (args, ctx) => {
        const res = await client.get(['users', 'by-phone'], ctx.request, {
          phone: args.phone,
          office: ctx.metadata.office,
        });
        // Cadenax answers 404 for every "no", on purpose: it never hints that a number is real
        // somewhere else. That is the question's answer, so it is a success here.
        if (!res.ok && res.status === 404) return ok({ found: false });
        const outcome = unwrapCadenax(res, 'resolve staff by phone');
        if (!outcome.ok) return outcome;
        const staff = (outcome.data as { data?: unknown }).data;
        if (!staff || typeof staff !== 'object') {
          return err(
            ProviderErrorCode.PROVIDER_ERROR,
            'Cadenax resolve staff by phone returned an unrecognized response shape',
          );
        }
        return ok({ found: true, staff });
      },
    }),

    // -----------------------------------------------------------------------
    // Inventory and offering
    // -----------------------------------------------------------------------
    definePaginatedList<z.ZodObject<z.ZodRawShape>, unknown, CadenaxContext>({
      name: `mcp_${SLUG}_search_lots`,
      description:
        "Search the coffee lots of the connection's office. `q` is free text over SKU, origin, " +
        'variety, process, product name, ICO, provider and cargo location. `lotStatus` tells ' +
        'expected (not yet arrived) from physical stock; `isAvailableForReservation` and ' +
        '`availableStock_gt` (kilograms) narrow to what can still be reserved.',
      input: z
        .object({
          q,
          warehouse: z.string().trim().min(1).max(64).optional(),
          origin: z.string().trim().min(1).max(64).optional(),
          variety: z.string().trim().min(1).max(64).optional(),
          process: z.string().trim().min(1).max(64).optional(),
          lotStatus: z.enum(['expected', 'physical']).optional(),
          isAvailableForReservation: z.boolean().optional(),
          availableStock_gt: z.number().min(0).optional(),
          sort: z
            .enum(['createdAt', 'sku', 'entryDate', 'origin', 'variety', 'physicalStock'])
            .optional(),
          order,
        })
        .strict(),
      audience: AUDIENCE,
      readOnly: true,
      handler: ({ page, pageSize, ...filters }, ctx) =>
        listPage(
          client,
          ['lots', 'search'],
          ctx,
          { ...(filters as CadenaxQuery), office: ctx.metadata.office, page, limit: pageSize },
          'search lots',
        ),
    }),

    tool({
      name: `mcp_${SLUG}_get_lot`,
      description:
        "Get one lot of the connection's office by its id: stock, product, warehouse and whether " +
        'it can be reserved. Cadenax refuses a lot that belongs to another office.',
      input: z.object({ lotId: objectId }).strict(),
      audience: AUDIENCE,
      readOnly: true,
      handler: async (args, ctx) =>
        unwrapCadenax(
          await client.get(['lots', args.lotId], ctx.request, { office: ctx.metadata.office }),
          'get lot',
        ),
    }),

    // -----------------------------------------------------------------------
    // Reservations
    // -----------------------------------------------------------------------
    definePaginatedList<z.ZodObject<z.ZodRawShape>, unknown, CadenaxContext>({
      name: `mcp_${SLUG}_search_reservations`,
      description:
        "Search the lot reservations of the connection's office. Narrow by client (`clientId`, a " +
        'company id), contract, status, an expiry window (`expiryFrom`/`expiryTo`) or ' +
        '`expiringWithinDays` for what is about to lapse. A reservation that ran out of time ' +
        'reads `cancelled`: Cadenax does not produce `expired`.',
      input: z
        .object({
          q,
          status: z.enum(['active', 'partial', 'fulfilled', 'expired', 'cancelled']).optional(),
          clientId: objectId.optional(),
          contractId: objectId.optional(),
          expiryFrom: isoDate.optional(),
          expiryTo: isoDate.optional(),
          expiringWithinDays: z.number().int().min(0).max(365).optional(),
          sort: z
            .enum([
              'createdAt',
              'reservationDate',
              'expiryDate',
              'totalValue',
              'totalQuantity',
              'reservationNumber',
              'status',
            ])
            .optional(),
          order,
        })
        .strict(),
      audience: AUDIENCE,
      readOnly: true,
      identityPolicy: CLIENT_RECORDS,
      handler: ({ page, pageSize, ...filters }, ctx) =>
        listPage(
          client,
          ['reservations', 'search'],
          ctx,
          { ...(filters as CadenaxQuery), office: ctx.metadata.office, page, limit: pageSize },
          'search reservations',
        ),
    }),

    tool({
      name: `mcp_${SLUG}_get_reservation`,
      description:
        "Get one reservation of the connection's office by its id, with its lot allocations and " +
        'how much of it has been delivered.',
      input: z.object({ reservationId: objectId }).strict(),
      audience: AUDIENCE,
      readOnly: true,
      identityPolicy: CLIENT_RECORDS,
      handler: async (args, ctx) =>
        unwrapCadenax(
          await client.get(['reservations', args.reservationId], ctx.request, {
            office: ctx.metadata.office,
          }),
          'get reservation',
        ),
    }),

    // -----------------------------------------------------------------------
    // Contracts
    // -----------------------------------------------------------------------
    definePaginatedList<z.ZodObject<z.ZodRawShape>, unknown, CadenaxContext>({
      name: `mcp_${SLUG}_search_contracts`,
      description:
        "Search the volume contracts of the connection's office, by free text, client, product, " +
        'status or type. A `forecast` contract is a projection, not a commitment.',
      input: z
        .object({
          q,
          status: z.enum(['forecast', 'active', 'completed', 'cancelled']).optional(),
          clientId: objectId.optional(),
          productId: objectId.optional(),
          type: z.enum(['rolling', 'exclusive', 'forecast']).optional(),
          sort: z
            .enum(['createdAt', 'contractNumber', 'startDate', 'totalQuantity', 'status'])
            .optional(),
          order,
        })
        .strict(),
      audience: AUDIENCE,
      readOnly: true,
      identityPolicy: CLIENT_RECORDS,
      handler: ({ page, pageSize, ...filters }, ctx) =>
        listPage(
          client,
          ['contracts', 'search'],
          ctx,
          { ...(filters as CadenaxQuery), office: ctx.metadata.office, page, limit: pageSize },
          'search contracts',
        ),
    }),

    tool({
      name: `mcp_${SLUG}_list_expiring_contracts`,
      description:
        "List the contracts of the connection's office that end within `days` days, with their " +
        'count and total quantity.',
      input: z.object({ days: z.number().int().min(1).max(365).optional() }).strict(),
      audience: AUDIENCE,
      readOnly: true,
      identityPolicy: CLIENT_RECORDS,
      handler: async (args, ctx) =>
        unwrapCadenax(
          await client.get(['contracts', 'expiring'], ctx.request, {
            days: args.days,
            office: ctx.metadata.office,
          }),
          'list expiring contracts',
        ),
    }),

    tool({
      name: `mcp_${SLUG}_get_contract`,
      description:
        "Get one contract of the connection's office by its id. `includeDeliveries` adds the " +
        'delivery orders made against it.',
      input: z.object({ contractId: objectId, includeDeliveries: z.boolean().optional() }).strict(),
      audience: AUDIENCE,
      readOnly: true,
      identityPolicy: CLIENT_RECORDS,
      handler: async (args, ctx) =>
        unwrapCadenax(
          await client.get(['contracts', args.contractId], ctx.request, {
            includeDeliveries: args.includeDeliveries,
            office: ctx.metadata.office,
          }),
          'get contract',
        ),
    }),

    // -----------------------------------------------------------------------
    // Delivery orders
    // -----------------------------------------------------------------------
    definePaginatedList<z.ZodObject<z.ZodRawShape>, unknown, CadenaxContext>({
      name: `mcp_${SLUG}_search_deliveries`,
      description:
        "Search the delivery orders of the connection's office — coffee dispatched to a client " +
        'from a reservation — by free text, client, contract, warehouse or status.',
      input: z
        .object({
          q,
          status: z.enum(['scheduled', 'delivered', 'cancelled']).optional(),
          clientId: objectId.optional(),
          contractId: objectId.optional(),
          warehouse: z.string().trim().min(1).max(64).optional(),
          sort: z
            .enum([
              'scheduledDate',
              'createdAt',
              'clientName',
              'contractNumber',
              'deliveryNumber',
              'invoiceReference',
            ])
            .optional(),
          order,
        })
        .strict(),
      audience: AUDIENCE,
      readOnly: true,
      identityPolicy: CLIENT_RECORDS,
      handler: ({ page, pageSize, ...filters }, ctx) =>
        listPage(
          client,
          ['deliveries', 'search'],
          ctx,
          { ...(filters as CadenaxQuery), office: ctx.metadata.office, page, limit: pageSize },
          'search deliveries',
        ),
    }),

    tool({
      name: `mcp_${SLUG}_get_delivery`,
      description:
        "Get one delivery order of the connection's office by its id, with its items, values and " +
        'whether it can still be edited.',
      input: z.object({ deliveryId: objectId }).strict(),
      audience: AUDIENCE,
      readOnly: true,
      identityPolicy: CLIENT_RECORDS,
      handler: async (args, ctx) =>
        unwrapCadenax(
          await client.get(['deliveries', args.deliveryId], ctx.request, {
            office: ctx.metadata.office,
          }),
          'get delivery',
        ),
    }),

    // -----------------------------------------------------------------------
    // Clients — Cadenax keeps one client book for every office
    // -----------------------------------------------------------------------
    definePaginatedList<z.ZodObject<z.ZodRawShape>, unknown, CadenaxContext>({
      name: `mcp_${SLUG}_search_companies`,
      description:
        'Search client companies by name, country, sector, email or address. Cadenax keeps ONE ' +
        'client book across all of its offices, so a result may be a client another office ' +
        'works with. The `_id` of a company is the `clientId` the other searches take.',
      input: z
        .object({
          q,
          country: z.string().trim().min(1).max(64).optional(),
          sector: z.string().trim().min(1).max(64).optional(),
          sort: z.enum(['name', 'country', 'type', 'sector', 'createdAt', 'updatedAt']).optional(),
          order,
        })
        .strict(),
      audience: AUDIENCE,
      readOnly: true,
      identityPolicy: CLIENT_RECORDS,
      handler: ({ page, pageSize, ...filters }, ctx) =>
        listPage(
          client,
          ['companies', 'search'],
          ctx,
          { ...(filters as CadenaxQuery), page, limit: pageSize },
          'search companies',
        ),
    }),

    definePaginatedList<z.ZodObject<z.ZodRawShape>, unknown, CadenaxContext>({
      name: `mcp_${SLUG}_search_contacts`,
      description:
        'Search the people at client companies by name, email, phone or role; `companyId` lists ' +
        "one company's contacts. Like companies, contacts belong to one client book across all " +
        'offices.',
      input: z.object({ q, companyId: objectId.optional(), order }).strict(),
      audience: AUDIENCE,
      readOnly: true,
      identityPolicy: CLIENT_RECORDS,
      handler: ({ page, pageSize, ...filters }, ctx) =>
        listPage(
          client,
          ['contacts', 'search'],
          ctx,
          { ...(filters as CadenaxQuery), page, limit: pageSize },
          'search contacts',
        ),
    }),
  ];
}
