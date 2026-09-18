import { z } from 'zod';

import { definePaginatedList } from '../../core/pagination';
import { type ToolDefinition, ok, toolFactory } from '../../core/tool';
import type { WoocommerceClient } from './client';
import type { WoocommerceContext } from './context';
import { wooError } from './errors';
import { SLUG } from './manifest';

const tool = toolFactory<WoocommerceContext>();

/**
 * Strip HTML to plain text for conversational use. WooCommerce `description` fields come back as raw
 * HTML (S0 observed heavy VTEX markup). This is a lightweight regex strip (no HTML parser / no dep) —
 * enough to hand the agent readable text; it does not attempt to preserve structure.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g, ' ')
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
// Variations (shape confirmed against a real variable product — S0)
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
// Shipping (zones/locations/methods are NOT paginated — WooCommerce returns the full set)
// ---------------------------------------------------------------------------

interface RawShippingZone {
  readonly id: number;
  readonly name: string;
  readonly order: number;
}

/** Curated shipping zone. WooCommerce always includes zone `id:0` = "rest of world" (catch-all). */
export interface WooShippingZone {
  readonly id: string;
  readonly name: string;
  readonly order: number;
}

function toShippingZone(zone: RawShippingZone): WooShippingZone {
  return { id: String(zone.id), name: zone.name, order: zone.order };
}

// Zone → location shape confirmed against the sandbox (S0): { code, type } with
// type = continent | country | state (e.g. state code "CO:CO-QUI").
interface RawShippingZoneLocation {
  readonly code: string;
  readonly type: string;
}

/** A location a zone covers. `type` is `country | state | postcode | continent`. */
export interface WooShippingZoneLocation {
  readonly type: string;
  readonly code: string;
}

function toShippingZoneLocation(l: RawShippingZoneLocation): WooShippingZoneLocation {
  return { type: l.type, code: l.code };
}

interface RawShippingZoneMethod {
  readonly id: number;
  readonly method_id: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly settings?: { cost?: { value?: string } };
}

/**
 * Curated shipping method. `baseCost` is the CONFIGURED base rate (`settings.cost.value`), NOT a
 * cart-accurate quote — it may even be a formula (e.g. `10.00 * [qty]`). `free_shipping` has no
 * cost (null); its minimum-order threshold lives in settings and is out of the v1 shape (R-6).
 */
export interface WooShippingZoneMethod {
  readonly methodId: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly baseCost: string | null;
}

function toShippingZoneMethod(m: RawShippingZoneMethod): WooShippingZoneMethod {
  return {
    methodId: m.method_id,
    title: m.title,
    enabled: m.enabled,
    baseCost: m.settings?.cost?.value ?? null,
  };
}

// ---------------------------------------------------------------------------
// Orders (owner-facing)
// ---------------------------------------------------------------------------

interface RawOrder {
  readonly id: number;
  readonly number: string;
  readonly status: string;
  readonly currency: string;
  readonly total: string;
  readonly date_created: string;
  readonly customer_id: number | null;
}

interface RawAddress {
  readonly first_name?: string;
  readonly last_name?: string;
  readonly address_1?: string;
  readonly address_2?: string;
  readonly city?: string;
  readonly state?: string;
  readonly postcode?: string;
  readonly country?: string;
  readonly email?: string;
  readonly phone?: string;
}

interface RawLineItem {
  readonly name: string;
  readonly quantity: number;
  readonly total: string;
  readonly sku?: string;
}

interface RawOrderDetail extends RawOrder {
  readonly billing?: RawAddress;
  readonly shipping?: RawAddress;
  readonly line_items?: readonly RawLineItem[];
}

/** Curated order summary (owner-facing). `total` is a string; `dateCreated` is ISO 8601. */
export interface WooOrderSummary {
  readonly id: string;
  readonly number: string;
  readonly status: string;
  readonly currency: string;
  readonly total: string;
  readonly dateCreated: string;
  readonly customerId: number | null;
}

/**
 * Curated order detail (owner-facing). `customer` condenses the buyer's contact (name/email/phone)
 * plus the full formatted shipping address so the OWNER can fulfil the order. This is the owner's own
 * order data — not a cross-customer listing — and like every field it is typed data, never
 * interpolated into a log or error message.
 */
export interface WooOrderDetail extends WooOrderSummary {
  readonly lineItems: ReadonlyArray<{
    name: string;
    quantity: number;
    total: string;
    sku: string | null;
  }>;
  readonly customer: {
    readonly name: string;
    readonly email: string;
    readonly phone: string;
    readonly shippingAddress: string;
  };
}

function toOrderSummary(o: RawOrder): WooOrderSummary {
  return {
    id: String(o.id),
    number: o.number,
    status: o.status,
    currency: o.currency,
    total: o.total,
    dateCreated: o.date_created,
    customerId: o.customer_id ?? null,
  };
}

function fullName(a: RawAddress | undefined): string {
  return [a?.first_name, a?.last_name]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
    .join(' ');
}

/** Join the non-empty parts of an address into one condensed line. */
function formatAddress(a: RawAddress | undefined): string {
  if (!a) return '';
  return [a.address_1, a.address_2, a.city, a.state, a.postcode, a.country]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
    .join(', ');
}

function toOrderDetail(o: RawOrderDetail): WooOrderDetail {
  return {
    ...toOrderSummary(o),
    lineItems: (o.line_items ?? []).map((li) => ({
      name: li.name,
      quantity: li.quantity,
      total: li.total,
      sku: li.sku ?? null,
    })),
    customer: {
      // Name/email/phone come from billing (it carries contact); shipping address from shipping.
      name: fullName(o.billing) || fullName(o.shipping),
      email: (o.billing?.email ?? '').trim(),
      phone: (o.billing?.phone ?? o.shipping?.phone ?? '').trim(),
      shippingAddress: formatAddress(o.shipping),
    },
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
const noArgsInput = z.object({}).strict();
const getShippingZoneInput = z.object({ id: z.string().min(1) }).strict();
const listOrdersInput = z
  .object({
    status: z.string().optional(),
    after: z.string().optional(),
    before: z.string().optional(),
  })
  .strict();
const getOrderInput = z.object({ id: z.string().min(1) }).strict();

// --- Write inputs (Phase 2) ---
const updateProductInput = z
  .object({
    id: z.string().min(1),
    regularPrice: z.string().optional(),
    salePrice: z.string().optional(),
    status: z.enum(['publish', 'draft', 'private']).optional(),
  })
  .strict()
  .refine(
    (a) => a.regularPrice !== undefined || a.salePrice !== undefined || a.status !== undefined,
    { message: 'at least one mutable field (regularPrice, salePrice, status) is required' },
  );

const updateStockInput = z
  .object({
    id: z.string().min(1),
    productId: z.string().min(1).optional(),
    stockQuantity: z.number().int().optional(),
    stockStatus: z.enum(['instock', 'outofstock', 'onbackorder']).optional(),
  })
  .strict()
  .refine((a) => a.stockQuantity !== undefined || a.stockStatus !== undefined, {
    message: 'at least one of stockQuantity, stockStatus is required',
  });

/** Curated result of a stock write — works for both a product and a variation response. */
export interface WooStockUpdate {
  readonly id: string;
  readonly stockQuantity: number | null;
  readonly stockStatus: string;
}
interface RawStock {
  readonly id: number;
  readonly stock_quantity: number | null;
  readonly stock_status: string;
}
function toStockUpdate(r: RawStock): WooStockUpdate {
  return { id: String(r.id), stockQuantity: r.stock_quantity ?? null, stockStatus: r.stock_status };
}

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
        if (!res.ok) return wooError(res);
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
        const res = await client.get(
          `products/${encodeURIComponent(args.id)}`,
          ctx.request,
          ctx.metadata,
        );
        if (!res.ok) return wooError(res);
        return ok(toProductDetail(res.data as RawProductDetail));
      },
    }),

    tool({
      name: `mcp_${SLUG}_update_product`,
      description:
        'Update a product: price (regularPrice / salePrice) and/or publish status. Idempotent — only the fields you pass change.',
      input: updateProductInput,
      handler: async (args, ctx) => {
        const body: Record<string, unknown> = {};
        if (args.regularPrice !== undefined) body.regular_price = args.regularPrice;
        if (args.salePrice !== undefined) body.sale_price = args.salePrice;
        if (args.status !== undefined) body.status = args.status;
        const res = await client.put(
          `products/${encodeURIComponent(args.id)}`,
          body,
          ctx.request,
          ctx.metadata,
        );
        if (!res.ok) return wooError(res);
        return ok(toProductDetail(res.data as RawProductDetail));
      },
    }),

    tool({
      name: `mcp_${SLUG}_update_stock`,
      description:
        "Set a product's or variation's stock quantity and/or status. Pass productId to target a variation. Idempotent.",
      input: updateStockInput,
      handler: async (args, ctx) => {
        const body: Record<string, unknown> = {};
        if (args.stockQuantity !== undefined) {
          body.stock_quantity = args.stockQuantity;
          body.manage_stock = true; // WooCommerce ignores stock_quantity unless manage_stock is on
        }
        if (args.stockStatus !== undefined) body.stock_status = args.stockStatus;
        const path =
          args.productId !== undefined
            ? `products/${encodeURIComponent(args.productId)}/variations/${encodeURIComponent(args.id)}`
            : `products/${encodeURIComponent(args.id)}`;
        const res = await client.put(path, body, ctx.request, ctx.metadata);
        if (!res.ok) return wooError(res);
        return ok(toStockUpdate(res.data as RawStock));
      },
    }),

    definePaginatedList<typeof getProductVariationsInput, WooProductVariation, WoocommerceContext>({
      name: `mcp_${SLUG}_get_product_variations`,
      description:
        "List a variable product's variations (size/color combos) with each one's price and stock.",
      input: getProductVariationsInput,
      handler: async (args, ctx) => {
        const res = await client.get(
          `products/${encodeURIComponent(args.id)}/variations`,
          ctx.request,
          ctx.metadata,
          {
            per_page: args.pageSize,
            page: args.page,
          },
        );
        if (!res.ok) return wooError(res);
        const items = (res.data as RawVariation[]).map(toVariation);
        return { ok: true, items };
      },
    }),

    definePaginatedList<typeof noArgsInput, WooCategory, WoocommerceContext>({
      name: `mcp_${SLUG}_list_categories`,
      description: 'List product categories in the store catalog.',
      input: noArgsInput,
      handler: async (args, ctx) => {
        const res = await client.get('products/categories', ctx.request, ctx.metadata, {
          per_page: args.pageSize,
          page: args.page,
        });
        if (!res.ok) return wooError(res);
        const items = (res.data as RawCategory[]).map(toCategory);
        return { ok: true, items };
      },
    }),

    tool({
      name: `mcp_${SLUG}_list_shipping_zones`,
      description:
        'List the store\'s configured shipping zones (includes the "rest of world" zone, id 0).',
      input: noArgsInput,
      handler: async (_args, ctx) => {
        const res = await client.get('shipping/zones', ctx.request, ctx.metadata);
        if (!res.ok) return wooError(res);
        return ok((res.data as RawShippingZone[]).map(toShippingZone));
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_shipping_zone_locations`,
      description:
        'List the geographic locations (countries/states/postcodes) a shipping zone covers.',
      input: getShippingZoneInput,
      handler: async (args, ctx) => {
        const res = await client.get(
          `shipping/zones/${encodeURIComponent(args.id)}/locations`,
          ctx.request,
          ctx.metadata,
        );
        if (!res.ok) return wooError(res);
        return ok((res.data as RawShippingZoneLocation[]).map(toShippingZoneLocation));
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_shipping_zone_methods`,
      description: 'List the shipping methods and their base rates available for a shipping zone.',
      input: getShippingZoneInput,
      handler: async (args, ctx) => {
        const res = await client.get(
          `shipping/zones/${encodeURIComponent(args.id)}/methods`,
          ctx.request,
          ctx.metadata,
        );
        if (!res.ok) return wooError(res);
        return ok((res.data as RawShippingZoneMethod[]).map(toShippingZoneMethod));
      },
    }),

    definePaginatedList<typeof listOrdersInput, WooOrderSummary, WoocommerceContext>({
      name: `mcp_${SLUG}_list_orders`,
      description: "List the store's orders, filtered by status and/or date range. Owner-facing.",
      input: listOrdersInput,
      handler: async (args, ctx) => {
        const res = await client.get('orders', ctx.request, ctx.metadata, {
          per_page: args.pageSize,
          page: args.page,
          status: args.status,
          after: args.after,
          before: args.before,
        });
        if (!res.ok) return wooError(res);
        const items = (res.data as RawOrder[]).map(toOrderSummary);
        return { ok: true, items };
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_order`,
      description:
        'Get one order by id: status, total, line items, and the buyer contact + shipping address. Owner-facing.',
      input: getOrderInput,
      handler: async (args, ctx) => {
        const res = await client.get(
          `orders/${encodeURIComponent(args.id)}`,
          ctx.request,
          ctx.metadata,
        );
        if (!res.ok) return wooError(res);
        return ok(toOrderDetail(res.data as RawOrderDetail));
      },
    }),
  ];
}
