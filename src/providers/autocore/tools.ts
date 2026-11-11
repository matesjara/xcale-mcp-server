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
  ];
}
