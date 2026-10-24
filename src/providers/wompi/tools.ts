import { z } from 'zod';

import { ProviderErrorCode } from '../../core/errors';
import { err, ok, type ToolDefinition, type ToolOutcome, toolFactory } from '../../core/tool';
import type { WompiClient } from './client';
import type { WompiContext } from './context';
import { unwrapWompi } from './errors';
import { SLUG } from './manifest';

const tool = toolFactory<WompiContext>();

const NO_ARGS = z.object({}).strict();

/** A reference no transaction can have: the probe looks it up only to prove the key is accepted. */
const PROBE_REFERENCE = 'xcale-connection-probe';

/** Wompi's hosted checkout. Its link response carries no URL (verified): the page is built from the id. */
const CHECKOUT_BASE_URL = 'https://checkout.wompi.co/l';

const CreatePaymentLinkInput = z
  .object({
    name: z.string().min(1).max(200),
    // Required by Wompi: a link without it is a 422 (verified).
    description: z.string().min(1).max(500),
    amountInCents: z.number().int().positive(),
    currency: z.literal('COP'),
    expiresAt: z.string().datetime(),
    // The consumer's own reference; Wompi stores it as-is and shows it in the merchant dashboard.
    sku: z.string().min(1).max(64),
  })
  .strict();

/**
 * A Wompi link id (`test_XGd2UH` in the sandbox). It becomes a URL path segment, so anything beyond
 * letters, digits, `_` and `-` is refused rather than encoded: no caller can steer the PATCH to
 * another route of the merchant's account.
 */
const DeactivatePaymentLinkInput = z
  .object({ linkId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) })
  .strict();

const ListTransactionsInput = z
  .object({
    fromDate: z.string().datetime(),
    untilDate: z.string().datetime(),
  })
  .strict()
  // Both are UTC ISO strings, so Date comparison is exact.
  .refine((w) => Date.parse(w.untilDate) > Date.parse(w.fromDate), {
    message: 'untilDate must be after fromDate',
    path: ['untilDate'],
  });

/** Wompi's maximum page size for the transactions listing (verified: `page_size` ≤ 200). */
const PAGE_SIZE = 200;

/** 10,000 transactions. A wider window is refused, never returned in part. */
const MAX_PAGES = 50;

/**
 * Only what settlement needs. Wompi's transaction also carries the payer's email, name, phone,
 * billing and card details; zod strips every key not named here, so none of it survives the parse —
 * this provider never hands a consumer personal data it did not ask for.
 */
const WompiTransaction = z.object({
  id: z.string(),
  payment_link_id: z.string().nullable(),
  // Passed through as-is: settlement acts on `APPROVED`, and a state Wompi adds later must not make
  // the whole window unreadable. Observed: `APPROVED`, `DECLINED`.
  status: z.string().min(1),
  amount_in_cents: z.number().int(),
  currency: z.string(),
  created_at: z.string(),
  finalized_at: z.string().nullable(),
});

/**
 * One page of the listing: its transactions and Wompi's count for the whole window.
 *
 * Wompi answers an empty window with `meta: {}` and no count at all (observed on the sandbox,
 * `sandbox-evidence.md`), so a missing `total_results` on an empty page means zero results. A page
 * that carries rows but no count cannot tell whether more pages follow, so it stays an unexpected
 * response: a partial list would let the consumer settle as if it were whole.
 */
const WompiTransactionPage = z
  .object({
    data: z.array(WompiTransaction),
    meta: z.object({ total_results: z.number().int().nonnegative().optional() }),
  })
  .refine((p) => p.meta.total_results !== undefined || p.data.length === 0)
  .transform((p) => ({ data: p.data, totalResults: p.meta.total_results ?? 0 }));

type WompiTransactionRow = z.infer<typeof WompiTransaction>;

/** The fields of Wompi's link this provider relies on. */
const WompiLink = z.object({
  id: z.string().min(1),
  expires_at: z.string(),
  active: z.boolean(),
});

function toOutcome(result: ReturnType<typeof unwrapWompi>): ToolOutcome {
  return result.ok ? ok(result.data) : err(result.code, result.message);
}

export function buildWompiTools(
  client: WompiClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, WompiContext>> {
  return [
    tool({
      name: `mcp_${SLUG}_check_credentials`,
      description:
        'Prove that a Wompi private key is accepted, without creating anything. Used to validate a ' +
        'connection.',
      input: NO_ARGS,
      // Validating a key is the consumer's connect step, never an agent's move.
      controlPlane: true,
      handler: async (_args, ctx) => {
        const result = unwrapWompi(
          await client.get('transactions', ctx.request, ctx.metadata, {
            reference: PROBE_REFERENCE,
          }),
          'check credentials',
        );
        return result.ok ? ok({ valid: true }) : toOutcome(result);
      },
    }),

    tool({
      name: `mcp_${SLUG}_create_payment_link`,
      description:
        'Create a single-use Wompi payment link for an exact amount in COP, with its own expiry and ' +
        'the reference of the caller (sku). Returns the link id and its hosted checkout page. Note that ' +
        'Wompi keeps a single-use link payable after it is paid; deactivate it once settled.',
      input: CreatePaymentLinkInput,
      // Charging is the consumer's guarded flow (amount limits, approval), never an agent's call.
      controlPlane: true,
      handler: async (args, ctx) => {
        const result = unwrapWompi(
          await client.post('payment_links', ctx.request, ctx.metadata, {
            name: args.name,
            description: args.description,
            single_use: true,
            collect_shipping: false,
            currency: args.currency,
            amount_in_cents: args.amountInCents,
            expires_at: args.expiresAt,
            sku: args.sku,
          }),
          'create payment link',
        );
        if (!result.ok) return toOutcome(result);
        const link = WompiLink.safeParse(result.data);
        if (!link.success) {
          return err(
            ProviderErrorCode.PROVIDER_ERROR,
            'Wompi create payment link returned an unexpected response',
          );
        }
        return ok({
          linkId: link.data.id,
          url: `${CHECKOUT_BASE_URL}/${link.data.id}`,
          expiresAt: link.data.expires_at,
          active: link.data.active,
        });
      },
    }),

    tool({
      name: `mcp_${SLUG}_deactivate_payment_link`,
      description:
        'Deactivate a Wompi payment link so it no longer takes payments. Needed after a link is ' +
        'paid, because Wompi keeps a single-use link payable.',
      input: DeactivatePaymentLinkInput,
      controlPlane: true,
      handler: async (args, ctx) => {
        const result = unwrapWompi(
          await client.patch(`payment_links/${args.linkId}`, ctx.request, ctx.metadata, {
            active: false,
          }),
          'deactivate payment link',
        );
        if (!result.ok) return toOutcome(result);
        // Only Wompi's own answer proves it: the consumer stops watching a link it believes is off.
        const link = WompiLink.safeParse(result.data);
        if (!link.success || link.data.active) {
          return err(
            ProviderErrorCode.PROVIDER_ERROR,
            'Wompi did not confirm the payment link is deactivated',
          );
        }
        return ok({ linkId: link.data.id, active: false });
      },
    }),

    tool({
      name: `mcp_${SLUG}_list_transactions`,
      description:
        'List the merchant transactions created in a date window (ISO 8601 UTC), with only the ' +
        'fields needed to settle a payment link: id, link id, status, amount, currency and dates. ' +
        'It returns every transaction of the window: filter by link id on the caller side.',
      input: ListTransactionsInput,
      controlPlane: true,
      handler: async (args, ctx) => {
        // Keyed by id: an open window shifts while it is read, and a row pushed from one page onto the
        // next must reach the consumer once.
        const rows = new Map<string, WompiTransactionRow>();
        for (let page = 1; ; page++) {
          const result = unwrapWompi(
            await client.get('transactions', ctx.request, ctx.metadata, {
              from_date: args.fromDate,
              until_date: args.untilDate,
              page,
              page_size: PAGE_SIZE,
            }),
            'list transactions',
          );
          if (!result.ok) return toOutcome(result);
          const parsed = WompiTransactionPage.safeParse({
            data: result.data,
            meta: result.meta,
          });
          if (!parsed.success) {
            return err(
              ProviderErrorCode.PROVIDER_ERROR,
              'Wompi list transactions returned an unexpected response',
            );
          }
          if (parsed.data.totalResults > MAX_PAGES * PAGE_SIZE) {
            return err(
              ProviderErrorCode.PROVIDER_ERROR,
              'Wompi transaction window too large; narrow fromDate/untilDate',
            );
          }
          for (const row of parsed.data.data) rows.set(row.id, row);
          if (page * PAGE_SIZE >= parsed.data.totalResults) break;
        }
        return ok({
          transactions: [...rows.values()].map((t) => ({
            id: t.id,
            paymentLinkId: t.payment_link_id,
            status: t.status,
            amountInCents: t.amount_in_cents,
            currency: t.currency,
            createdAt: t.created_at,
            finalizedAt: t.finalized_at,
          })),
        });
      },
    }),
  ];
}
