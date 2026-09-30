# WooCommerce Read-Only Provider (v1) — API Contract

> **Companion of**: [feature-design.md](feature-design.md)
> **Module**: `woocommerce` provider (xcale-mcp-server) + Rail A connect (xcale-backend)
> **Status**: Draft — pending sandbox verification
> **Last Updated**: 2026-09-14

---

> ### ⚠️ Evidence status (binding)
> **S0 complete (2026-09-17):** all **9 endpoints** were verified against a real LocalWP WooCommerce sandbox (WC 11.1.0) — see [sandbox-evidence.md](sandbox-evidence.md). The last two shapes were confirmed on 2026-09-17: `get_product_variations` (against a variable product — `{ id, attributes:[{name,option}], price, stock }`) and `get_shipping_zone_locations` (`{ type, code }`, type `continent|country|state`). Real findings folded into the shapes below: id/price typing, HTML descriptions, shipping-zone `id:0` catch-all, rate in `settings.cost.value`, pagination headers, and the 401 error shape. Any remaining inline `⏳` hints in the illustrative code blocks are superseded by the implemented types in `src/providers/woocommerce/`.

---

## 1. Provider Contract (MCP)

### 1.1 Identity and auth (`server/discover`)

The provider is published in the MCP catalog with this descriptor (shape; exact types live in `src/core/provider-port.ts`):

```ts
// src/providers/woocommerce/auth.ts
export const woocommerceAuth: ProviderAuthDescriptor = {
  type: 'basic',                 // NEW scheme (ADR basic-http-auth-scheme)
  credentialDelivery: 'forwarded',
  // Consumer-agnostic: declared order IS the Basic order (consumer_key:consumer_secret).
  fields: [
    { key: 'consumer_key', label: 'Consumer Key' },
    { key: 'consumer_secret', label: 'Consumer Secret' },
  ],
};
```

```ts
// src/providers/woocommerce/manifest.ts (shape)
{
  slug: 'woocommerce',
  displayName: 'WooCommerce',
  category: 'ecommerce',
  schemaVersion: 1,
  providerVersion: 1,
  // storeUrl is call CONTEXT (not a secret), published as contextSchema:
  metadataSchema: z.object({ storeUrl: z.string().url() }).strict(),
}
```

- **Credential**: a single `SecretString` = `"${consumer_key}:${consumer_secret}"`, composed by the backend (Rail A) and forwarded (`forwarded`). The core materializer encodes it: `Authorization: Basic base64(secret)` (see §3).
- **Context (`contextSchema`)**: `{ storeUrl: string }` — the store base URL, validated at connect; forwarded per call as `X-Provider-Metadata`.
- **`accountKey`**: account identity = normalized `storeUrl` (declared via `identityKeys` if applicable).

### 1.2 Tools (v1, read-only)

Namespaced `mcp_woocommerce_{verb}`. The zod `input` is the single source of truth (JSON Schema is generated).

| Tool | WooCommerce REST v3 endpoint | Input (zod) | Notes |
|:--|:--|:--|:--|
| `mcp_woocommerce_list_products` | `GET /wp-json/wc/v3/products` | `{ search?, category?, stockStatus?, page?, pageSize? }` | `definePaginatedList`; catalog filters — **implemented S2** |
| `mcp_woocommerce_get_product` | `GET /wp-json/wc/v3/products/{id}` | `{ id: string }` | Detail; description stripped to plain text; returns variation ids — **implemented S3** |
| `mcp_woocommerce_get_product_variations` | `GET /wp-json/wc/v3/products/{id}/variations` | `{ id: string, page?, pageSize? }` | Per-variation price/stock (size/color) — **implemented S3**, shape confirmed |
| `mcp_woocommerce_list_categories` | `GET /wp-json/wc/v3/products/categories` | `{ page?, pageSize? }` | To filter/browse the catalog — **implemented S3** |
| `mcp_woocommerce_list_shipping_zones` | `GET /wp-json/wc/v3/shipping/zones` | `{}` | Configured zones (incl. `id:0` catch-all); not paginated — **implemented S4** |
| `mcp_woocommerce_get_shipping_zone_locations` | `GET /wp-json/wc/v3/shipping/zones/{id}/locations` | `{ id: string }` | Continent/country/state a zone covers — **implemented S4**, shape confirmed |
| `mcp_woocommerce_get_shipping_zone_methods` | `GET /wp-json/wc/v3/shipping/zones/{id}/methods` | `{ id: string }` | Methods + **base rates** (`baseCost` from `settings.cost.value`, may be a formula — not a cart quote, R-6); not paginated — **implemented S4** |
| `mcp_woocommerce_list_orders` | `GET /wp-json/wc/v3/orders` | `{ status?, after?, before?, page?, pageSize? }` | Owner use; filters by status/date — **implemented S5** |
| `mcp_woocommerce_get_order` | `GET /wp-json/wc/v3/orders/{id}` | `{ id: string }` | Detail: line items + condensed `customer` (contact + shipping address) — **implemented S5** |

> **Not a tool (by design):** a composite `get_shipping_options(location)` that resolves which zone applies to a customer address and returns its options is **not** an MCP tool — the zone-matching (country/state/postcode ranges) is WooCommerce-internal business logic and must not live in the adapter. If ever needed, it is a **backend use case** over the three thin shipping tools, decided separately. `list_coupons`/`list_payment_gateways` are also out of v1 (see feature design § Out of Scope / Fase 2).

### 1.3 Inputs (zod, shape)

```ts
// src/providers/woocommerce/tools.ts (inputs)
const listProductsInput = z.object({
  search: z.string().optional(),
  category: z.string().optional(),          // category id
  stockStatus: z.enum(['instock', 'outofstock', 'onbackorder']).optional(), // ⏳ verify values
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(), // WC max per_page = 100 ⏳
}).strict();

const getProductInput = z.object({ id: z.string().min(1) }).strict();
const getProductVariationsInput = z.object({
  id: z.string().min(1),                    // parent product id
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
}).strict();
const listCategoriesInput = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
}).strict();
// Shipping (thin, 1:1 with WooCommerce endpoints)
const listShippingZonesInput = z.object({}).strict();
const getShippingZoneLocationsInput = z.object({ id: z.string().min(1) }).strict(); // zone id
const getShippingZoneMethodsInput = z.object({ id: z.string().min(1) }).strict();   // zone id
const listOrdersInput = z.object({
  status: z.string().optional(),            // e.g. 'processing' | 'completed' ⏳ verify set
  after: z.string().datetime().optional(),  // ISO 8601
  before: z.string().datetime().optional(), // ISO 8601
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
}).strict();
const getOrderInput = z.object({ id: z.string().min(1) }).strict();
```

### 1.4 Result shapes (curated — the raw WooCommerce object is not dumped)

```ts
// Curated to high value; final field names to be confirmed against the store (⏳)
interface WooProductSummary {
  id: string;
  name: string;
  price: string;            // WC returns amounts as strings
  stockStatus: string;      // 'instock' | 'outofstock' | 'onbackorder' ⏳
  stockQuantity?: number | null;
  permalink: string;
}
interface WooProductDetail extends WooProductSummary {
  sku?: string;
  description?: string;
  categories: { id: string; name: string }[];
  images: { src: string }[];
  variations?: number[];    // ids; inline in v1, separate tool in Fase 2
}
interface WooOrderSummary {
  id: string;
  number: string;
  status: string;           // e.g. processing | completed | pending | cancelled | refunded | on-hold | failed
  currency: string;
  total: string;
  dateCreated: string;      // ISO 8601
  customerId: number | null;
}
interface WooOrderDetail extends WooOrderSummary {
  lineItems: { name: string; quantity: number; total: string; sku: string | null }[];
  // Owner-facing: the buyer's contact + full formatted shipping address to fulfil the order.
  customer: { name: string; email: string; phone: string; shippingAddress: string };
}
interface WooCategory { id: string; name: string; slug: string; parent?: string; count?: number }

interface WooProductVariation {
  id: string;
  attributes: { name: string; option: string }[]; // confirmed: [{ name: 'Talla', option: 'S' }]
  price: string;
  stockStatus: string;      // 'instock' | 'outofstock' | 'onbackorder'
  stockQuantity?: number | null;
}
interface WooShippingZone { id: string; name: string; order?: number }
interface WooShippingZoneLocation { type: string; code: string } // confirmed type: 'continent' | 'country' | 'state' (e.g. code "CO:CO-QUI")
interface WooShippingZoneMethod {
  id: string;
  methodId: string;         // 'flat_rate' | 'free_shipping' | 'local_pickup' ⏳
  title: string;
  enabled: boolean;
  baseCost?: string;        // configured base rate; NOT a cart-accurate quote (⚠️ see §2 note)
}
```

### 1.5 Pagination

WooCommerce paginates with `page` + `per_page` (max 100) and returns the totals in the `X-WP-Total` and `X-WP-TotalPages` response **headers** (confirmed in S0). List tools use `definePaginatedList`, which merges the uniform `page`/`pageSize` input and wraps the handler's items into the uniform `PaginatedResult`. The `pageSize → per_page` mapping is done by the tool.

> **v1 decision — Option A (no totals) [implemented S2]:** the core HTTP transport (`sendRequest` in `src/core/http.ts`) returns only the parsed body (`{ status, data }`), **not** the response headers — so the provider cannot read `X-WP-Total`/`X-WP-TotalPages`. List tools therefore return `{ items, page, pageSize }` and **omit** `totalPages`/`totalResults` (and thus `hasMore`), which `buildPage` permits. Surfacing headers would be a core-transport change (its own ADR); deferred until a real need. The agent still gets the full page of items.

---

## 2. Error Mapping (MCP)

| Situation | WooCommerce HTTP | `ToolResult` | Code |
|:--|:--|:--|:--|
| Invalid/revoked key | 401 / 403 | `kind: 'error'` | `PROVIDER_AUTH_EXPIRED` (triggers reconnect in Rail A) — centralized in `errors.ts` `wooError()` |
| Nonexistent resource | 404 ⏳ | `kind: 'error'` | generic mapping via `mapHttpStatusToErrorCode` |
| Rate limit / 5xx | 429 / 5xx | `kind: 'error'` | generic, not swallowed |

> Security rule (soul.md): error messages use **status/code**, never interpolate `res.body` or the store URL (it could carry data or the credential in the query fallback).

> **Shipping cost note (§2):** `get_shipping_zone_methods` returns each method's **configured base rate** (flat-rate amount, free-shipping threshold), not a per-cart total. The real cost is computed at checkout from cart contents/weight/classes/coupons (WooCommerce Store API — out of scope for v1). Tool results and the agent must present cost as "from / base rate", never as a guaranteed total.

---

## 3. Core `basic` Materialization Contract (additive)

The only touch to the core, justified in ADR [basic-http-auth-scheme](../../adr/0018-basic-http-auth-scheme.md).

```ts
// src/core/provider-port.ts — additive variant
type ProviderAuthDescriptor =
  | { type: 'api_key' | 'bearer'; ... }
  | { type: 'basic'; credentialDelivery?: CredentialDelivery }   // ← NEW
  | { type: 'oauth2'; ... }
  | { type: 'credential_exchange'; ... };

// src/core/auth/authentication-materializer.ts — new branch in the switch
case 'basic': {
  const encoded = Buffer.from(secret).toString('base64'); // secret === "ck:cs"
  headers.authorization = `Basic ${encoded}`;
  break;
}
```

- The `secret` that arrives is already `"ck:cs"` (composed by the backend). The core does **not** know `consumer_key`/`consumer_secret` separately — it stays single-secret.
- The `bearer`/`api_key`/`credential_exchange` branches are **untouched**; the `assertNever` default compile-forces the new variant to be implemented.

---

## 4. Backend — Rail A Connect Contract

Reuses the existing rail; there is **no** new rail.

### 4.1 Provider registration

```ts
// src/modules/connections/providers/woocommerce.ts (shape)
registerCredentialProvider({
  slug: 'woocommerce',
  authMethod: 'api_key',
  connectForm: [
    { key: 'storeUrl', label: 'Store URL', type: 'url', required: true },
    { key: 'consumer_key', label: 'Consumer Key', type: 'secret', required: true },
    { key: 'consumer_secret', label: 'Consumer Secret', type: 'secret', required: true },
  ],
  // accountKey = normalized storeUrl; metadata.storeUrl forwarded as context
  toResolvedCredential: (fields) => ({
    secret: `${fields.consumer_key}:${fields.consumer_secret}`, // composes "ck:cs"
    delivery: 'forwarded',
  }),
});
```

### 4.2 Endpoints (Rail A generics — already exist)

| Method | Route | Description |
|:--|:--|:--|
| `POST` | `/api/v1/connections/woocommerce/connect` | Validates `storeUrl` + tests key + stores encrypted |
| `GET` | `/api/v1/connections/woocommerce/callback` | N/A for api_key (no OAuth) |
| `POST` | `/api/v1/connections/woocommerce/reconnect` | Re-enter keys after `PROVIDER_AUTH_EXPIRED` |
| `GET` | `/api/v1/connections` | Statuses (never returns tokens/keys) |

### 4.3 Anti-SSRF validation of `storeUrl` (at connect)

Rule (blocking, R-1 in the feature design):
- **Require** `https`. Reject `http`.
- **Reject** `localhost`, `127.0.0.0/8`, private IPs (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`), and hosts not resolving to a public IP.
- **Normalize** (strip trailing slash, path down to the base) and store already validated.
- The MCP only builds routes over that validated base (`${storeUrl}/wp-json/wc/v3/...`).

```ts
// connect pseudo-DTO
interface WooConnectRequest {
  storeUrl: string;         // https, public domain (validated)
  consumer_key: string;     // secret
  consumer_secret: string;  // secret
}
// Response: standard envelope { success, data?, error? }; never returns the keys
```

---

## 5. Mock Data (⏳ to confirm against the store)

```jsonc
// tools/call → mcp_woocommerce_list_products (success)
{ "kind": "ok", "data": { "items": [
  { "id": "42", "name": "Black shirt M", "price": "59900", "stockStatus": "instock", "stockQuantity": 12, "permalink": "https://store.example.com/product/black-shirt-m" }
], "page": 1, "pageSize": 20, "total": 1 } }

// tools/call → get_order (not found)
{ "kind": "error", "code": "NOT_FOUND", "message": "order not found (HTTP 404)" }

// tools/call → any tool with a revoked key
{ "kind": "error", "code": "PROVIDER_AUTH_EXPIRED", "message": "provider auth failed (HTTP 401)" }
```

---

## 6. Agent Tool Specification

The 5 tools are discovered generically via the MCP catalog; the agent sees them with no special wiring. Namespaced `mcp_woocommerce_*`. No tool returns a `ui` object in v1 (text conversational responses). Customer PII is out (Fase 2).

---

## 7. Roadmap (contract impact)

| Phase | Contract change |
|:--|:--|
| **v1** | This document (5 read-only tools + `basic` + connect) |
| **Fase 2** | Tools `update_inventory`, `update_order_status`, `list_customers`/`get_customer`, `list_payment_gateways` (curated, no secrets), `get_product_reviews`, sales reports, richer variation modeling → new additive entries |
| **Fase 3** | Separate contract for the **Commerce vertical adapter** (idempotency, checkout, webhooks) in `xcale-backend` |

---

## 8. Verification plan (closes the Evidence status)

Before freezing the implementation, against a test WooCommerce store (LocalWP/Docker) with sample data and a read-only key, **observe and fix** in this contract (removing the `⏳`):

1. Real routes and responses of the 9 tools (exact field names, string vs number types).
2. The real order `status` set and `stock_status` values; the variation `attributes` shape and per-variation stock/price.
3. Shipping: zone/location/method response shapes, the `type` set for locations (`country`/`state`/`postcode`/…), and where each method's base rate lives in the payload.
4. Pagination headers (`X-WP-Total`, `X-WP-TotalPages`) and max `per_page`.
5. The real 401/403 error shape (code/field) to confirm the mapping to `PROVIDER_AUTH_EXPIRED`.
6. If a test host strips the `Authorization` header → decide Q-1 (query-param fallback `consumer_key`/`consumer_secret`).

> Store the evidence in a journal `docs/design/woocommerce-read-only-provider/sandbox-evidence.md` (Spanish allowed), as Siigo did.
