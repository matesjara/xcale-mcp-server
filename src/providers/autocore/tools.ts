import { z } from 'zod';

import { ProviderErrorCode } from '../../core/errors';
import { err, ok, type ToolDefinition, type ToolOutcome, toolFactory } from '../../core/tool';
import type { AutocoreClient } from './client';
import type { AutocoreContext } from './context';
import { unexpected, unwrapAutocore, type Unwrapped } from './errors';
import { SLUG } from './manifest';

const tool = toolFactory<AutocoreContext>();

const NO_ARGS = z.object({}).strict();

/** Autocore's default page size for the hotel listing (observed). */
const HOTELS_PAGE_SIZE = 10;

/** 200 hotels. A listing longer than that is refused, never walked without end. */
const MAX_HOTEL_PAGES = 20;

/**
 * One page of `GET /v2/hotels`, with only what the probe needs. The record also carries the hotel's
 * phone, address, company, commissions and processor setup; zod strips every key not named here, so
 * none of it leaves this provider.
 */
const HotelsPage = z.object({
  paginate_info: z.object({ total_items: z.number().int().nonnegative() }),
  data: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      is_active: z.boolean().optional(),
      is_archived: z.boolean().optional(),
      currencies: z
        .array(
          z.object({
            is_primary: z.boolean().optional(),
            currency: z.object({ code: z.string() }),
          }),
        )
        .optional(),
    }),
  ),
});

type Hotel = z.infer<typeof HotelsPage>['data'][number];

/**
 * Stricter than Autocore, which accepts a fractional amount, a missing currency or description and a
 * currency the hotel does not hold (observed on Staging, 2026-11-09): the schema refuses those before
 * any call, and the consumer checks the currency against the probe's.
 */
const CreatePaymentLinkInput = z
  .object({
    // Whole units of `currency`, as Autocore takes them (a 150000 link shows $150.000 COP). Never cents.
    amount: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    // The payer's name, shown on the checkout. The only guest field Autocore requires.
    guestName: z.string().min(1).max(200),
    // Autocore emails the link here only when `sendLinkByEmail` is true.
    email: z.string().email().max(254).optional(),
    // The concept the checkout shows.
    description: z.string().min(1).max(500),
    // The caller's own reference. NOT unique at Autocore: a repeat creates a second link.
    externalRef: z.string().min(1).max(100),
    availableHours: z.number().int().min(1).max(8760),
    // Where Autocore POSTs its payment notifications.
    notificationUrl: z.string().url().startsWith('https://'),
    // Required: Autocore emails the guest unless told not to, so no caller can do it by omission.
    sendLinkByEmail: z.boolean(),
    // Absent = the hotel's own setup. Autocore does not check it against the hotel's services.
    allowedPaymentOptions: z
      .array(
        z.enum([
          'nequi',
          'daviplata',
          'pse',
          'credit_card',
          'sinpe_movil',
          'preloaded_balance',
          'gift_cards',
        ]),
      )
      .min(1)
      .optional(),
  })
  .strict();

/** `POST /v2/links/schedule/` answers `{ msg, url, code, reservation_id }`; the URL is returned, never built. */
const CreatedLink = z.object({ code: z.string().min(1), url: z.string().url() });

function toOutcome(result: Unwrapped & { ok: false }): ToolOutcome {
  return err(result.code, result.message);
}

function describeHotel(hotel: Hotel) {
  const currencies = hotel.currencies ?? [];
  return {
    id: hotel.id,
    name: hotel.name,
    active: hotel.is_active !== false && hotel.is_archived !== true,
    currencies: currencies.map((c) => c.currency.code),
    primaryCurrency: currencies.find((c) => c.is_primary === true)?.currency.code ?? null,
  };
}

export function buildAutocoreTools(
  client: AutocoreClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, AutocoreContext>> {
  return [
    tool({
      name: `mcp_${SLUG}_check_credentials`,
      description:
        "Prove that Autocore keys are accepted and reach the connection's hotel, without creating " +
        'anything. Returns the hotel name and its currencies. Used to validate a connection.',
      input: NO_ARGS,
      // Validating keys is the consumer's connect step, never an agent's move.
      controlPlane: true,
      handler: async (_args, ctx) => {
        // Paging follows `total_items`: Autocore's `links.next` points past the end even on the last
        // page (observed on Staging, 2026-11-09).
        for (let page = 0; page < MAX_HOTEL_PAGES; page++) {
          const offset = page * HOTELS_PAGE_SIZE;
          const result = unwrapAutocore(
            await client.get('/v2/hotels', ctx.request, ctx.metadata, {
              offset,
              limit: HOTELS_PAGE_SIZE,
            }),
            'check credentials',
          );
          if (!result.ok) return toOutcome(result);
          const parsed = HotelsPage.safeParse(result.data);
          if (!parsed.success) return toOutcome(unexpected('check credentials'));

          const hotel = parsed.data.data.find((h) => h.id === ctx.metadata.hotelId);
          if (hotel) return ok({ valid: true, hotel: describeHotel(hotel) });

          const total = parsed.data.paginate_info.total_items;
          if (offset + HOTELS_PAGE_SIZE >= total || parsed.data.data.length === 0) {
            return err(
              ProviderErrorCode.INVALID_INPUT,
              `Autocore hotel ${ctx.metadata.hotelId} is not reachable with these keys`,
            );
          }
        }
        return err(ProviderErrorCode.PROVIDER_ERROR, 'Autocore hotel listing too large');
      },
    }),

    tool({
      name: `mcp_${SLUG}_create_payment_link`,
      description:
        "Create an Autocore hosted payment link for an exact amount in whole units of the hotel's " +
        'currency, for a named guest, with its validity in hours and the caller reference. Returns the ' +
        'link code (its id for status and cancellation) and its checkout URL. Autocore does not ' +
        'deduplicate by reference: a repeated call creates a second link.',
      input: CreatePaymentLinkInput,
      // Charging is the consumer's guarded flow (amount limits, approval), never an agent's call.
      controlPlane: true,
      handler: async (args, ctx) => {
        // Sent once: Autocore has no idempotency key, so a retry could leave two payable links.
        const result = unwrapAutocore(
          await client.post('/v2/links/schedule/', ctx.request, ctx.metadata, {
            hotel_id: ctx.metadata.hotelId,
            amount: args.amount,
            currency: args.currency,
            guest_name: args.guestName,
            ...(args.email !== undefined ? { email: args.email } : {}),
            description: args.description,
            external_ref_id: args.externalRef,
            available_hours: args.availableHours,
            temp_webhook_url: args.notificationUrl,
            send_link_by_email: args.sendLinkByEmail,
            ...(args.allowedPaymentOptions !== undefined
              ? { allowed_payment_options: args.allowedPaymentOptions }
              : {}),
          }),
          'create payment link',
        );
        if (!result.ok) return toOutcome(result);
        const created = CreatedLink.safeParse(result.data);
        if (!created.success) return toOutcome(unexpected('create payment link'));
        return ok({ code: created.data.code, url: created.data.url });
      },
    }),
  ];
}
