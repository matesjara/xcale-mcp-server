import { z } from 'zod';

import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';
import { definePaginatedList } from '../../core/pagination';
import { type ToolDefinition, err, ok, toolFactory } from '../../core/tool';
import type { CloudbedsClient } from './client';
import type { CloudbedsContext } from './context';
import { SLUG } from './manifest';

type Unwrapped =
  | { readonly ok: true; readonly data: unknown; readonly total?: number }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

/**
 * Cloudbeds wraps payloads as `{ success, data, total?, message? }`. Provider-specific shaping stays
 * here. Fidelity over unification: we return the provider's `data` verbatim (no entity remodeling).
 *
 * NOTE (observed): Cloudbeds answers a bad request with **HTTP 200 + `success:false`** (e.g. a missing
 * required param, or `"Scope required for this call was not granted by property."`), so the envelope —
 * not the status code — is what tells us a call failed. Every tool must unwrap through here; that is
 * why the paginated list reuses it too rather than re-implementing the check.
 */
function unwrap(res: RequestResult, method: string): Unwrapped {
  if (!res.ok) {
    return {
      ok: false,
      code: res.errorCode,
      message: `Cloudbeds ${method} failed (HTTP ${res.status})`,
    };
  }
  const body = res.data as {
    success?: boolean;
    data?: unknown;
    total?: number;
    message?: string;
  } | null;
  if (body && body.success === false) {
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: body.message ?? `Cloudbeds ${method} returned success=false`,
    };
  }
  const data = body && 'data' in body ? body.data : body;
  return body?.total !== undefined ? { ok: true, data, total: body.total } : { ok: true, data };
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
      requiredScopes: ['read:reservation'], // spec: getReservations
      description: 'List reservations for the property, filtered by status and/or check-in dates.',
      input: z.object({
        status: z.string().optional(),
        checkInFrom: z.string().optional(),
        checkInTo: z.string().optional(),
        // External-reference filters — how a consumer reconciles a booking it created. Each
        // reservation in the response also carries `thirdPartyIdentifier` verbatim, so a consumer can
        // reconcile either server-side (this filter) or client-side over a bounded window.
        sourceReservationId: z
          .string()
          .optional()
          .describe("Filter by the source system's reservation id (external reference)."),
        sourceId: z.string().optional().describe('Filter by source id (channel/booking-engine).'),
      }),
      handler: async (args, ctx) => {
        const { propertyID } = ctx.metadata as CloudbedsContext;
        const res = await client.get('getReservations', ctx.request, {
          propertyID,
          pageNumber: args.page,
          // `pageSize` — NOT `resultsPerPage`. Settled against the sandbox with 27 reservations
          // (api-contract §7-C): `resultsPerPage=2` returns all 27 (silently ignored), `pageSize=2`
          // returns 2. The old name made every list return the full set — unbounded provider payload
          // straight into the agent's context.
          pageSize: args.pageSize,
          status: args.status,
          checkInFrom: args.checkInFrom,
          checkInTo: args.checkInTo,
          sourceReservationId: args.sourceReservationId,
          sourceId: args.sourceId,
        });
        // Reuse the shared envelope unwrap — same `success/data/total` contract as every other tool.
        const u = unwrap(res, 'getReservations');
        if (!u.ok) return { ok: false, code: u.code, message: u.message };
        return {
          ok: true,
          items: Array.isArray(u.data) ? u.data : [],
          totalResults: u.total,
        };
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_reservation`,
      requiredScopes: ['read:reservation'], // spec: getReservation
      description: 'Get a single reservation by its id.',
      input: z.object({ reservationID: z.string().min(1) }).strict(),
      handler: async (args, ctx) => {
        const res = await client.get('getReservation', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          reservationID: args.reservationID,
        });
        const u = unwrap(res, 'getReservation');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_guest`,
      requiredScopes: ['read:guest'], // spec: getGuest
      description: 'Get a single guest by its id.',
      input: z.object({ guestID: z.string().min(1) }).strict(),
      handler: async (args, ctx) => {
        const res = await client.get('getGuest', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          guestID: args.guestID,
        });
        const u = unwrap(res, 'getGuest');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_availability`,
      requiredScopes: ['read:room'], // spec: getAvailableRoomTypes
      description: 'Get available room types for a date range.',
      input: z.object({ startDate: z.string().min(1), endDate: z.string().min(1) }).strict(),
      handler: async (args, ctx) => {
        const res = await client.get('getAvailableRoomTypes', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          startDate: args.startDate,
          endDate: args.endDate,
        });
        const u = unwrap(res, 'getAvailableRoomTypes');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_create_reservation`,
      // The spec declares `postReservation` as `write:reservation` ONLY, and this tool calls no other
      // method — so `write:guest` is, on paper, unnecessary. It is kept DELIBERATELY: the call creates
      // the guest inline from the args below, we have never exercised it without `write:guest`, and this
      // spec has already been caught omitting a real scope (`read:adjustment` appears in no `security`
      // block yet the scope exists). The bet is asymmetric — dropping it saves one permission; being
      // wrong breaks booking creation, the core flow — and settling it costs a reconnect, which has a
      // real human cost. Remove only once a run without it is observed to succeed.
      requiredScopes: ['write:reservation', 'write:guest'], // spec: postReservation
      description:
        'Create a reservation (booking) for the property. Requires the stay dates, the primary guest, ' +
        'and per room type the rooms/adults/children counts. Get roomTypeID and roomRateID from the ' +
        'availability/rate tools — never invent them. Booking-only: this declares a payment method but ' +
        'captures no card and moves no money. Pass thirdPartyIdentifier to stamp your own external ' +
        'reference so you can reconcile the booking later.',
      input: z
        .object({
          // Stay
          startDate: z.string().min(1).describe('Check-in date, YYYY-MM-DD'),
          endDate: z.string().min(1).describe('Check-out date, YYYY-MM-DD'),

          // Primary guest
          guestFirstName: z.string().min(1),
          guestLastName: z.string().min(1),
          guestCountry: z.string().length(2).describe('ISO 3166-1 alpha-2'),
          guestZip: z.string().min(1),
          guestEmail: z.string().email(),
          guestPhone: z.string().optional(),
          guestGender: z.enum(['M', 'F', 'N/A']).optional(),

          // Rooms / occupancy — arrays keyed by room type
          rooms: z
            .array(
              z.object({
                roomTypeID: z.string().min(1),
                quantity: z.number().int().positive(),
                roomID: z.string().optional(),
                roomRateID: z.string().optional(),
              }),
            )
            .min(1),
          adults: z
            .array(
              z.object({
                roomTypeID: z.string().min(1),
                quantity: z.number().int().nonnegative(),
                roomID: z.string().optional(),
              }),
            )
            .min(1),
          children: z
            .array(
              z.object({
                roomTypeID: z.string().min(1),
                quantity: z.number().int().nonnegative(),
                roomID: z.string().optional(),
              }),
            )
            .min(1),

          // Booking-only payment declaration — NO card capture (api-contract §2.4).
          paymentMethod: z.enum(['cash', 'credit', 'ebanking', 'pay_pal']).default('cash'),

          // Consumer-supplied external reference for reconciliation (the consumer owns idempotency).
          thirdPartyIdentifier: z.string().optional(),

          // Misc
          estimatedArrivalTime: z.string().optional().describe('HH:mm 24h'),
          sendEmailConfirmation: z.boolean().optional().describe('Cloudbeds default is true'),
        })
        .strict(),
      handler: async (args, ctx) => {
        const res = await client.post('postReservation', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          ...args,
          // Booleans must reach the wire as strings; the rest is passed through verbatim.
          sendEmailConfirmation:
            args.sendEmailConfirmation === undefined
              ? undefined
              : String(args.sendEmailConfirmation),
        });
        const u = unwrap(res, 'postReservation');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_modify_reservation`,
      requiredScopes: ['write:reservation'], // spec: putReservation
      description:
        'Modify an existing reservation: cancel it (status: "canceled"), extend or shorten the stay ' +
        '(checkoutDate), change the rooms, or set the estimated arrival time. At least one of those ' +
        'must be given. NOTE: the check-in date CANNOT be changed — only the check-out date; to move ' +
        'a check-in, cancel and create a new reservation.',
      input: z
        .object({
          reservationID: z.string().min(1),
          status: z
            .string()
            .optional()
            .describe(
              'New reservation status — use "canceled" to cancel the booking. The property validates ' +
                'the value and rejects a transition it does not allow.',
            ),
          checkoutDate: z
            .string()
            .optional()
            .describe('New check-out date, YYYY-MM-DD (extends/shortens the stay).'),
          rooms: z
            .array(
              z.object({
                roomTypeID: z.string().min(1),
                quantity: z.number().int().positive(),
                roomID: z.string().optional(),
                roomRateID: z.string().optional(),
              }),
            )
            .optional(),
          estimatedArrivalTime: z.string().optional().describe('HH:mm 24h'),
        })
        .strict(),
      handler: async (args, ctx) => {
        // `putReservation` requires HTTP PUT and at least one mutable field; Cloudbeds names the exact
        // set in its own error, so we let it validate rather than duplicating that rule here.
        const res = await client.put('putReservation', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          ...args,
        });
        const u = unwrap(res, 'putReservation');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_rate_plans`,
      requiredScopes: ['read:rate'], // spec: getRatePlans
      description:
        'Get the priceable rate plans for a date range: per room type its rateID, total rate for the ' +
        'range and rooms available. Set detailedRates for a per-night breakdown (nightly rate plus ' +
        'stay restrictions such as minLos and closedToArrival). The rateID is what creating a ' +
        'reservation requires, and the nightly detail is what an accurate quote requires.',
      input: z
        .object({
          startDate: z.string().min(1),
          endDate: z.string().min(1),
          roomTypeID: z.string().optional(),
          detailedRates: z.boolean().optional(),
        })
        .strict(),
      handler: async (args, ctx) => {
        const res = await client.get('getRatePlans', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          startDate: args.startDate,
          endDate: args.endDate,
          roomTypeID: args.roomTypeID,
          // Cloudbeds reads this as a query string; send the wire value it expects.
          detailedRates: args.detailedRates === undefined ? undefined : String(args.detailedRates),
        });
        const u = unwrap(res, 'getRatePlans');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_list_room_types`,
      requiredScopes: ['read:room'], // spec: getRoomTypes
      description: 'List the room types configured for the property.',
      input: z.object({}).strict(),
      handler: async (_args, ctx) => {
        const res = await client.get('getRoomTypes', ctx.request, {
          propertyID: ctx.metadata.propertyID,
        });
        const u = unwrap(res, 'getRoomTypes');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_hotel_details`,
      requiredScopes: ['read:hotel'], // spec: getHotelDetails
      description: 'Get the property (hotel) details.',
      input: z.object({}).strict(),
      handler: async (_args, ctx) => {
        const res = await client.get('getHotelDetails', ctx.request, {
          propertyID: ctx.metadata.propertyID,
        });
        const u = unwrap(res, 'getHotelDetails');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_list_properties`,
      requiredScopes: ['read:hotel'], // spec: getHotels
      description:
        'List the properties (hotels) this connection can access. Needs no propertyID — used to discover which property to operate on.',
      input: z.object({}).strict(),
      handler: async (_args, ctx) => {
        // `getHotels` is token-scoped and takes no propertyID: it returns exactly the properties the
        // connection can see. This is the discovery entry point (see manifest.contextDiscovery).
        const res = await client.get('getHotels', ctx.request, {});
        const u = unwrap(res, 'getHotels');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_list_webhook_subscriptions`,
      requiredScopes: [], // spec: getWebhooks
      description:
        'List this property’s webhook subscriptions: per subscription its id, endpointUrl, object and ' +
        'action. Use it to check what is actually subscribed before changing anything.',
      input: z.object({}).strict(),
      handler: async (_args, ctx) => {
        const res = await client.get('getWebhooks', ctx.request, {
          propertyID: ctx.metadata.propertyID,
        });
        const u = unwrap(res, 'getWebhooks');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_ensure_webhook_subscription`,
      requiredScopes: [], // spec: postWebhook
      description:
        'Subscribe an endpoint URL to a property event. Idempotent: re-running with the same url, ' +
        'object and action returns the same subscription rather than adding a duplicate. ' +
        'IMPORTANT: Cloudbeds does NOT validate `action` — it accepts an unknown one and creates a ' +
        'subscription that never fires, so a success here does NOT prove the event exists. Only these ' +
        'have been observed to deliver: reservation/created, reservation/status_changed, ' +
        'guest/created, guest/assigned. Anything else must be confirmed by observing a real delivery.',
      input: z
        .object({
          endpointUrl: z.string().url().describe('Public HTTPS URL that will receive deliveries.'),
          object: z.string().min(1).describe('Event object, e.g. "reservation" or "guest".'),
          action: z.string().min(1).describe('Event action, e.g. "created" or "status_changed".'),
        })
        .strict(),
      handler: async (args, ctx) => {
        // `ensure`, not `create`: the subscriptionID is a deterministic hash of
        // (property, endpointUrl, object, action) — observed by deleting all subscriptions and
        // re-creating them, which returned byte-identical ids. So Cloudbeds itself dedupes, and the
        // honest verb is the idempotent one. Naming this `create` would invite callers to guard
        // against duplicates that cannot happen.
        const res = await client.post('postWebhook', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          ...args,
        });
        const u = unwrap(res, 'postWebhook');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_delete_webhook_subscription`,
      requiredScopes: [], // spec: deleteWebhook
      description:
        'Delete a webhook subscription by its id. The id is the `id` field returned by the list tool ' +
        '(the same value the subscribe tool returns as `subscriptionID`).',
      input: z.object({ subscriptionID: z.string().min(1) }).strict(),
      handler: async (args, ctx) => {
        // DELETE with query-string params — a DELETE body is not parsed (see `client.del`).
        const res = await client.del('deleteWebhook', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          subscriptionID: args.subscriptionID,
        });
        const u = unwrap(res, 'deleteWebhook');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),
  ];
}
