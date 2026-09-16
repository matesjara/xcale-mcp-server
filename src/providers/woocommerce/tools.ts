import { z } from 'zod';

import { definePaginatedList } from '../../core/pagination';
import { type ToolDefinition, err, ok, toolFactory } from '../../core/tool';
import type { WoocommerceClient } from './client';
import type { WoocommerceContext } from './context';
import { SLUG } from './manifest';

const tool = toolFactory<WoocommerceContext>();

/**
 * Strip HTML to plain text for conversational use. WooCommerce `description` fields come back as raw
 * HTML (S0 observed heavy VTEX markup). This is a lightweight regex strip (no HTML parser / no dep) —
 * enough to hand the agent readable text; it does not attempt to preserve structure.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/**
 * The raw WooCommerce product fields we read. WooCommerce returns far more; we curate to a
 * high-signal subset (Provider Self-Containment — do not dump every field on the wire).
 *
 * Observed against a real store (S0, see docs/design/woocommerce-read-only-provider/sandbox-evidence.md):
 * `id` is a NUMBER, `price` is a STRING, `stock_status` is `instock|outofstock|onbackorder`,
 * `description` is raw HTML.
 */
interface RawProduct {
  readonly id: number;
  readonly name: string;
  readonly price: string;
  readonly stock_status: string;
  readonly stock_quantity: number | null;
  readonly permalink: string;
}

interface RawProductDetail extends RawProduct {
  readonly sku?: string;
  readonly description?: string;
  readonly categories?: ReadonlyArray<{ id: number; name: string }>;
  readonly images?: ReadonlyArray<{ src: string }>;
  readonly variations?: readonly number[];
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

/** Curated product detail. `description` is stripped to plain text; `variations` are ids to expand. */
export interface WooProductDetail extends WooProductSummary {
  readonly sku: string | null;
  readonly description: string;
  readonly categories: ReadonlyArray<{ id: string; name: string }>;
  readonly images: ReadonlyArray<{ src: string }>;
  readonly variations: readonly string[];
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

function toProductDetail(p: RawProductDetail): WooProductDetail {
  return {
    ...toProductSummary(p),
    sku: p.sku ?? null,
    description: p.description ? stripHtml(p.description) : '',
    categories: (p.categories ?? []).map((c) => ({ id: String(c.id), name: c.name })),
    images: (p.images ?? []).map((i) => ({ src: i.src })),
    variations: (p.variations ?? []).map(String),
  };
}

// ---------------------------------------------------------------------------
// Variations (⏳ shape from official docs — not yet confirmed against a variable product; see S0)
// ---------------------------------------------------------------------------

interface RawVariation {
  readonly id: number;
  readonly attributes?: ReadonlyArray<{ name: string; option: string }>;
  readonly price: string;
  readonly stock_status: string;
  readonly stock_quantity: number | null;
}

/** Curated variation: which attribute combo (size/color) plus its own price/stock. */
export interface WooProductVariation {
  readonly id: string;
  readonly attributes: ReadonlyArray<{ name: string; option: string }>;
  readonly price: string;
  readonly stockStatus: string;
  readonly stockQuantity: number | null;
}

function toVariation(v: RawVariation): WooProductVariation {
  return {
    id: String(v.id),
    attributes: (v.attributes ?? []).map((a) => ({ name: a.name, option: a.option })),
    price: v.price,
    stockStatus: v.stock_status,
    stockQuantity: v.stock_quantity ?? null,
  };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

interface RawCategory {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly parent: number;
  readonly count: number;
}

/** Curated category. `parent` is a category id (null for a top-level category). */
export interface WooCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly parent: string | null;
  readonly count: number;
}

function toCategory(c: RawCategory): WooCategory {
  return {
    id: String(c.id),
    name: c.name,
    slug: c.slug,
    parent: c.parent ? String(c.parent) : null,
    count: c.count,
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const listProductsInput = z
  .object({
    search: z.string().optional(),
    category: z.string().optional(),
    stockStatus: z.enum(['instock', 'outofstock', 'onbackorder']).optional(),
  })
  .strict();

const getProductInput = z.object({ id: z.string().min(1) }).strict();
const getProductVariationsInput = z.object({ id: z.string().min(1) }).strict();
const listCategoriesInput = z.object({}).strict();

/**
 * Build the WooCommerce read tool set (v1). Catalog (S2–S3): products, product detail, variations,
 * categories. Shipping (S4) and orders (S5) arrive in later slices.
 *
 * **Pagination totals (v1 decision — Option A):** WooCommerce returns totals in the `X-WP-Total` /
 * `X-WP-TotalPages` response HEADERS, which the core transport does not surface (it returns the
 * parsed body only). So list tools return the page of `items` plus `page`/`pageSize`, and omit
 * `totalPages`/`totalResults` (hence no `hasMore`) — valid per `buildPage`. Exposing headers would
 * be a core change (its own ADR); deferred until a real need. See the api-contract §1.5.
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

    tool({
      name: `mcp_${SLUG}_get_product`,
      description:
        'Get one product by id: price, stock, description (plain text), categories, images, and variation ids.',
      input: getProductInput,
      handler: async (args, ctx) => {
        const res = await client.get(`products/${args.id}`, ctx.request, ctx.metadata);
        if (!res.ok) return err(res.errorCode, `WooCommerce error (HTTP ${res.status})`);
        return ok(toProductDetail(res.data as RawProductDetail));
      },
    }),

    definePaginatedList<typeof getProductVariationsInput, WooProductVariation, WoocommerceContext>({
      name: `mcp_${SLUG}_get_product_variations`,
      description:
        "List a variable product's variations (size/color combos) with each one's price and stock.",
      input: getProductVariationsInput,
      handler: async (args, ctx) => {
        const res = await client.get(`products/${args.id}/variations`, ctx.request, ctx.metadata, {
          per_page: args.pageSize,
          page: args.page,
        });
        if (!res.ok) {
          return {
            ok: false,
            code: res.errorCode,
            message: `WooCommerce error (HTTP ${res.status})`,
          };
        }
        const items = (res.data as RawVariation[]).map(toVariation);
        return { ok: true, items };
      },
    }),

    definePaginatedList<typeof listCategoriesInput, WooCategory, WoocommerceContext>({
      name: `mcp_${SLUG}_list_categories`,
      description: 'List product categories in the store catalog.',
      input: listCategoriesInput,
      handler: async (args, ctx) => {
        const res = await client.get('products/categories', ctx.request, ctx.metadata, {
          per_page: args.pageSize,
          page: args.page,
        });
        if (!res.ok) {
          return {
            ok: false,
            code: res.errorCode,
            message: `WooCommerce error (HTTP ${res.status})`,
          };
        }
        const items = (res.data as RawCategory[]).map(toCategory);
        return { ok: true, items };
      },
    }),
  ];
}
