import { z } from 'zod';

import { definePaginatedList } from '../../core/pagination';
import type { ToolDefinition } from '../../core/tool';
import type { WoocommerceClient } from './client';
import type { WoocommerceContext } from './context';
import { SLUG } from './manifest';

/**
 * The raw WooCommerce product fields we read. WooCommerce returns far more; we curate to a
 * high-signal subset (Provider Self-Containment — do not dump every field on the wire).
 *
 * Observed against a real store (S0, see docs/design/woocommerce-read-only-provider/sandbox-evidence.md):
 * `id` is a NUMBER, `price` is a STRING, `stock_status` is `instock|outofstock|onbackorder`.
 */
interface RawProduct {
  readonly id: number;
  readonly name: string;
  readonly price: string;
  readonly stock_status: string;
  readonly stock_quantity: number | null;
  readonly permalink: string;
}

/** Curated product summary for a catalog listing. `id` is normalized to a string. */
export interface WooProductSummary {
  readonly id: string;
  readonly name: string;
  readonly price: string;
  readonly stockStatus: string;
  readonly stockQuantity: number | null;
  readonly permalink: string;
}

function toProductSummary(p: RawProduct): WooProductSummary {
  return {
    id: String(p.id),
    name: p.name,
    price: p.price,
    stockStatus: p.stock_status,
    stockQuantity: p.stock_quantity ?? null,
    permalink: p.permalink,
  };
}

const listProductsInput = z
  .object({
    search: z.string().optional(),
    category: z.string().optional(),
    stockStatus: z.enum(['instock', 'outofstock', 'onbackorder']).optional(),
  })
  .strict();

/**
 * Build the WooCommerce read tool set. v1 exposes `list_products`; the rest arrive in later slices.
 *
 * **Pagination totals (v1 decision — Option A):** WooCommerce returns totals in the `X-WP-Total` /
 * `X-WP-TotalPages` response HEADERS, which the core transport does not surface (it returns the
 * parsed body only). So list tools return the page of `items` plus `page`/`pageSize`, and omit
 * `totalPages`/`totalResults` (hence no `hasMore`) — valid per `buildPage`. Exposing headers would
 * be a core change (its own ADR); deferred until a real need. See the api-contract.
 */
export function buildWoocommerceTools(
  client: WoocommerceClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection); per-tool types stay sound
): ToolDefinition<any, WoocommerceContext>[] {
  return [
    definePaginatedList<typeof listProductsInput, WooProductSummary, WoocommerceContext>({
      name: `mcp_${SLUG}_list_products`,
      description:
        'List or search products in the store catalog (name, price, stock availability).',
      input: listProductsInput,
      handler: async (args, ctx) => {
        const res = await client.get('products', ctx.request, ctx.metadata, {
          per_page: args.pageSize,
          page: args.page,
          search: args.search,
          category: args.category,
          stock_status: args.stockStatus,
        });
        if (!res.ok) {
          // Error messages use status/code only — never interpolate the provider body or the URL.
          return {
            ok: false,
            code: res.errorCode,
            message: `WooCommerce error (HTTP ${res.status})`,
          };
        }
        const items = (res.data as RawProduct[]).map(toProductSummary);
        return { ok: true, items };
      },
    }),
  ];
}
