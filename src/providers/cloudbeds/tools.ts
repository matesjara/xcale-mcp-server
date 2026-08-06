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
 * Classify a Cloudbeds `success:false` envelope into a typed error code by its `message`.
 *
 * Cloudbeds signals a **scope/permission denial as HTTP 200 + `success:false`**, never 401/403
 * (e.g. `"Scope required for this call was not granted by property."`). `mapHttpStatusToErrorCode`
 * therefore never fires for the dominant auth failure, so the classification has to happen on the
 * envelope here — otherwise a denied scope reaches the consumer as an opaque `PROVIDER_ERROR` and
 * the "reconnect required" signal (`AUTH_EXPIRED`) is never raised (soul.md priority #2). Matching
 * is on the message because that is the only discriminator Cloudbeds gives us; it is deliberately
 * conservative — anything unrecognized stays `PROVIDER_ERROR` rather than being mislabeled.
 */
function classifyEnvelopeFailure(message: string | undefined): ProviderErrorCode {
  const m = (message ?? '').toLowerCase();
  // Scope/permission/token → the connection must be re-authorized. This is the reconnect path.
  //
  // `access to property` is the REVOKED-APP case, and it earns its own mention because it looks like
  // none of the others. OBSERVED 2026-08-05: the property disconnected the app from its Manage Apps
  // page, and every call then answered `success:false` with **"You don't have access to property ID"**
  // — no 401, no "scope", no "token". It fell through to PROVIDER_ERROR, so a revoked app produced an
  // opaque failure on every tool instead of "reconnect required", and the app-state handler could not
  // tell a disconnection from a provider hiccup (it read `unknown` and correctly did nothing).
  //
  // The known ambiguity, stated rather than hidden: a token whose metadata carries the WRONG
  // propertyID answers the same way, and that is a consumer bug, not a revocation. AUTH_EXPIRED is
  // still the better of the two — it surfaces as an actionable reconnect instead of an opaque error,
  // and a wrong propertyID fails at connect time, not mid-life.
  if (/\bscope\b|permission|not granted|unauthor|forbidden|\btoken\b|access to property/.test(m)) {
    return ProviderErrorCode.AUTH_EXPIRED;
  }
  // Caller-fixable input problems → the agent can correct and retry.
  if (/required|invalid|missing|must be|not valid|malformed/.test(m)) {
    return ProviderErrorCode.INVALID_INPUT;
  }
  return ProviderErrorCode.PROVIDER_ERROR;
}

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
      code: classifyEnvelopeFailure(body.message),
      message: body.message ?? `Cloudbeds ${method} returned success=false`,
    };
  }
  const data = body && 'data' in body ? body.data : body;
  return body?.total !== undefined ? { ok: true, data, total: body.total } : { ok: true, data };
}

/**
 * Trust guard for **Payments v2** 2xx responses (pay-by-link). v2 is documented to answer JSON
 * directly with failures as HTTP status — but that shape is NOT yet confirmed against a live call
 * (the payments sandbox is blocked), and this same vendor's v1.3 API reports failures as HTTP 200 +
 * `success:false`. On a money-moving path a mislabeled failure is the worst outcome, so a 2xx only
 * becomes `ok` when the body (a) is not a `success:false` envelope and (b) carries the fields the
 * tool contract promises. Anything else surfaces as a typed error, never a silent false success
 * (soul.md priority #2). Once the happy path is confirmed live, relax to the observed shape.
 */
function unwrapPayments(
  res: RequestResult,
  what: string,
  requiredFields: readonly string[],
): Unwrapped {
  if (!res.ok) {
    return {
      ok: false,
      code: res.errorCode,
      message: `Cloudbeds ${what} failed (HTTP ${res.status})`,
    };
  }
  const body = res.data as Record<string, unknown> | null;
  if (body && body['success'] === false) {
    const message = typeof body['message'] === 'string' ? body['message'] : undefined;
    return {
      ok: false,
      code: classifyEnvelopeFailure(message),
      message: message ?? `Cloudbeds ${what} returned success=false`,
    };
  }
  const missing = requiredFields.filter((field) => body?.[field] === undefined);
  if (!body || missing.length > 0) {
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: `Cloudbeds ${what} returned an unexpected response shape (missing: ${missing.join(', ') || 'body'})`,
    };
  }
  return { ok: true, data: body };
}

/**
 * An https URL, enforced by the schema rather than by a handler.
 *
 * A webhook `endpointUrl` is where a property's guest names, emails and stay dates get delivered, and
 * the per-connection secret rides in its path. `z.string().url()` alone accepts `http://` and
 * `javascript:` — so the scheme is checked here, at the one place a caller cannot skip.
 */
const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith('https://'), {
    message: 'must be an https URL — a webhook endpoint carries guest data and a path secret',
  });

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
      description:
        'List reservations for the property, filtered by status and/or by check-in or check-out ' +
        'dates. The three date/status combinations cover the three moments of a stay: arriving ' +
        '(checkInFrom/checkInTo), in-house (status=checked_in), and departed ' +
        '(checkedOutFrom/checkedOutTo with status=checked_out).',
      input: z.object({
        status: z.string().optional(),
        checkInFrom: z.string().optional(),
        checkInTo: z.string().optional(),
        // The departed window. Same shape as the check-in pair and it costs two lines, but without
        // it the post-stay moment is unreachable: filtering `status=checked_out` alone returns every
        // guest who ever left, and a consumer would have to page the whole history to find
        // yesterday's departures. Cloudbeds' own guest-communication blueprint names these two as
        // the post-departure filter.
        checkedOutFrom: z.string().optional(),
        checkedOutTo: z.string().optional(),
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
          checkedOutFrom: args.checkedOutFrom,
          checkedOutTo: args.checkedOutTo,
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
      description:
        'Get one reservation in full by its reservationID: status, stay dates, rooms, guests and ' +
        'totals. Use it to answer anything about a specific booking, and to read back what was just ' +
        'created. To find a reservation without its id, use list_reservations.',
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
      description:
        'Get one guest by their guestID: name, contact details and profile. Use it when you already ' +
        'hold the id (from a reservation, or from search_guests). To find a guest you do NOT have an ' +
        'id for, use search_guests instead.',
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
      // The most-called tool of the booking path, and it used to say only "Get available room types for
      // a date range" — so what it RETURNS had to be taught in the consumer's prompt instead ("take the
      // photos from roomTypePhotos, use the `image` field…"). That is provider knowledge living in the
      // consumer. It belongs here, where it is written once for every consumer.
      description:
        'Get what can actually be sold for a date range: per room type, its roomTypeID, name, how many ' +
        'rooms are free, the rate, and its official photos in `roomTypePhotos` (each with an `image` ' +
        'URL). Availability and price BOTH depend on the dates, so ask for check-in and check-out ' +
        'before calling. This is the only truth about what is free — never infer it from anything else.',
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
      description:
        'List every room type the property has configured, with its description and capacity — the ' +
        'catalogue, regardless of dates. It says nothing about what is FREE or what it costs: for that ' +
        'use get_availability. Use this to describe a room, not to sell it.',
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
      description:
        'Get the hotel itself: address, contact, check-in/out times, policies and amenities. Use it to ' +
        'answer questions about the property rather than about a room — "do you have parking?", "what ' +
        'time is check-in?", "where are you?".',
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
        const failureCodes: ProviderErrorCode[] = [];
        for (const part of parts) {
          const u = unwrap(await client.get(part.method, ctx.request, { propertyID }), part.method);
          if (u.ok) data[part.key] = u.data;
          else {
            unavailable[part.key] = u.message;
            failureCodes.push(u.code);
          }
        }

        // Partial results are reported, never silently dropped: a property's PLAN can legitimately
        // lack one of these capabilities (the real meaning of Cloudbeds' "not granted by property"),
        // and failing all four because one is absent would make the tool useless for that hotel.
        // Everything failing is a real failure, not a partial one.
        if (Object.keys(data).length === 0) {
          // If every read failed on auth (an ungranted scope on a token that predates a scope bump),
          // surface the reconnect signal — not an opaque PROVIDER_ERROR (soul.md priority #2).
          const code = failureCodes.every((c) => c === ProviderErrorCode.AUTH_EXPIRED)
            ? ProviderErrorCode.AUTH_EXPIRED
            : ProviderErrorCode.PROVIDER_ERROR;
          return err(
            code,
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

    /*
     * ─── Cloudbeds Pay-by-Link (Payments v2) ──────────────────────────────────────────────────────
     *
     * A DIFFERENT API surface from every tool above: base `api.cloudbeds.com/payments/v2`, JSON, and a
     * mandatory `X-Property-Id` header (see `client.postPayments`/`getPayments`). The guest pays on
     * Cloudbeds' own hosted page — xcale never sees the card (the hard constraint, research §0).
     *
     * SCOPE (resolved — was open question #1). Pay-by-link v2 authenticates by **Bearer JWT + the app's
     * "API and Integration" role**, NOT a nominal v1.3 OAuth scope. There is no registered `write:payment`
     * scope, and declaring one would fail `scopes.test.ts` AND inject an unrequestable scope into the
     * authorize URL — breaking connect for every consumer and forcing a costly reconnect. So these tools
     * declare `requiredScopes: []` ("authenticates, needs no specific scope"), exactly the Cloudbeds
     * `OAuth2: []` precedent. The consent screen does not move.
     *
     * The v2 response is JSON DIRECTLY (`{ url, id, … }`), not the v1.3 `{ success, data }` envelope, so
     * `unwrap()` is NOT used here — failures are expected as HTTP status (401/403 already mapped to
     * AUTH_EXPIRED by the transport). BUT that expectation is unconfirmed against a live call (the
     * payments sandbox is blocked), and this same vendor's v1.3 API reports failures as HTTP 200 +
     * `success:false`. Money moves through these tools, so a 2xx is trusted only through
     * `unwrapPayments` — see its doc comment.
     */
    tool({
      name: `mcp_${SLUG}_create_payment_link`,
      requiredScopes: [], // Bearer + role, not a nominal scope — see the block comment above.
      description:
        // Consumer-agnostic wording — this string is published verbatim via tools/list to ANY
        // MCP client, so no consumer name may appear here (soul.md litmus test).
        'Create a Cloudbeds hosted pay-by-link for a reservation so the guest can pay online (the ' +
        'guest enters the card on Cloudbeds’ own page — the card never passes through this server ' +
        'or its consumers). Only usable when the property has Cloudbeds Payments with pay-by-link ' +
        'enabled (check get_payment_options first).',
      input: z
        .object({
          reservationID: z
            .string()
            .min(1)
            .describe('The reservation (confirmation number) to charge.'),
          amount: z
            .number()
            .positive()
            .describe('Amount to collect, > 0, in the property currency.'),
          description: z
            .string()
            .max(255)
            .optional()
            .describe('Shown to the guest on the payment page.'),
          expiresAfterDays: z
            .number()
            .int()
            .min(0)
            .max(30)
            .optional()
            .describe('Days until the link expires (0-30, default 7).'),
          authOnly: z
            .boolean()
            .optional()
            .describe('true = place an authorization hold instead of charging (default false).'),
        })
        .strict(),
      handler: async (args, ctx) => {
        const { propertyID } = ctx.metadata;
        const res = await client.postPayments(
          ['pay-by-link'],
          ctx.request,
          {
            paid: args.amount,
            inventoryObject: { type: 'confirmation_number', id: args.reservationID },
            propertyId: propertyID,
            description: args.description,
            auth_payment: args.authOnly ?? false,
            expires_after: args.expiresAfterDays ?? 7,
          },
          { 'X-Property-Id': propertyID },
        );
        // The link's url + id are the whole point of the call — a 2xx without them is a failure.
        const u = unwrapPayments(res, 'create pay-by-link', ['url', 'id']);
        if (!u.ok) return err(u.code, u.message);
        // Verbatim, like every other tool (fidelity over remodeling): { url, id, expires_at }.
        return ok(u.data);
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_payment_link_status`,
      requiredScopes: [], // Bearer + role, not a nominal scope — see the block comment above.
      description:
        'Get the current status of a pay-by-link (SENT | VIEWED | PAID | EXPIRED | CANCELLED | ' +
        '3DSPROCESSING) and whether it has been paid. Use it to confirm a guest completed payment.',
      input: z
        .object({
          linkId: z
            .string()
            // The id becomes ONE URL path segment. Alnum + dashes covers the observed UUID shape and
            // excludes every path/query metacharacter (`/ ? # . %`), so a crafted id cannot select a
            // sibling Payments endpoint (on top of the client's per-segment encoding).
            .regex(/^[A-Za-z0-9-]+$/, 'linkId must contain only letters, digits, and dashes')
            .describe('The pay-by-link id returned at creation.'),
        })
        .strict(),
      handler: async (args, ctx) => {
        const { propertyID } = ctx.metadata;
        const res = await client.getPayments(['pay-by-link', args.linkId], ctx.request, {
          'X-Property-Id': propertyID,
        });
        // `payByLinkStatus` is what the consumer's guardrail reads — a 2xx without it is a failure.
        const u = unwrapPayments(res, 'get pay-by-link status', ['payByLinkStatus']);
        if (!u.ok) return err(u.code, u.message);
        return ok(u.data);
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

    /*
     * ─── NOT BUILT ON PURPOSE: `post_adjustment` (`write:adjustment`) ─────────────────────────────
     *
     * PAUSED 2026-07-15 by JuanJo, financial. This is the note for whoever comes back to it — read it
     * before deciding it is an easy win, because from the outside it looks like one: the scope is
     * authorized and it is a single endpoint.
     *
     * WHAT IT DOES. `postAdjustment` — "Adds an adjustment to a reservation" (`reservationID`, `amount`,
     * `type`, `notes`). A line on the guest's folio: a charge or a discount. It changes what a real
     * person owes. In a conversation it reads as "te aplico 10% de descuento" or "te cargo el minibar".
     *
     * WHY IT IS NOT SAFE TO BUILD **TODAY** — three facts, all verified against the published spec and
     * our app registration, not assumed:
     *
     *   1. WE COULD NOT UNDO IT. `deleteAdjustment` ("voids the AdjustmentID transaction") requires
     *      `delete:adjustment`. That scope EXISTS in Cloudbeds' vocabulary and is NOT among our 32
     *      registered scopes (see `REGISTERED_SCOPES` in auth.ts). So we could post a charge and never
     *      void it through the API. Only a human in the Cloudbeds panel could.
     *   2. WE COULD NOT EVEN READ THEM BACK. `read:adjustment` is authorized, but NO published endpoint
     *      declares it — one of the three orphan scopes (docs/design/cloudbeds-scope-coverage). The
     *      agent cannot list a reservation's adjustments to check its own work.
     *   3. ⇒ It would be a BLIND, IRREVERSIBLE write on someone's bill. Post it, cannot verify it,
     *      cannot correct it, and nobody notices until the guest reads the invoice.
     *
     * WHY "ASK THE GUEST FIRST" DOES NOT FIX IT. The instinct is to gate it behind a confirmation. But
     * confirmation answers *when* it fires, and nothing above is about timing: a "yes" does not make a
     * blind irreversible operation reversible or visible. (It is also the wrong person — a charge is the
     * hotel's decision, not the guest's.)
     *
     * The refusal is not fear of the agent. It is that the provider has not given us the pieces to do it
     * properly. Note what the refusal costs: nothing, and it enforces itself — NOT building the tool is
     * what stops `write:adjustment` being requested (scopes are derived; see ADR tool-derived-oauth-scopes).
     * It never reaches any hotel's consent screen.
     *
     * TO REOPEN, in this order: (1) register `delete:adjustment` in App Details, (2) find out whether
     * `read:adjustment` has an endpoint at all (ask Cloudbeds — it cannot be settled from the spec).
     * With verification and an undo, the design conversation becomes a real one. Until then this is a
     * feature with its own decision, not a leftover on a list.
     */

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

    tool({
      name: `mcp_${SLUG}_create_allotment_block`,
      requiredScopes: ['write:allotmentBlock'], // spec: createAllotmentBlock
      description:
        'Create an allotment block — inventory held for a group, event or contract, so it is not sold ' +
        'to anyone else. Get the rate plan from get_rate_plans and the group from list_groups.',
      input: z
        .object({
          allotmentBlockName: z.string().min(1),
          groupCode: z.string().optional().describe('The group this block belongs to.'),
          eventCode: z.string().optional(),
          ratePlanId: z.string().optional(),
          rateType: z.string().optional(),
          allotmentType: z.string().optional(),
          allotmentBlockStatus: z.string().optional(),
        })
        .strict(),
      handler: async (args, ctx) => {
        const res = await client.post('createAllotmentBlock', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          ...args,
        });
        const u = unwrap(res, 'createAllotmentBlock');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_update_allotment_block`,
      requiredScopes: ['write:allotmentBlock'], // spec: updateAllotmentBlock
      description:
        'Change an existing allotment block: its name, status, overbooking or auto-release. Get the ' +
        'allotmentBlockCode from list_allotment_blocks.',
      input: z
        .object({
          allotmentBlockCode: z.string().min(1),
          allotmentBlockName: z.string().optional(),
          allotmentBlockStatus: z.string().optional(),
          allotmentType: z.string().optional(),
          allowOverbooking: z.boolean().optional(),
          autoRelease: z.boolean().optional(),
        })
        .strict(),
      handler: async (args, ctx) => {
        // POST — `updateAllotmentBlock` is a POST endpoint (spec). No `put*` prefix to mislead here,
        // but the same rule applies: read the verb, never infer it.
        const res = await client.post('updateAllotmentBlock', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          ...args,
        });
        const u = unwrap(res, 'updateAllotmentBlock');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    definePaginatedList({
      name: `mcp_${SLUG}_list_allotment_block_notes`,
      requiredScopes: ['read:allotmentBlock'], // spec: listAllotmentBlockNotes
      description:
        'List the notes on an allotment block — what was agreed about that held inventory.',
      input: z.object({ allotmentBlockCode: z.string().min(1) }),
      handler: async (args, ctx) => {
        const res = await client.get('listAllotmentBlockNotes', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          allotmentBlockCode: args.allotmentBlockCode,
          pageNumber: args.page,
          pageSize: args.pageSize,
        });
        const u = unwrap(res, 'listAllotmentBlockNotes');
        if (!u.ok) return { ok: false, code: u.code, message: u.message };
        return { ok: true, items: Array.isArray(u.data) ? u.data : [], totalResults: u.total };
      },
    }),

    tool({
      name: `mcp_${SLUG}_add_allotment_block_note`,
      /**
       * ⚠️ The spec declares `createAllotmentBlockNotes` — a POST that WRITES — under
       * **read**:allotmentBlock. `write` is declared here anyway, deliberately.
       *
       * We tried to settle it (`probe allotment`) with the one token that could: it carries
       * `read:allotmentBlock` and NOT `write:allotmentBlock`, so success or denial would have been
       * unambiguous. The property has **zero allotment blocks**, so there is nothing to attach a note
       * to and the run is INCONCLUSIVE — and it cannot be broken out of, because creating a block to
       * test with needs the very scope in question.
       *
       * So: same asymmetric bet as `create_reservation`'s `write:guest`. This spec has already been
       * caught omitting a real scope (`read:adjustment` appears in no `security` block yet the scope
       * exists), a write declaring only read is the likelier error, and the extra scope costs nothing
       * — its siblings above already request `write:allotmentBlock`. Drop it only once a run under
       * read alone is OBSERVED to succeed.
       */
      requiredScopes: ['read:allotmentBlock', 'write:allotmentBlock'], // spec says read only — see above
      description:
        'Add a note to an allotment block — something agreed about that held inventory that staff ' +
        'should know.',
      input: z.object({ allotmentBlockCode: z.string().min(1), text: z.string().min(1) }).strict(),
      handler: async (args, ctx) => {
        const res = await client.post('createAllotmentBlockNotes', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          allotmentBlockCode: args.allotmentBlockCode,
          text: args.text,
        });
        const u = unwrap(res, 'createAllotmentBlockNotes');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    // NOT built: `deleteAllotmentBlock`. Deleting held inventory for a group is not a conversational
    // move — it is an operations decision with real money behind it, and it deserves its own call.

    // ── Control plane ────────────────────────────────────────────────────────────────────────────
    //
    // Everything below is `controlPlane: true`: callable by the consumer over the same authenticated
    // transport, WITHDRAWN from tools/list. They are infrastructure the consumer performs on its own
    // behalf (subscribe my receiver, disable my app), never a move an agent makes for a guest.
    //
    // This is the boundary the earlier withdrawal asked for. Those three webhook tools were published
    // as agent surface, and the review that pulled them named the reasons: the `endpointUrl` is a
    // bearer credential (Cloudbeds deliveries carry no signature — cloudbeds-provider/
    // functional-design.md §7), a `list` tool returned it verbatim into agent context, `endpointUrl`
    // accepted any scheme or host so guest-authored text could re-point the property's event stream,
    // and a `delete` tool let the agent unhook the consumer's own receiver. Each of those is a
    // sentence about the AGENT. Taking the agent out of the reach is a stronger answer than a consent
    // gate on an agent tool, so:
    //
    //   - No `list` tool at all. Nothing returns an `endpointUrl` to any caller; `remove` takes the
    //     url the consumer already holds and answers with a count.
    //   - `endpointUrl` must be https (a plaintext event stream carries guest names, emails and stay
    //     dates), and only the consumer can supply one, because only the consumer can call these.
    //   - `requiredScopes: []` throughout — the spec declares these methods `OAuth2: []`, so the
    //     authorize URL and every hotel's consent screen are unchanged by this file.

    tool({
      name: `mcp_${SLUG}_get_app_state`,
      controlPlane: true,
      requiredScopes: [], // spec: getAppState
      description:
        'CONTROL PLANE — read whether this app is still enabled for the property. An error (or a ' +
        'token/permission failure) means the property has disconnected the app on Cloudbeds’ side. ' +
        'This is the poll half of Cloudbeds’ connect/disconnect contract; the push half is the ' +
        '`appstate_changed` webhook.',
      input: z.object({}).strict(),
      handler: async (_args, ctx) => {
        const res = await client.get('getAppState', ctx.request, {
          propertyID: ctx.metadata.propertyID,
        });
        const u = unwrap(res, 'getAppState');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_set_app_state`,
      controlPlane: true,
      requiredScopes: [], // spec: postAppState
      description:
        'CONTROL PLANE — tell Cloudbeds this app is enabled or disabled for the property. Sending ' +
        '`disabled` is what a disconnect performed in OUR UI must do: Cloudbeds then removes the app ' +
        'from the property’s Manage Apps page and terminates every session. ' +
        'ORDER MATTERS: this call is one-way. Once it returns, no further call on this token ' +
        'succeeds, so any other teardown (removing webhook subscriptions) must happen BEFORE it.',
      input: z
        .object({
          appState: z
            .enum(['enabled', 'disabled'])
            .describe('Cloudbeds spells the wire field `app_state`; this is that value.'),
        })
        .strict(),
      handler: async (args, ctx) => {
        const res = await client.post('postAppState', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          app_state: args.appState,
        });
        const u = unwrap(res, 'postAppState');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_ensure_webhook_subscription`,
      controlPlane: true,
      requiredScopes: [], // spec: postWebhook
      description:
        'CONTROL PLANE — subscribe the consumer’s own receiver to a property event. Idempotent: ' +
        'Cloudbeds derives the subscription id from (property, endpointUrl, object, action), so ' +
        're-running with the same four returns the same subscription rather than adding a duplicate. ' +
        'IMPORTANT: Cloudbeds does NOT validate `action` — it accepts an unknown one and creates a ' +
        'subscription that never fires, so a success here does NOT prove the event exists. Only these ' +
        'have been observed to deliver: reservation/created, reservation/status_changed, ' +
        'guest/created, guest/assigned. Anything else must be confirmed by observing a real delivery.',
      input: z
        .object({
          endpointUrl: httpsUrl.describe('Public HTTPS URL that will receive deliveries.'),
          object: z.string().min(1).describe('Event object, e.g. "reservation" or "integration".'),
          action: z
            .string()
            .min(1)
            .describe('Event action, e.g. "status_changed" or "appstate_changed".'),
        })
        .strict(),
      handler: async (args, ctx) => {
        const res = await client.post('postWebhook', ctx.request, {
          propertyID: ctx.metadata.propertyID,
          ...args,
        });
        const u = unwrap(res, 'postWebhook');
        return u.ok ? ok(u.data) : err(u.code, u.message);
      },
    }),

    tool({
      name: `mcp_${SLUG}_remove_webhook_subscriptions`,
      controlPlane: true,
      requiredScopes: [], // spec: getWebhooks + deleteWebhook
      description:
        'CONTROL PLANE — delete every subscription on this property that points at the given ' +
        'endpoint URL, and answer with how many. Used on disconnect: a subscription left behind ' +
        'outlives the connection and keeps delivering to a receiver that can no longer authenticate ' +
        'it. Takes the url rather than an id because the caller knows its own url, and no id can be ' +
        'learned without listing subscriptions — which would hand the caller everyone else’s.',
      input: z
        .object({
          endpointUrl: httpsUrl.describe('The receiver URL whose subscriptions should be removed.'),
        })
        .strict(),
      handler: async (args, ctx) => {
        const { propertyID } = ctx.metadata;
        const listed = unwrap(
          await client.get('getWebhooks', ctx.request, { propertyID }),
          'getWebhooks',
        );
        if (!listed.ok) return err(listed.code, listed.message);

        const subscriptions = Array.isArray(listed.data)
          ? (listed.data as ReadonlyArray<Record<string, unknown>>)
          : [];
        // **The read shape is not the write shape.** `postWebhook` TAKES `endpointUrl`; `getWebhooks`
        // RETURNS it nested as `subscriptionData.url` — observed 2026-08-05, and reading only the
        // written name matched nothing, so a real disconnect removed 0 of 2 subscriptions and
        // reported success. Same trap as `subscriptionID` vs `id` below, which was already handled.
        //
        // Exact match, never a prefix: the secret lives in the path, and a prefix match on
        // `…/webhooks/cloudbeds/` would delete every OTHER connection's subscription too.
        const urlOf = (s: Record<string, unknown>): unknown =>
          s['endpointUrl'] ??
          (s['subscriptionData'] as Record<string, unknown> | undefined)?.['url'];
        const mine = subscriptions.filter((s) => urlOf(s) === args.endpointUrl);

        let deleted = 0;
        const failures: string[] = [];
        for (const subscription of mine) {
          const id = subscription['subscriptionID'] ?? subscription['id'];
          if (typeof id !== 'string' && typeof id !== 'number') {
            failures.push('a subscription came back with no id');
            continue;
          }
          // DELETE with query-string params — a DELETE body is not parsed (see `client.del`).
          const removed = unwrap(
            await client.del('deleteWebhook', ctx.request, {
              propertyID,
              subscriptionID: String(id),
            }),
            'deleteWebhook',
          );
          if (removed.ok) deleted++;
          else failures.push(removed.message);
        }

        // A partial delete is a failure, not a smaller success: the caller is tearing down and has to
        // know something survived. The count still rides along so it can tell partial from none.
        // Messages never carry the url — it is the delivery credential.
        return failures.length > 0
          ? err(
              ProviderErrorCode.PROVIDER_ERROR,
              `deleted ${deleted} of ${mine.length} subscriptions; ${failures.length} failed (first: ${failures[0]})`,
            )
          : ok({ deleted, matched: mine.length });
      },
    }),
  ];
}
