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
  /** publish | draft | pending | private — a non-`publish` product is withdrawn from the catalogue. */
  readonly status?: string;
  readonly catalog_visibility?: string;
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
  /**
   * WooCommerce publish state (`publish`|`draft`|`pending`|`private`). A consumer reads a non-publish
   * status as "withdrawn from the sellable catalogue" — a permanent condition, distinct from
   * out-of-stock. Absent when WooCommerce omitted it.
   */
  readonly status: string | null;
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
    status: p.status ?? null,
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

/**
 * Create a `simple` product. `name` is the only required field; everything else is optional so the
 * agent can create a stub and fill it in later via update_product / update_stock. Mirrors
 * shopify_create_product's shape (title/price/sku/status) plus WooCommerce-native fields (categories,
 * stock). v1 does NOT set images — WooCommerce ingests images by URL and image handling is a
 * separate, cross-provider capability (no provider in the stack uploads product images today).
 */
const createProductInput = z
  .object({
    name: z.string().min(1),
    regularPrice: z.string().optional(),
    salePrice: z.string().optional(),
    description: z.string().optional(),
    shortDescription: z.string().optional(),
    sku: z.string().optional(),
    categories: z.array(z.string().regex(/^\d+$/, 'category id must be numeric')).optional(),
    stockQuantity: z.number().int().optional(),
    stockStatus: z.enum(['instock', 'outofstock', 'onbackorder']).optional(),
    // Defaults to draft, mirroring shopify_create_product: never auto-publish an unfinished product.
    status: z.enum(['publish', 'draft', 'private']).default('draft'),
  })
  .strict();

/** Build the WooCommerce product-create body. Creates a `simple` product; images are not set. */
function createProductBody(a: {
  name: string;
  regularPrice?: string;
  salePrice?: string;
  description?: string;
  shortDescription?: string;
  sku?: string;
  categories?: string[];
  stockQuantity?: number;
  stockStatus?: string;
  status: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = { name: a.name, type: 'simple', status: a.status };
  if (a.regularPrice !== undefined) body.regular_price = a.regularPrice;
  if (a.salePrice !== undefined) body.sale_price = a.salePrice;
  if (a.description !== undefined) body.description = a.description;
  if (a.shortDescription !== undefined) body.short_description = a.shortDescription;
  if (a.sku !== undefined) body.sku = a.sku;
  if (a.categories !== undefined) body.categories = a.categories.map((id) => ({ id: Number(id) }));
  if (a.stockQuantity !== undefined) {
    // WooCommerce ignores stock_quantity unless manage_stock is on (mirrors update_stock).
    body.manage_stock = true;
    body.stock_quantity = a.stockQuantity;
  }
  if (a.stockStatus !== undefined) body.stock_status = a.stockStatus;
  return body;
}

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

/** The order `meta_data` key that carries the caller's reconciliation reference tag. */
const ORDER_REF_META_KEY = '_xcale_order_ref';

const createOrderInput = z
  .object({
    orderReference: z.string().min(1),
    lineItems: z
      .array(
        z.object({
          // Numeric ids only: these are `Number()`-coerced into the WooCommerce body, and a
          // non-numeric string ("abc" → NaN → JSON null) or exponent form ("1e2" → 100) would
          // silently target the wrong product. Fail fast at the boundary instead.
          productId: z.string().regex(/^\d+$/, 'productId must be a numeric id'),
          variationId: z.string().regex(/^\d+$/, 'variationId must be a numeric id').optional(),
          quantity: z.number().int().positive(),
        }),
      )
      .min(1),
    customer: z
      .object({
        email: z.string().email().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
      })
      .optional(),
    // Shipping address for a physical order. When present, `address1` is required — a shipping block
    // without a street is not an address the store can dispatch to. WooCommerce prices/fulfils from
    // this; the buyer's identity (name/phone) still comes from `customer` (billing).
    shipping: z
      .object({
        address1: z.string().min(1),
        address2: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        postcode: z.string().optional(),
        country: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
      })
      .optional(),
    // Optional link to an existing WooCommerce Customer. Numeric id only; absent ⇒ a guest order
    // (billing inline). The consumer looks up / creates the customer (via the customer tools) and
    // passes the id here to attribute the order to that customer.
    customerId: z.string().regex(/^\d+$/, 'customerId must be a numeric id').optional(),
    status: z.enum(['pending', 'processing', 'on-hold']).default('pending'),
  })
  .strict();

/** Order statuses a caller may set via update_order. `cancelled` is the one the void path needs. */
const updateOrderInput = z
  .object({
    id: z.string().regex(/^\d+$/, 'id must be a numeric order id'),
    status: z.enum([
      'pending',
      'processing',
      'on-hold',
      'completed',
      'cancelled',
      'refunded',
      'failed',
    ]),
  })
  .strict();

const reconcileOrderInput = z
  .object({
    orderReference: z.string().min(1),
    // The caller's create-attempt timestamp (ISO 8601). Strongly recommended: it bounds the recent
    // window to the real uncertainty interval so a busy store (>100 orders since) can't push the
    // target order off page 1 and produce a false found:false → duplicate (the R-1 risk). Omitted
    // falls back to best-effort "100 newest", fine for a low-volume pilot.
    after: z.string().optional(),
  })
  .strict();

/**
 * Curated result of a create/reconcile — the fields a caller needs to recognize its own order.
 *
 * `paymentUrl`/`orderKey` are WooCommerce's customer-facing pay handle for an unpaid order: the
 * consumer's commerce layer hands `paymentUrl` to the buyer as the hosted checkout (Shopify-style),
 * or ignores it for an offline/COD flow (the order is already terminal). Null when WooCommerce does
 * not issue one (e.g. an already-paid order carries no pay link).
 */
export interface WooOrderCreated {
  readonly id: string;
  readonly number: string;
  readonly status: string;
  readonly total: string | null;
  readonly orderReference: string;
  readonly paymentUrl: string | null;
  readonly orderKey: string | null;
}
interface RawOrderRef {
  readonly id: number;
  readonly number?: string | number;
  readonly status?: string;
  readonly total?: string;
  readonly payment_url?: string;
  readonly order_key?: string;
  readonly meta_data?: ReadonlyArray<{ key: string; value: unknown }>;
}
function toOrderCreated(r: RawOrderRef, orderReference: string): WooOrderCreated {
  return {
    id: String(r.id),
    number: r.number !== undefined ? String(r.number) : String(r.id),
    status: r.status ?? 'unknown',
    total: r.total ?? null,
    orderReference,
    // WooCommerce returns an empty string for `payment_url` on an order with nothing to pay; curate
    // that to null so the consumer's "is there a pay link?" is a plain null check, not "" vs absent.
    paymentUrl: r.payment_url ? r.payment_url : null,
    orderKey: r.order_key ?? null,
  };
}
function orderRef(r: RawOrderRef): string | undefined {
  const found = (r.meta_data ?? []).find((m) => m.key === ORDER_REF_META_KEY);
  return typeof found?.value === 'string' ? found.value : undefined;
}

// --- Category writes (round 2) — reuse the RawCategory/WooCategory shapes above ---
const createCategoryInput = z
  .object({
    name: z.string().min(1),
    parent: z.string().regex(/^\d+$/, 'parent must be a numeric category id').optional(),
    description: z.string().optional(),
  })
  .strict();

const updateCategoryInput = z
  .object({
    id: z.string().regex(/^\d+$/, 'id must be a numeric category id'),
    name: z.string().optional(),
    parent: z.string().regex(/^\d+$/, 'parent must be a numeric category id').optional(),
    description: z.string().optional(),
  })
  .strict()
  .refine((a) => a.name !== undefined || a.parent !== undefined || a.description !== undefined, {
    message: 'at least one mutable field (name, parent, description) is required',
  });

function categoryWriteBody(a: {
  name?: string;
  parent?: string;
  description?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (a.name !== undefined) body.name = a.name;
  if (a.parent !== undefined) body.parent = Number(a.parent);
  if (a.description !== undefined) body.description = a.description;
  return body;
}

// ---------------------------------------------------------------------------
// Customers (round 2) — store-side customer management (/customers)
// ---------------------------------------------------------------------------

const listCustomersInput = z
  .object({ search: z.string().optional(), email: z.string().optional() })
  .strict();
const getCustomerInput = z.object({ id: z.string().min(1) }).strict();
const createCustomerInput = z
  .object({
    email: z.string().email(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
  })
  .strict();
const updateCustomerInput = z
  .object({
    id: z.string().regex(/^\d+$/, 'id must be a numeric customer id'),
    email: z.string().email().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
  })
  .strict()
  .refine(
    (a) =>
      a.email !== undefined ||
      a.firstName !== undefined ||
      a.lastName !== undefined ||
      a.phone !== undefined,
    { message: 'at least one mutable field (email, firstName, lastName, phone) is required' },
  );

interface RawCustomer {
  readonly id: number;
  readonly email: string;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly billing?: { phone?: string };
}

/** Curated customer. `phone` comes from the billing block (WooCommerce has no top-level phone). */
export interface WooCustomer {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly phone: string | null;
}

function toCustomer(c: RawCustomer): WooCustomer {
  return {
    id: String(c.id),
    email: c.email,
    firstName: c.first_name ?? null,
    lastName: c.last_name ?? null,
    phone: c.billing?.phone ?? null,
  };
}

/** WooCommerce puts the phone on the billing block, so a write threads it there. */
function customerWriteBody(a: {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (a.email !== undefined) body.email = a.email;
  if (a.firstName !== undefined) body.first_name = a.firstName;
  if (a.lastName !== undefined) body.last_name = a.lastName;
  if (a.phone !== undefined) body.billing = { phone: a.phone };
  return body;
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
      name: `mcp_${SLUG}_create_product`,
      description:
        'Create a simple product. `name` is required; optional regularPrice, salePrice, description, ' +
        'shortDescription, sku, categories (ids), stockQuantity/stockStatus, and status (defaults to ' +
        'draft). Does not set images.',
      input: createProductInput,
      handler: async (args, ctx) => {
        const res = await client.post(
          'products',
          createProductBody(args),
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
          // WooCommerce ignores stock_quantity unless manage_stock is on. Caveat (write-S0,
          // 2026-09-18): variations can report manage_stock:"parent" (stock owned by the parent).
          // Forcing manage_stock:true here flips that variation to independent tracking — a real
          // behavior change, not just a value set. Acceptable for v1 (the caller asked to set a
          // per-variation quantity, which requires independent tracking), but a targeted write-S0
          // probe on a parent-managed variation is a follow-up before we lean on this at volume.
          body.stock_quantity = args.stockQuantity;
          body.manage_stock = true;
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

    tool({
      name: `mcp_${SLUG}_create_order`,
      description:
        "Create an order for a buyer. `orderReference` is the CALLER's own id and is required: it is " +
        'the only handle by which a failed call can be reconciled (via reconcile_order) — never retry ' +
        'a create blind.',
      input: createOrderInput,
      handler: async (args, ctx) => {
        const body: Record<string, unknown> = {
          status: args.status,
          line_items: args.lineItems.map((li) => ({
            product_id: Number(li.productId),
            ...(li.variationId !== undefined ? { variation_id: Number(li.variationId) } : {}),
            quantity: li.quantity,
          })),
          meta_data: [{ key: ORDER_REF_META_KEY, value: args.orderReference }],
          ...(args.customerId !== undefined ? { customer_id: Number(args.customerId) } : {}),
        };
        if (args.customer !== undefined) {
          body.billing = {
            ...(args.customer.email !== undefined ? { email: args.customer.email } : {}),
            ...(args.customer.firstName !== undefined
              ? { first_name: args.customer.firstName }
              : {}),
            ...(args.customer.lastName !== undefined ? { last_name: args.customer.lastName } : {}),
            ...(args.customer.phone !== undefined ? { phone: args.customer.phone } : {}),
          };
        }
        if (args.shipping !== undefined) {
          const s = args.shipping;
          body.shipping = {
            address_1: s.address1,
            ...(s.address2 !== undefined ? { address_2: s.address2 } : {}),
            ...(s.city !== undefined ? { city: s.city } : {}),
            ...(s.state !== undefined ? { state: s.state } : {}),
            ...(s.postcode !== undefined ? { postcode: s.postcode } : {}),
            ...(s.country !== undefined ? { country: s.country } : {}),
            ...(s.firstName !== undefined ? { first_name: s.firstName } : {}),
            ...(s.lastName !== undefined ? { last_name: s.lastName } : {}),
            ...(s.phone !== undefined ? { phone: s.phone } : {}),
          };
        }
        const res = await client.post('orders', body, ctx.request, ctx.metadata);
        if (!res.ok) return wooError(res);
        return ok(toOrderCreated(res.data as RawOrderRef, args.orderReference));
      },
    }),

    tool({
      name: `mcp_${SLUG}_update_order`,
      description:
        "Update an order's status — notably to `cancelled` to void an order that will not be paid. " +
        'Idempotent: setting the status it already has is a no-op at WooCommerce.',
      input: updateOrderInput,
      handler: async (args, ctx) => {
        const res = await client.put(
          `orders/${encodeURIComponent(args.id)}`,
          { status: args.status },
          ctx.request,
          ctx.metadata,
        );
        if (!res.ok) return wooError(res);
        const r = res.data as RawOrderRef;
        return ok(toOrderCreated(r, orderRef(r) ?? ''));
      },
    }),

    tool({
      name: `mcp_${SLUG}_reconcile_order`,
      description:
        'Control-plane recovery: find an order by the caller-supplied orderReference to learn whether ' +
        'a create landed, before any retry. Withdrawn from the agent menu.',
      input: reconcileOrderInput,
      controlPlane: true,
      handler: async (args, ctx) => {
        // WooCommerce REST has no native filter-orders-by-meta_data, and write-S0 (2026-09-18) proved
        // `?search=<ref>` does NOT match meta_data (returned 0 for a real order carrying the ref). So we
        // fetch the most RECENT orders and confirm the match on meta_data in the adapter. `after` (the
        // caller's create-attempt time) bounds the window to the real uncertainty interval so volume
        // can't scroll the target off page 1; without it we fall back to the 100 newest. See
        // api-contract Q-3 (resolved).
        const res = await client.get('orders', ctx.request, ctx.metadata, {
          per_page: 100,
          orderby: 'date',
          order: 'desc',
          after: args.after,
        });
        if (!res.ok) return wooError(res);
        const match = (res.data as RawOrderRef[]).find((o) => orderRef(o) === args.orderReference);
        return ok(
          match
            ? { found: true, order: toOrderCreated(match, args.orderReference) }
            : { found: false },
        );
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
      name: `mcp_${SLUG}_create_category`,
      description: 'Create a product category (name, optional parent category and description).',
      input: createCategoryInput,
      handler: async (args, ctx) => {
        const res = await client.post(
          'products/categories',
          categoryWriteBody(args),
          ctx.request,
          ctx.metadata,
        );
        if (!res.ok) return wooError(res);
        return ok(toCategory(res.data as RawCategory));
      },
    }),

    tool({
      name: `mcp_${SLUG}_update_category`,
      description:
        'Update a product category (name, parent and/or description). Only the fields you pass change.',
      input: updateCategoryInput,
      handler: async (args, ctx) => {
        const res = await client.put(
          `products/categories/${encodeURIComponent(args.id)}`,
          categoryWriteBody(args),
          ctx.request,
          ctx.metadata,
        );
        if (!res.ok) return wooError(res);
        return ok(toCategory(res.data as RawCategory));
      },
    }),

    definePaginatedList<typeof listCustomersInput, WooCustomer, WoocommerceContext>({
      name: `mcp_${SLUG}_list_customers`,
      description: "List or search the store's customers (name, email).",
      input: listCustomersInput,
      handler: async (args, ctx) => {
        const res = await client.get('customers', ctx.request, ctx.metadata, {
          per_page: args.pageSize,
          page: args.page,
          search: args.search,
          email: args.email,
        });
        if (!res.ok) return wooError(res);
        const items = (res.data as RawCustomer[]).map(toCustomer);
        return { ok: true, items };
      },
    }),

    tool({
      name: `mcp_${SLUG}_get_customer`,
      description: 'Get one customer by id: email, name, and contact phone.',
      input: getCustomerInput,
      handler: async (args, ctx) => {
        const res = await client.get(
          `customers/${encodeURIComponent(args.id)}`,
          ctx.request,
          ctx.metadata,
        );
        if (!res.ok) return wooError(res);
        return ok(toCustomer(res.data as RawCustomer));
      },
    }),

    tool({
      name: `mcp_${SLUG}_create_customer`,
      description:
        'Create a customer (email required). Returns the customer id to link on create_order.',
      input: createCustomerInput,
      handler: async (args, ctx) => {
        const res = await client.post(
          'customers',
          customerWriteBody(args),
          ctx.request,
          ctx.metadata,
        );
        if (!res.ok) return wooError(res);
        return ok(toCustomer(res.data as RawCustomer));
      },
    }),

    tool({
      name: `mcp_${SLUG}_update_customer`,
      description: "Update a customer's email, name and/or phone. Only the fields you pass change.",
      input: updateCustomerInput,
      handler: async (args, ctx) => {
        const res = await client.put(
          `customers/${encodeURIComponent(args.id)}`,
          customerWriteBody(args),
          ctx.request,
          ctx.metadata,
        );
        if (!res.ok) return wooError(res);
        return ok(toCustomer(res.data as RawCustomer));
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
