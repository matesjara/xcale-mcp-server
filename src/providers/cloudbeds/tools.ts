import { z } from 'zod';

import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';
import { definePaginatedList } from '../../core/pagination';
import { type ToolDefinition, err, ok, toolFactory } from '../../core/tool';
import type { CloudbedsClient } from './client';
import type { CloudbedsContext } from './context';
import { SLUG } from './manifest';

type Unwrapped =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

/**
 * Cloudbeds wraps payloads as `{ success, data, total?, message? }`. Provider-specific shaping stays
 * here. Fidelity over unification: we return the provider's `data` verbatim (no entity remodeling).
 */
function unwrap(res: RequestResult, method: string): Unwrapped {
  if (!res.ok) {
    return {
      ok: false,
      code: res.errorCode,
      message: `Cloudbeds ${method} failed (HTTP ${res.status})`,
    };
  }
  const body = res.data as { success?: boolean; data?: unknown; message?: string } | null;
  if (body && body.success === false) {
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: body.message ?? `Cloudbeds ${method} returned success=false`,
    };
  }
  return { ok: true, data: body && 'data' in body ? body.data : body };
}

/**
 * The curated, read-first toolset. `propertyID` comes from the validated `ctx.metadata`
 * (Explicit Context); the consumer (Rail A) forwards it. The uniform `page`/`pageSize` contract is
 * translated to Cloudbeds' own param names (`pageNumber`/`resultsPerPage`) here — that translation
 * is exactly the adapter's job. (Verify the exact names once against a live sandbox.)
 */
export function buildCloudbedsTools(
  client: CloudbedsClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, CloudbedsContext>> {
  const tool = toolFactory<CloudbedsContext>();

  return [
    definePaginatedList({
      name: `mcp_${SLUG}_list_reservations`,
      description: 'List reservations for the property, filtered by status and/or check-in dates.',
      input: z.object({
        status: z.string().optional(),
        checkInFrom: z.string().optional(),
        checkInTo: z.string().optional(),
      }),
      handler: async (args, ctx) => {
        const { propertyID } = ctx.metadata as CloudbedsContext;
        const res = await client.get('getReservations', ctx.token, {
          propertyID,
          pageNumber: args.page,
          resultsPerPage: args.pageSize, // Cloudbeds' param name for page size
          status: args.status,
          checkInFrom: args.checkInFrom,
          checkInTo: args.checkInTo,
        });
        if (!res.ok) {
          return {
            ok: false,
            code: res.errorCode,
            message: `Cloudbeds getReservations failed (HTTP ${res.status})`,
          };
        }
        const body = res.data as {
          success?: boolean;
          data?: unknown[];
          total?: number;
          message?: string;
        } | null;
        if (body && body.success === false) {
          return {
            ok: false,
            code: ProviderErrorCode.PROVIDER_ERROR,
            message: body.message ?? 'getReservations success=false',
          };
        }
        return { ok: true, items: body?.data ?? [], totalResults: body?.total };
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_reservation`,
      description: 'Get a single reservation by its id.',
      input: z.object({ reservationID: z.string().min(1) }).strict(),
      handler: async (args, ctx) => {
        const res = await client.get('getReservation', ctx.token, {
          propertyID: ctx.metadata.propertyID,
          reservationID: args.reservationID,
        });
        const u = unwrap(res, 'getReservation');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_guest`,
      description: 'Get a single guest by its id.',
      input: z.object({ guestID: z.string().min(1) }).strict(),
      handler: async (args, ctx) => {
        const res = await client.get('getGuest', ctx.token, {
          propertyID: ctx.metadata.propertyID,
          guestID: args.guestID,
        });
        const u = unwrap(res, 'getGuest');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_availability`,
      description: 'Get available room types for a date range.',
      input: z.object({ startDate: z.string().min(1), endDate: z.string().min(1) }).strict(),
      handler: async (args, ctx) => {
        const res = await client.get('getAvailableRoomTypes', ctx.token, {
          propertyID: ctx.metadata.propertyID,
          startDate: args.startDate,
          endDate: args.endDate,
        });
        const u = unwrap(res, 'getAvailableRoomTypes');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_list_room_types`,
      description: 'List the room types configured for the property.',
      input: z.object({}).strict(),
      handler: async (_args, ctx) => {
        const res = await client.get('getRoomTypes', ctx.token, {
          propertyID: ctx.metadata.propertyID,
        });
        const u = unwrap(res, 'getRoomTypes');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_hotel_details`,
      description: 'Get the property (hotel) details.',
      input: z.object({}).strict(),
      handler: async (_args, ctx) => {
        const res = await client.get('getHotelDetails', ctx.token, {
          propertyID: ctx.metadata.propertyID,
        });
        const u = unwrap(res, 'getHotelDetails');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),
  ];
}
