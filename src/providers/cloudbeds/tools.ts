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

    // ---- Sales group ------------------------------------------------------------------------------
    // Adds no new scope: read/write guest and reservation are already requested. Pure coverage — the
    // consent screen does not move.

    definePaginatedList({
      name: `mcp_${SLUG}_search_guests`,
      requiredScopes: ['read:guest'], // spec: getGuestList
      description:
        'Search the property’s guests by name, email, phone, or stay dates. Use it to find an existing ' +
        'guest before creating a new one, or to answer who is staying and when.',
      input: z.object({
        guestFirstName: z.string().optional(),
        guestLastName: z.string().optional(),
        guestEmail: z.string().optional(),
        guestPhone: z.string().optional(),
        status: z.string().optional().describe('Reservation status; comma-separate for several.'),
        checkInFrom: z.string().optional(),
        checkInTo: z.string().optional(),
        checkOutFrom: z.string().optional(),
        checkOutTo: z.string().optional(),
      }),
      handler: async (args, ctx) => {
        // `getGuestList` over `getGuestsByFilter`/`getGuestsByStatus` deliberately: it is the only one
        // of the three that paginates AND carries the rich filters, and its `status` is optional. The
        // other two are strictly weaker subsets — `getGuestsByFilter` has no paging at all, which is
        // how an unbounded guest list ends up in the agent's context (the `resultsPerPage` lesson).
        const res = await client.get('getGuestList', ctx.request, {
          // `propertyIDs` — plural, comma-separated — NOT the usual `propertyID`. From the spec.
          propertyIDs: ctx.metadata.propertyID,
          pageNumber: args.page,
          pageSize: args.pageSize,
          guestFirstName: args.guestFirstName,
          guestLastName: args.guestLastName,
          guestEmail: args.guestEmail,
          guestPhone: args.guestPhone,
          status: args.status,
          checkInFrom: args.checkInFrom,
          checkInTo: args.checkInTo,
          checkOutFrom: args.checkOutFrom,
          checkOutTo: args.checkOutTo,
        });
        const u = unwrap(res, 'getGuestList');
        if (!u.ok) return { ok: false, code: u.code, message: u.message };
        return { ok: true, items: Array.isArray(u.data) ? u.data : [], totalResults: u.total };
      },
    }),

    tool({
      name: `mcp_${SLUG}_update_guest`,
      requiredScopes: ['write:guest'], // spec: putGuest
      description:
        'Update an existing guest’s details (name, email, phone, address). Only the fields you send ' +
        'change. Use the guestID from a search or a reservation.',
      input: z
        .object({
          guestID: z.string().min(1),
          guestFirstName: z.string().optional(),
          guestLastName: z.string().optional(),
          guestEmail: z.string().email().optional(),
          guestPhone: z.string().optional(),
          guestCellPhone: z.string().optional(),
          guestAddress1: z.string().optional(),
          guestAddress2: z.string().optional(),
        })
        .strict(),
      handler: async (args, ctx) => {
        // `put*` → PUT. A `put*` method sent as POST is a router-level 404 (observed, see client.ts).
        const res = await client.put('putGuest', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          ...args,
        });
        const u = unwrap(res, 'putGuest');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_list_guest_notes`,
      requiredScopes: ['read:guest'], // spec: getGuestNotes
      description:
        'List the notes on a guest’s profile. Use it to recall preferences or past issues.',
      input: z.object({ guestID: z.string().min(1) }).strict(),
      handler: async (args, ctx) => {
        const res = await client.get('getGuestNotes', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          guestID: args.guestID,
        });
        const u = unwrap(res, 'getGuestNotes');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_add_guest_note`,
      requiredScopes: ['write:guest'], // spec: postGuestNote
      description:
        'Add a note to a guest’s profile — a preference, allergy, or anything staff should know next time.',
      input: z.object({ guestID: z.string().min(1), guestNote: z.string().min(1) }).strict(),
      handler: async (args, ctx) => {
        // `userID` exists on this method ("the actual user posting the note") and is NOT sent: a
        // connection is an app, not a staff member, and inventing one would attribute the note to a
        // person who did not write it.
        const res = await client.post('postGuestNote', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          guestID: args.guestID,
          guestNote: args.guestNote,
        });
        const u = unwrap(res, 'postGuestNote');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_list_reservation_notes`,
      requiredScopes: ['read:reservation'], // spec: getReservationNotes
      description: 'List the notes on a reservation. Use it to see what was agreed or flagged.',
      input: z.object({ reservationID: z.string().min(1) }).strict(),
      handler: async (args, ctx) => {
        const res = await client.get('getReservationNotes', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          reservationID: args.reservationID,
        });
        const u = unwrap(res, 'getReservationNotes');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_add_reservation_note`,
      requiredScopes: ['write:reservation'], // spec: postReservationNote
      description:
        'Add a note to a reservation — a special request or an agreement made with the guest.',
      input: z
        .object({ reservationID: z.string().min(1), reservationNote: z.string().min(1) })
        .strict(),
      handler: async (args, ctx) => {
        const res = await client.post('postReservationNote', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          reservationID: args.reservationID,
          reservationNote: args.reservationNote,
        });
        const u = unwrap(res, 'postReservationNote');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_assign_guest_to_room`,
      requiredScopes: ['write:guest'], // spec: postGuestsToRoom
      description:
        'Assign guests to a room already on a reservation, optionally promoting one to main guest. ' +
        'Use the roomID from the reservation, not a room number.',
      input: z
        .object({
          reservationID: z.string().min(1),
          roomID: z.number().int(),
          guestIDs: z.string().min(1).describe('Guest id, or several comma-separated.'),
          mainGuestId: z.string().optional().describe('Promote this guest to main guest.'),
        })
        .strict(),
      handler: async (args, ctx) => {
        // The destructive options this method also supports (`removeGuestIDs`, `removeAll`,
        // `removeGuestIDsFromRoom`) are deliberately NOT exposed: this tool adds. Removing guests from
        // a room needs its own decision, not an optional flag an agent can reach for mid-sentence.
        const res = await client.post('postGuestsToRoom', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          reservationID: args.reservationID,
          roomID: args.roomID,
          guestIDs: args.guestIDs,
          mainGuestId: args.mainGuestId,
        });
        const u = unwrap(res, 'postGuestsToRoom');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    // ---- Administrative group (read) -------------------------------------------------------------
    // Scope→method mapping taken from the published OpenAPI spec, not from memory:
    // github.com/cloudbeds/openapi-specs › src/pms-v1.3-openapi.yaml (`security` per operation).
    // See docs/design/cloudbeds-scope-coverage/tool-map.md for why these are the chosen groupings.

    tool({
      name: `mcp_${SLUG}_get_property_configuration`,
      // Four scopes, four single-GET endpoints, ONE question an agent actually asks: "how is this
      // property set up?". Splitting them would be four trivial tools competing for the agent's
      // attention — the curation trade-off this repo already documents (Shopify 490 → ~41).
      requiredScopes: [
        'read:appPropertySettings',
        'read:currency',
        'read:taxesAndFees',
        'read:customFields',
      ], // spec: getAppPropertySettings, getCurrencySettings, getTaxesAndFees, getCustomFields
      description:
        'Get how this property is configured: app settings, currency, taxes and fees, and custom ' +
        'fields. Use it before quoting prices or filling fields, so amounts and required data are right.',
      input: z.object({}).strict(),
      handler: async (_args, ctx) => {
        const { propertyID } = ctx.metadata;
        const parts = [
          { key: 'appSettings', method: 'getAppPropertySettings' },
          { key: 'currency', method: 'getCurrencySettings' },
          { key: 'taxesAndFees', method: 'getTaxesAndFees' },
          { key: 'customFields', method: 'getCustomFields' },
        ] as const;

        const data: Record<string, unknown> = {};
        const unavailable: Record<string, string> = {};
        for (const part of parts) {
          const u = unwrap(await client.get(part.method, ctx.request, { propertyID }), part.method);
          if (u.ok) data[part.key] = u.data;
          else unavailable[part.key] = u.message;
        }

        // Partial results are reported, never silently dropped: a property's PLAN can legitimately
        // lack one of these capabilities (the real meaning of Cloudbeds' "not granted by property"),
        // and failing all four because one is absent would make the tool useless for that hotel.
        // Everything failing is a real failure, not a partial one.
        if (Object.keys(data).length === 0) {
          return err(
            ProviderErrorCode.PROVIDER_ERROR,
            `No property configuration could be read: ${Object.values(unavailable).join(' | ')}`,
          );
        }
        return ok(
          Object.keys(unavailable).length > 0 ? { ...data, unavailable } : data,
          Object.keys(unavailable).length > 0
            ? `Partial: ${Object.keys(unavailable).join(', ')} unavailable for this property.`
            : undefined,
        );
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_payment_options`,
      requiredScopes: ['read:payment'], // spec: getPaymentMethods, getPaymentsCapabilities
      description:
        'Get the payment methods this property accepts and what it can do with payments. Use it ' +
        'before promising a guest a way to pay.',
      input: z.object({}).strict(),
      handler: async (_args, ctx) => {
        const { propertyID } = ctx.metadata;
        const methods = unwrap(
          await client.get('getPaymentMethods', ctx.request, { propertyID }),
          'getPaymentMethods',
        );
        if (!methods.ok) return err(methods.code, methods.message);
        const caps = unwrap(
          await client.get('getPaymentsCapabilities', ctx.request, { propertyID }),
          'getPaymentsCapabilities',
        );
        // Capabilities are supplementary: methods alone already answer "how can this guest pay?".
        return ok(
          caps.ok
            ? { methods: methods.data, capabilities: caps.data }
            : { methods: methods.data, capabilities: null, capabilitiesError: caps.message },
        );
      },
    }),

    tool({
      name: `mcp_${SLUG}_list_items`,
      requiredScopes: ['read:item'], // spec: getItems, getItemCategories
      description:
        'List the sellable items (extras, products) of this property and their categories. Use it to ' +
        'answer what can be added to a stay.',
      input: z
        .object({
          itemCategoryID: z.string().optional().describe('Restrict to one category.'),
        })
        .strict(),
      handler: async (args, ctx) => {
        const { propertyID } = ctx.metadata;
        const items = unwrap(
          await client.get('getItems', ctx.request, {
            propertyID,
            itemCategoryID: args.itemCategoryID,
          }),
          'getItems',
        );
        if (!items.ok) return err(items.code, items.message);
        const cats = unwrap(
          await client.get('getItemCategories', ctx.request, { propertyID }),
          'getItemCategories',
        );
        return ok(cats.ok ? { items: items.data, categories: cats.data } : { items: items.data });
      },
    }),

    tool({
      name: `mcp_${SLUG}_list_email_templates`,
      // Read-only on purpose. `write:communication` (creating templates/schedules) is deliberately NOT
      // built: an agent authoring a hotel's outbound email is real risk with no demonstrated use case.
      requiredScopes: ['read:communication'], // spec: getEmailTemplates, getEmailSchedule
      description:
        'List this property’s email templates and their send schedule. Read-only: use it to see what ' +
        'the property already sends guests automatically.',
      input: z.object({}).strict(),
      handler: async (_args, ctx) => {
        const { propertyID } = ctx.metadata;
        const templates = unwrap(
          await client.get('getEmailTemplates', ctx.request, { propertyID }),
          'getEmailTemplates',
        );
        if (!templates.ok) return err(templates.code, templates.message);
        const schedule = unwrap(
          await client.get('getEmailSchedule', ctx.request, { propertyID }),
          'getEmailSchedule',
        );
        return ok(
          schedule.ok
            ? { templates: templates.data, schedule: schedule.data }
            : { templates: templates.data },
        );
      },
    }),

    tool({
      name: `mcp_${SLUG}_list_users`,
      requiredScopes: ['read:user'], // spec: getUsers
      description:
        'List the staff users of this property. Use it to know who can be assigned or contacted.',
      input: z.object({}).strict(),
      handler: async (_args, ctx) => {
        // `property_ids` — snake_case AND plural, unlike every other method's `propertyID`. Taken from
        // the spec, not from the surrounding convention, which would have been wrong here.
        const res = await client.get('getUsers', ctx.request, {
          property_ids: ctx.metadata.propertyID,
        });
        const u = unwrap(res, 'getUsers');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    // ---- Groups (administrative) ------------------------------------------------------------------
    // ⚠️ `putGroup` and `patchGroup` are **POST** endpoints, not PUT — the verb is not derivable from
    // the method name (see `client.ts` › put). Written from the spec, per method.

    definePaginatedList({
      name: `mcp_${SLUG}_list_groups`,
      requiredScopes: ['read:group'], // spec: getGroups
      description:
        'List the property’s groups (block bookings for a company, wedding, event or tour). Use it to ' +
        'answer what group business the property holds.',
      input: z.object({
        groupCode: z.string().optional(),
        type: z.string().optional().describe('The type of group.'),
        status: z.string().optional(),
        createdFrom: z.string().optional().describe('YYYY-MM-DD'),
        createdTo: z.string().optional().describe('YYYY-MM-DD'),
      }),
      handler: async (args, ctx) => {
        const res = await client.get('getGroups', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          pageNumber: args.page,
          pageSize: args.pageSize,
          groupCode: args.groupCode,
          type: args.type,
          status: args.status,
          createdFrom: args.createdFrom,
          createdTo: args.createdTo,
        });
        const u = unwrap(res, 'getGroups');
        if (!u.ok) return { ok: false, code: u.code, message: u.message };
        return { ok: true, items: Array.isArray(u.data) ? u.data : [], totalResults: u.total };
      },
    }),

    definePaginatedList({
      name: `mcp_${SLUG}_list_group_notes`,
      requiredScopes: ['read:group'], // spec: getGroupNotes
      description: 'List the notes on a group. Use it to see what was agreed with the organiser.',
      input: z.object({ groupCode: z.string().min(1) }),
      handler: async (args, ctx) => {
        // Unusually, `pageSize`/`pageNumber` are REQUIRED here (spec) — the uniform contract already
        // supplies both with defaults, so this is free rather than a special case.
        const res = await client.get('getGroupNotes', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          groupCode: args.groupCode,
          pageNumber: args.page,
          pageSize: args.pageSize,
        });
        const u = unwrap(res, 'getGroupNotes');
        if (!u.ok) return { ok: false, code: u.code, message: u.message };
        return { ok: true, items: Array.isArray(u.data) ? u.data : [], totalResults: u.total };
      },
    }),

    tool({
      name: `mcp_${SLUG}_update_group`,
      requiredScopes: ['write:group'], // spec: patchGroup
      description:
        'Update an existing group’s details (name, type, status, address). Only the fields you send ' +
        'change. Get the groupCode from list_groups.',
      input: z
        .object({
          groupCode: z.string().min(1),
          name: z.string().optional(),
          type: z.string().optional(),
          status: z.string().optional(),
          sourceID: z.string().optional(),
          address1: z.string().optional(),
          address2: z.string().optional(),
        })
        .strict(),
      handler: async (args, ctx) => {
        // POST, despite the name — `patchGroup` is declared POST in the spec. `patchGroup` over
        // `putGroup` because this is a partial update: putGroup takes no groupCode and replaces.
        const res = await client.post('patchGroup', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          ...args,
        });
        const u = unwrap(res, 'patchGroup');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_add_group_note`,
      requiredScopes: ['write:group'], // spec: postGroupNote
      description:
        'Add a note to a group — something agreed with the organiser that staff should know.',
      input: z.object({ groupCode: z.string().min(1), groupNote: z.string().min(1) }).strict(),
      handler: async (args, ctx) => {
        const res = await client.post('postGroupNote', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          groupCode: args.groupCode,
          groupNote: args.groupNote,
        });
        const u = unwrap(res, 'postGroupNote');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    // ---- Revenue / inventory group ----------------------------------------------------------------

    tool({
      name: `mcp_${SLUG}_get_dashboard`,
      requiredScopes: ['read:dashboard'], // spec: getDashboard
      description:
        'Get the property’s dashboard for a date: the day’s headline numbers (arrivals, departures, ' +
        'occupancy and revenue as the PMS reports them). Use it to answer "how are we doing".',
      input: z
        .object({
          date: z.string().optional().describe('YYYY-MM-DD. Defaults to the property’s today.'),
        })
        .strict(),
      handler: async (args, ctx) => {
        const res = await client.get('getDashboard', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          date: args.date,
        });
        const u = unwrap(res, 'getDashboard');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    definePaginatedList({
      name: `mcp_${SLUG}_list_room_blocks`,
      requiredScopes: ['read:roomblock'], // spec: getRoomBlocks
      description:
        'List room blocks — rooms held out of sale (blocked, out of service, or on courtesy hold). ' +
        'Use it to explain why a room is unavailable when availability looks wrong.',
      input: z.object({
        roomBlockID: z.string().optional(),
        roomTypeID: z.string().optional(),
        roomID: z.string().optional(),
        startDate: z.string().optional().describe('YYYY-MM-DD. Defaults to today.'),
        endDate: z.string().optional().describe('YYYY-MM-DD. Defaults to today.'),
      }),
      handler: async (args, ctx) => {
        const res = await client.get('getRoomBlocks', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          pageNumber: args.page,
          pageSize: args.pageSize,
          roomBlockID: args.roomBlockID,
          roomTypeID: args.roomTypeID,
          roomID: args.roomID,
          startDate: args.startDate,
          endDate: args.endDate,
        });
        const u = unwrap(res, 'getRoomBlocks');
        if (!u.ok) return { ok: false, code: u.code, message: u.message };
        return { ok: true, items: Array.isArray(u.data) ? u.data : [], totalResults: u.total };
      },
    }),

    tool({
      name: `mcp_${SLUG}_create_room_block`,
      requiredScopes: ['write:roomblock'], // spec: postRoomBlock
      description:
        'Hold rooms out of sale for a date range — a maintenance block, an out-of-service room, or a ' +
        'courtesy hold. Rooms sent together share one block.',
      input: z
        .object({
          roomBlockType: z.enum(['blocked_dates', 'out_of_service', 'courtesy_hold']),
          roomBlockReason: z.string().min(1),
          startDate: z.string().min(1).describe('YYYY-MM-DD'),
          endDate: z.string().min(1).describe('YYYY-MM-DD'),
          rooms: z
            .array(z.object({ roomID: z.string(), roomTypeID: z.string() }))
            .min(1)
            .describe('Rooms to block. For split inventory send only source rooms.'),
          firstName: z.string().optional().describe('Courtesy holds: who the hold is for.'),
          lastName: z.string().optional(),
          lengthOfHoldInHours: z.number().int().positive().optional(),
        })
        .strict(),
      handler: async (args, ctx) => {
        // `rooms` rides the PHP-style bracketed encoding the client already implements
        // (`rooms[0][roomID]=…`) — the same shape `create_reservation` proved against the sandbox.
        const res = await client.post('postRoomBlock', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          ...args,
        });
        const u = unwrap(res, 'postRoomBlock');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_update_room_block`,
      requiredScopes: ['write:roomblock'], // spec: putRoomBlock
      description:
        'Change an existing room block: its reason, dates, or the rooms it covers. Get the ' +
        'roomBlockID from list_room_blocks.',
      input: z
        .object({
          roomBlockID: z.string().min(1),
          roomBlockReason: z.string().optional(),
          startDate: z.string().optional().describe('YYYY-MM-DD'),
          endDate: z.string().optional().describe('YYYY-MM-DD'),
          rooms: z.array(z.object({ roomID: z.string(), roomTypeID: z.string() })).optional(),
          lengthOfHoldInHours: z.number().int().positive().optional(),
        })
        .strict(),
      handler: async (args, ctx) => {
        // `put*` → PUT (a `put*` sent as POST is a router-level 404 — observed; see client.ts).
        const res = await client.put('putRoomBlock', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          ...args,
        });
        const u = unwrap(res, 'putRoomBlock');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    definePaginatedList({
      name: `mcp_${SLUG}_list_allotment_blocks`,
      requiredScopes: ['read:allotmentBlock'], // spec: getAllotmentBlocks
      description:
        'List allotment blocks — room inventory reserved for a group, event, or contract. Use it to ' +
        'see what is committed elsewhere before promising rooms.',
      input: z.object({
        allotmentBlockCode: z.string().optional(),
        allotmentBlockName: z.string().optional(),
        allotmentBlockStatus: z.string().optional().describe('Comma-separate for several.'),
        groupCode: z.string().optional(),
        roomTypeID: z.string().optional(),
        startDate: z.string().optional().describe('YYYY-MM-DD'),
        endDate: z.string().optional().describe('YYYY-MM-DD'),
      }),
      handler: async (args, ctx) => {
        const res = await client.get('getAllotmentBlocks', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          pageNumber: args.page,
          pageSize: args.pageSize,
          allotmentBlockCode: args.allotmentBlockCode,
          allotmentBlockName: args.allotmentBlockName,
          allotmentBlockStatus: args.allotmentBlockStatus,
          groupCode: args.groupCode,
          roomTypeID: args.roomTypeID,
          startDate: args.startDate,
          endDate: args.endDate,
        });
        const u = unwrap(res, 'getAllotmentBlocks');
        if (!u.ok) return { ok: false, code: u.code, message: u.message };
        return { ok: true, items: Array.isArray(u.data) ? u.data : [], totalResults: u.total };
      },
    }),

    // NOT built yet — allotment WRITES and allotment NOTES. The spec declares
    // `createAllotmentBlockNotes` / `updateAllotmentBlockNotes` as POST but under **read**
    // :allotmentBlock. Either the spec is wrong or Cloudbeds writes under a read scope; copying it
    // blind would put that error into our contract, and `requiredScopes` is exactly the field a wrong
    // copy corrupts. Settle it against the property first — see tool-map.md §6.

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
