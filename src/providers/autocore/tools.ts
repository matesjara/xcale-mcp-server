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

/**
 * A link's code (`vlxcvpqhcjc8` on Staging). It becomes a URL path segment, so anything beyond lowercase
 * letters and digits is refused rather than encoded: no caller can steer the DELETE to another route.
 */
const DeactivatePaymentLinkInput = z
  .object({ code: z.string().regex(/^[a-z0-9]{1,64}$/) })
  .strict();

const GetTransactionStatusInput = z.object({ code: z.string().regex(/^[a-z0-9]{1,64}$/) }).strict();

/**
 * `GET /v2/common/transaction-status` — stable status codes (`applied`, `rejected`, `pending`,
 * `in_process`, `cancelled`, `error`), no amount. Without a transaction, `transaction_id` and
 * `transaction_date` are `""`; a declined attempt carries `"N/A"` (observed on Staging, 2026-11-13).
 */
const LinkStatus = z.object({
  details: z.object({
    id: z.string(),
    external_ref_id: z.string().nullable().optional(),
    status_code: z.string().min(1),
    transaction_id: z.string().nullable().optional(),
  }),
});

/**
 * `GET /v2/links/schedule/<code>` (without `validate_link_status`) — the link as Autocore keeps it,
 * with its payments: the amount paid (a decimal string, major units) per transaction id. Only Spanish
 * labels for status, so the status comes from `LinkStatus`. The record also carries the guest's name,
 * email and phone and the hotel's setup; zod strips every key not named here.
 */
const LinkWithPayments = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  payments: z.array(
    z.object({
      transaction_id: z.string().nullable().optional(),
      amount: z.union([z.string(), z.number()]),
      // Naive ISO in UTC (observed: 03:54Z for a payment the status read dates 22:54 in Bogotá).
      created_at: z.string(),
    }),
  ),
});

/** `""` and `"N/A"` both mean "no transaction". */
function transactionIdOf(raw: string | null | undefined): string | null {
  return raw && raw !== 'N/A' ? raw : null;
}

/** `/v2/links/schedule/` answers `{ msg, url, code, reservation_id }`; the URL is returned, never built. */
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
            // Required by Autocore since 2026-11-13: the account's origin, from the context.
            source: ctx.metadata.source,
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

    tool({
      name: `mcp_${SLUG}_deactivate_payment_link`,
      description:
        'Cancel an Autocore payment link by its code, so it can no longer be paid. Cancelling a link ' +
        'that is already cancelled succeeds again.',
      input: DeactivatePaymentLinkInput,
      // Part of the consumer's charge lifecycle (a cancelled request, a disconnected gateway).
      controlPlane: true,
      handler: async (args, ctx) => {
        // Undocumented by Autocore: the call its web app's "Cancelar cobro" makes. It answers 200
        // `{ msg }` also for a link already cancelled, after which the link reads `cancelled` and its
        // checkout refuses it (observed on Staging, 2026-11-09).
        const result = unwrapAutocore(
          await client.delete(`/v2/bookings/chatbot/${args.code}`, ctx.request, ctx.metadata),
          'deactivate payment link',
        );
        return result.ok ? ok({ code: args.code, cancelled: true }) : toOutcome(result);
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_transaction_status`,
      description:
        "Read an Autocore payment link's status by its code: Autocore's status code as sent (applied, " +
        'rejected, pending, in_process, cancelled, error) and, when applied, the transaction and the ' +
        'amount and currency actually paid. A rejected attempt does not close the link: it can still be ' +
        'paid. No guest or card data is returned.',
      input: GetTransactionStatusInput,
      // Settlement is the consumer's: an agent asks about a payment through the consumer's tools.
      controlPlane: true,
      handler: async (args, ctx) => {
        const operation = 'get transaction status';
        const status = unwrapAutocore(
          await client.get('/v2/common/transaction-status', ctx.request, ctx.metadata, {
            hotel_id: ctx.metadata.hotelId,
            ref_number: args.code,
            transaction_type: 'payment_link',
          }),
          operation,
        );
        if (!status.ok) return toOutcome(status);
        const parsed = LinkStatus.safeParse(status.data);
        if (!parsed.success) return toOutcome(unexpected(operation));
        const { details } = parsed.data;
        const read = {
          code: args.code,
          externalRef: details.external_ref_id || null,
          status: details.status_code,
          transactionId: transactionIdOf(details.transaction_id),
        };
        if (read.status !== 'applied') {
          return ok({
            ...read,
            transactionId: null,
            occurredAt: null,
            amount: null,
            currency: null,
          });
        }

        // Paid: the amount comes from the link's own record of that transaction, never assumed from
        // what was asked — the consumer compares the two.
        const link = unwrapAutocore(
          await client.get(`/v2/links/schedule/${args.code}`, ctx.request, ctx.metadata),
          operation,
        );
        if (!link.ok) return toOutcome(link);
        const record = LinkWithPayments.safeParse(link.data);
        if (!record.success || read.transactionId === null) return toOutcome(unexpected(operation));
        const payment = record.data.payments.find((p) => p.transaction_id === read.transactionId);
        const amount = payment === undefined ? NaN : Number(payment.amount);
        const occurredAt = payment === undefined ? NaN : Date.parse(`${payment.created_at}Z`);
        if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(occurredAt)) {
          return toOutcome(unexpected(operation));
        }
        return ok({
          ...read,
          occurredAt: new Date(occurredAt).toISOString(),
          amount,
          currency: record.data.currency,
        });
      },
    }),
  ];
}
