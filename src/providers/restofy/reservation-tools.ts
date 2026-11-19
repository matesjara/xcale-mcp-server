import { z } from 'zod';

import { defineTool, ok, type ToolDefinition, type ToolOutcome } from '../../core/tool';
import type { RestofyClient } from './client';
import { toOutcome } from './errors';
import { SLUG } from './manifest';
import { e164, id, uuid } from './schemas';

/** A calendar date, `YYYY-MM-DD`. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');
/** An ISO 8601 date-time WITH its offset (or Z): the hour is never guessed in another timezone. */
const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
    'an ISO 8601 date-time with its offset',
  );
const scope = z.enum(['today', 'upcoming', 'history']);

/** At most this many areas are read in detail; a restaurant has a handful. */
const MAX_AREAS = 20;

/** The fields of a reservation row the diner it belongs to may be shown (identity projection). */
const RESERVATION_PROJECTION = [
  'reservationId',
  'reservedAt',
  'durationMinutes',
  'guestCount',
  'status',
  'reservationAreaId',
  'occasionName',
  'notes',
  'partyName',
  'partyPhone',
] as const;

type Row = Record<string, unknown>;

/** `data[key]` as a list of rows, whatever Restofy sent. */
function rowsOf(data: unknown, key: string): Row[] {
  const list = (data as Record<string, unknown> | null)?.[key];
  return Array.isArray(list) ? (list as Row[]) : [];
}

function pick(row: Row, fields: readonly string[]): Row {
  return Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, row[f]]));
}

export function buildReservationTools(client: RestofyClient): ToolDefinition[] {
  return [
    defineTool({
      name: `mcp_${SLUG}_list_reservation_areas`,
      description:
        'The areas of the restaurant a table can be booked in, each with the restaurant’s own rules: ' +
        '`capacityMax`, `minPartySize`/`maxPartySize`, `minAdvanceMinutes` (minimum notice), ' +
        '`maxAdvanceDays` (how far ahead), `slotCapacity`, whether it is bookable online ' +
        '(`isOnlineBookable`) and whether it asks a deposit. Restofy does NOT enforce these when a ' +
        'reservation is created through this API: read them before booking.',
      input: z.object({}).strict(),
      readOnly: true,
      audience: 'customer',
      handler: async (_args, ctx) => {
        const list = toOutcome(
          await client.call('reservation-areas/list-reservation-areas', ctx.request),
        );
        if (!list.ok) return list;
        const items: Row[] = [];
        // Sequential on purpose: a handful of areas, and no rate limit is known (risk R-1).
        for (const row of rowsOf(list.data, 'reservationAreas').slice(0, MAX_AREAS)) {
          const detail = toOutcome(
            await client.call('reservation-areas/get-reservation-area', ctx.request, {
              reservationAreaId: row.reservationAreaId,
            }),
          );
          if (!detail.ok) return detail;
          const rules = (detail.data as { reservationArea?: Row } | null)?.reservationArea ?? {};
          const { schedule: _schedule, scheduleId: _scheduleId, ...merged } = { ...row, ...rules };
          items.push(merged);
        }
        return ok({ items });
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_list_reservation_slots`,
      description:
        'The half-hour slots of one day in one area (`areaUuid` from list_reservation_areas), each ' +
        'with `iso` (UTC) and `isFull`, computed by Restofy from the restaurant’s own rules. Only ' +
        'areas the restaurant made bookable online have slots: otherwise `{ slots: [], reason: ' +
        '"not_bookable_online" }`; a restaurant with no public address answers `reason: ' +
        '"no_public_address"`; an `areaUuid` the restaurant does not have, `reason: "unknown_area"`. A past ' +
        'date has no slots.',
      input: z.object({ areaUuid: uuid, date: isoDate }).strict(),
      readOnly: true,
      audience: 'customer',
      handler: async ({ areaUuid, date }, ctx) => {
        // The slots live on Restofy's public diner surface, keyed by the restaurant's public address;
        // the management API has no availability read (feature design AD-8).
        const tenant = toOutcome(await client.call('tenants/get-tenant-info', ctx.request));
        if (!tenant.ok) return tenant;
        const slug = (tenant.data as { slug?: unknown } | null)?.slug;
        if (typeof slug !== 'string' || slug.length === 0) {
          return ok({ slots: [], reason: 'no_public_address' });
        }

        const list = toOutcome(
          await client.call('reservation-areas/list-reservation-areas', ctx.request),
        );
        if (!list.ok) return list;
        const area = rowsOf(list.data, 'reservationAreas').find(
          (a) => a.reservationAreaUuid === areaUuid,
        );
        if (!area) return ok({ slots: [], reason: 'unknown_area' });
        if (!area.isOnlineBookable) return ok({ slots: [], reason: 'not_bookable_online' });

        return toOutcome(
          await client.call('diner-reservation/list-reservation-slots', ctx.request, {
            slug,
            areaUuid,
            date,
          }),
        );
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_find_reservations_by_phone`,
      description:
        'The reservations of the diner with EXACTLY this phone (E.164), upcoming by default ' +
        '(`today`, `upcoming` or `history`, in the restaurant’s timezone). Only reservations whose ' +
        'contact has this very phone are returned.',
      input: z.object({ phone: e164, scope: scope.default('upcoming') }).strict(),
      readOnly: true,
      audience: 'customer',
      identityPolicy: {
        mode: 'subject-bound',
        identityFields: ['phone'],
        identityFieldKinds: { phone: 'phone' },
        recordLookup: true,
        recordKind: 'reservation',
        resultItemsPath: 'items',
        resultIdentityFields: { partyPhone: 'phone' },
        resultRecordIdField: 'reservationId',
        resultDateField: 'reservedAt',
        projection: RESERVATION_PROJECTION,
      },
      handler: async ({ phone, scope: when }, ctx): Promise<ToolOutcome> => {
        const outcome = toOutcome(
          await client.call('reservations/list-reservations', ctx.request, {
            scope: when,
            search: phone,
          }),
        );
        if (!outcome.ok) return outcome;
        // Restofy's `search` also matches names and notes; keep only this phone's own reservations.
        const items = rowsOf(outcome.data, 'reservations')
          .filter((r) => r.partyPhone === phone)
          .map((r) => pick(r, RESERVATION_PROJECTION));
        return ok({ items });
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_create_reservation`,
      description:
        'Book a table for a contact (`partyId` from find_contact_by_phone or create_contact) in an area, ' +
        'at `reservedAt` (ISO 8601 with its offset, e.g. 2026-11-21T20:00:00-05:00; sent to Restofy as the same instant in UTC), for `guestCount` ' +
        'people, 90 minutes by default. Restofy CONFIRMS it at once and does NOT check the area’s ' +
        'capacity, its party size limits, its notice or the slot on this path: read list_reservation_areas ' +
        'and list_reservation_slots first. Restofy itself reminds the diner by WhatsApp before the time ' +
        'when the contact has a phone. No deposit is taken.',
      input: z
        .object({
          partyId: id,
          reservationAreaId: id,
          guestCount: z.number().int().min(1).max(255),
          reservedAt: isoDateTime,
          durationMinutes: z.number().int().min(15).max(600).optional(),
          guestOccasionId: id.optional(),
          notes: z.string().max(2000).optional(),
        })
        .strict(),
      audience: 'customer',
      handler: async (args, ctx) =>
        toOutcome(
          await client.call('reservations/create-reservation', ctx.request, {
            ...args,
            // Restofy takes only UTC with a Z suffix (contract QA, observed 2026-11-19); the offset the
            // agent gives names the same instant, so it is converted, never dropped.
            reservedAt: new Date(args.reservedAt).toISOString(),
          }),
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_cancel_reservation`,
      description:
        'Cancel a reservation by its `reservationId`, with the reason. Restofy cancels a pending, ' +
        'confirmed or seated reservation, and refuses one already cancelled, finished or marked no-show.',
      input: z
        .object({ reservationId: id, cancellationReason: z.string().trim().min(2).max(300) })
        .strict(),
      audience: 'customer',
      identityPolicy: {
        mode: 'subject-bound',
        identityFields: [],
        recordOwnershipField: 'reservationId',
        recordOwnershipKind: `${SLUG}:reservation`,
        recordAction: 'cancel',
      },
      handler: async (args, ctx) =>
        toOutcome(await client.call('reservations/cancel-reservation', ctx.request, { ...args })),
    }),

    defineTool({
      name: `mcp_${SLUG}_get_reservation`,
      description:
        'One reservation by its `reservationId`: its time, party size, area, table, `status` ' +
        '(`confirmed`, `pending`, `seated`, `finished`, `no_show`, `cancelled`), notes and contact.',
      input: z.object({ reservationId: id }).strict(),
      readOnly: true,
      audience: 'customer',
      identityPolicy: {
        mode: 'subject-bound',
        identityFields: [],
        recordOwnershipField: 'reservationId',
        recordOwnershipKind: `${SLUG}:reservation`,
        recordAction: 'read',
      },
      handler: async (args, ctx) => {
        const outcome = toOutcome(
          await client.call('reservations/get-reservation-detail', ctx.request, { ...args }),
        );
        if (!outcome.ok) return outcome;
        // Restofy answers 400 "Reserva no encontrada" for an unknown id (docs), mapped like any refusal.
        return ok((outcome.data as { reservation?: unknown } | null)?.reservation);
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_list_reservations`,
      description:
        'Every reservation of the restaurant for a scope (`today`, `upcoming`, `history`), optionally ' +
        'searched by name, phone or notes, paged. For a consumer’s sync, not a diner.',
      input: z
        .object({
          scope,
          search: z.string().min(1).max(100).optional(),
          page: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .strict(),
      readOnly: true,
      identityPolicy: { mode: 'subject-scoped' },
      // Withdrawn from tools/list: it names nobody and returns other diners' bookings.
      controlPlane: true,
      handler: async (args, ctx) =>
        toOutcome(await client.call('reservations/list-reservations', ctx.request, { ...args })),
    }),
  ];
}
