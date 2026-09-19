# WooCommerce Write Tools (Phase 2) — API Contract

> **Module**: `src/providers/woocommerce/` (MCP provider) — no HTTP surface of our own
> **Contract surface**: the MCP **tool contracts** (`defineTool` `input` zod → published JSON Schema via `tools/list`) + the WooCommerce REST calls each tool makes
> **Status**: Draft
> **Last Updated**: 2026-09-18
> **Feature Design**: [`feature-design.md`](./feature-design.md)
> **Language**: English (xcale-mcp-server repo rule)

> **Nature.** This is not a REST contract of xcale endpoints. The "endpoints" are **MCP tools** the provider publishes; each tool's `input` zod schema is the single source of truth (validates args AND generates the `tools/list` JSON Schema). The tables below give each tool's input, the WooCommerce REST call it makes, and its `ToolOutcome`.

> **Evidence status (evidence-before-contract).**
> - **read shapes** (product/variation/order fields): confirmed in read-v1 **S0** (`docs/design/woocommerce-read-only-provider/sandbox-evidence.md`; real store `woo-sandbox-01`, product id 14 `type: variable`, `regular_price`/`sale_price`/`status`/`stock_quantity`/`stock_status`).
> - **write fields**: from the WooCommerce REST API reference (stable, single-flavor) — https://woocommerce.github.io/woocommerce-rest-api-docs/. To be re-confirmed by **write-S0** (real writes against the live store during implementation).
> - **`reconcile_order` query** (find order by `meta_data`): **OPEN** — WooCommerce REST has no native filter-orders-by-meta param. Best current shape below; the exact recovery query MUST be verified in write-S0.
> - Live re-verification was attempted 2026-09-18 but the LocalWP Live Link was down (URL regenerates across restarts); it is restored for write-S0.

---

## 1. Tool Surface

| Tool | Published in `tools/list`? | WooCommerce REST call | Idempotent | Notes |
|:--|:--|:--|:--|:--|
| `mcp_woocommerce_update_product` | ✅ | `PUT products/{id}` | ✅ | Curated writable fields |
| `mcp_woocommerce_update_stock` | ✅ | `PUT products/{id}` or `PUT products/{productId}/variations/{id}` | ✅ | Stock only |
| `mcp_woocommerce_create_order` | ✅ | `POST orders` | ⚠️ via `orderReference` | Non-fiscal write; Toteat pattern |
| `mcp_woocommerce_reconcile_order` | ❌ `controlPlane: true` (routable) | `GET orders?…` (recovery query — OPEN) | ✅ (read) | Never on the agent menu |

- `requiredScopes`: **omitted** for all — WooCommerce is `basic` auth, no OAuth scope model (omitted ≠ `[]`; see `core/tool.ts`).
- Auth/context unchanged from v1: HTTP Basic `ck:cs` (forwarded), `storeUrl` context, SSRF-safe egress.

---

## 2. Tool Contracts

### 2.1 `update_product` — `PUT products/{id}`

```ts
// input (zod → JSON Schema). Only curated writable fields; omitted fields are left unchanged (PUT-merge).
input: z.object({
  id: z.string(),                                  // product id, path-encoded
  regularPrice: z.string().optional(),             // WC `regular_price` (string decimal, e.g. "150000")
  salePrice: z.string().optional(),                // WC `sale_price` ("" clears the sale)
  status: z.enum(['publish', 'draft', 'private']).optional(), // WC `status`
}).strict()
// At least one mutable field required (refine): id-only is a no-op and rejected as INVALID_INPUT.
```

- **Body sent**: only the provided fields, camel→snake mapped (`regularPrice`→`regular_price`, `salePrice`→`sale_price`, `status`).
- **Success `data`**: the curated updated product (same shape as read-v1 `get_product`).
- **Idempotent**: setting the same values twice yields the same result.
- **OPEN (Q-1)**: the exact writable field set — price + status is the v1 floor; confirm any others (e.g. `name`, `description`) with Sara/write-S0 before publishing.

### 2.2 `update_stock` — `PUT products/{id}` (or variation)

```ts
input: z.object({
  id: z.string(),                                  // product OR variation id
  productId: z.string().optional(),                // REQUIRED when `id` is a variation → PUT products/{productId}/variations/{id}
  stockQuantity: z.number().int().optional(),      // WC `stock_quantity`; sets `manage_stock: true` implicitly
  stockStatus: z.enum(['instock', 'outofstock', 'onbackorder']).optional(), // WC `stock_status`
}).strict()
// refine: at least one of stockQuantity/stockStatus; setting stockQuantity forces manage_stock: true.
```

- **Body sent**: `{ stock_quantity?, stock_status?, manage_stock: true when quantity set }`.
- **Variation routing**: `productId` present ⇒ hit the variation endpoint; absent ⇒ the product endpoint. (WooCommerce keeps variation stock on the variation, not the parent — confirmed by the read-v1 variation shape.)
- **Success `data`**: the curated updated product/variation with its new stock.
- **Idempotent**.

### 2.3 `create_order` — `POST orders` (Toteat pattern, non-fiscal)

```ts
input: z.object({
  orderReference: z.string().min(1),               // caller-supplied reconciliation tag (the recovery key)
  lineItems: z.array(z.object({
    productId: z.string(),
    variationId: z.string().optional(),
    quantity: z.number().int().positive(),
  })).min(1),
  customer: z.object({                             // condensed; optional for a guest order
    email: z.string().email().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
  }).optional(),
  status: z.enum(['pending', 'processing', 'on-hold']).default('pending'),
}).strict()
```

- **Body sent**: `{ line_items: [{ product_id, variation_id?, quantity }], billing?: {...}, status, meta_data: [{ key: '_xcale_order_ref', value: orderReference }] }`.
- **`meta_data`** carries the reconciliation tag (WC orders support arbitrary `meta_data`; leading `_` = hidden meta). This is the **primary recovery key** (CONTEXT.md: *Reconciliation reference tag*).
- **Success `data`**: the created order (id, number, status, total, line items, the echoed `meta_data` ref).
- **No blind retry**: on a lost response the caller calls `reconcile_order` (§2.4), never re-POSTs.
- **Non-fiscal write**: correctable in place (cancel/edit), no tax authority, no `Confirm signal` machinery at the MCP layer.

### 2.4 `reconcile_order` — control-plane recovery (query OPEN)

```ts
input: z.object({ orderReference: z.string().min(1) }).strict()
// controlPlane: true  → routable, withdrawn from tools/list (never an agent move)
```

- **Purpose**: answer "did my `create_order` land?" by finding the order carrying `_xcale_order_ref == orderReference`, **before** any retry.
- **Success `data`**: `{ found: boolean, order?: <curated order> }`.
- **⚠️ OPEN — the recovery query (verify in write-S0):** WooCommerce REST has **no native filter-orders-by-meta_data** param. Candidate mechanisms, in preference order:
  1. `GET orders?search=<orderReference>` — WC `search` scans some order fields; **verify it matches `meta_data`** (it may not by default).
  2. Store the ref **also** in a searchable field (e.g. `customer_note`) in addition to `meta_data`, so `search` reliably finds it. (Provider-internal; no consumer change.)
  3. Bounded client-side scan: `GET orders?after=<createAttemptTime>&per_page=N` and match `meta_data` in the adapter. Bounded by a short time window around the attempt.
  - **Decision deferred to write-S0**: pick the first mechanism the live store proves reliable; document it here once observed. This is the contract's single genuinely-unverified value.

---

## 3. Error Mapping (reused, no new codes)

`core/http.ts` `mapHttpStatusToErrorCode` governs all writes — no new `ProviderErrorCode`.

| WooCommerce response | HTTP | `ProviderErrorCode` | Consumer effect |
|:--|:--|:--|:--|
| `woocommerce_rest_cannot_edit` (Read-only key) | 401/403 | `PROVIDER_AUTH_EXPIRED` | Backend prompts **reconnect** (with a Read/Write key) |
| Invalid/missing field, bad price | 400/422 | `PROVIDER_INVALID_INPUT` | Surface to agent; fix args |
| Rate limited | 429 | `PROVIDER_RATE_LIMITED` | Consumer decides (no auto-retry) |
| Provider error / down | 5xx / network | `PROVIDER_UNAVAILABLE` | No auto-retry |
| Not found (bad id) | 404 | `PROVIDER_ERROR` | Surface |

- zod validation failures are caught by the dispatcher **before** the call → `PROVIDER_INVALID_INPUT`, no network spent.
- Error bodies are redacted (`redactQueryValues`) and never echo the credential.

---

## 4. Egress & Client (prerequisites)

- **W4 (first slice)** — `safe-egress.ts` gains the redirect method/body downgrade: on a 3xx, `303 → GET` + drop body; `301/302` conventionally drop the body for a non-GET; `307/308` preserve. Required because the manual redirect follow now carries non-GET method+body. Cross-origin credential strip (already shipped) still applies.
- **Client** — `createWoocommerceClient()` (GET-only today) gains `post(path, body, request, ctx)` and `put(path, body, request, ctx)`, building the same `${storeUrl}/wp-json/wc/v3/...` URL with the credential in the Basic header (never the URL).

---

## 5. Example Payloads

```jsonc
// update_stock (variation) — args
{ "id": "20", "productId": "14", "stockQuantity": 50 }
// → PUT products/14/variations/20  body: { "stock_quantity": 50, "manage_stock": true }
```

```jsonc
// create_order — args
{
  "orderReference": "xco-7b1f2e",
  "lineItems": [{ "productId": "14", "variationId": "20", "quantity": 2 }],
  "customer": { "email": "buyer@example.com", "firstName": "Ana" },
  // Shipping address for a physical order (commerce-driven addition). address1 is required when
  // present — a shipping block with no street is not dispatchable.
  "shipping": { "address1": "Cra 7 #45-10", "city": "Bogota", "country": "CO" },
  "status": "pending"
}
// → POST orders  body: { line_items:[{product_id:14,variation_id:20,quantity:2}],
//    billing:{ email:"buyer@example.com", first_name:"Ana" },
//    shipping:{ address_1:"Cra 7 #45-10", city:"Bogota", country:"CO" }, status:"pending",
//    meta_data:[{ key:"_xcale_order_ref", value:"xco-7b1f2e" }] }
```

```jsonc
// create_order — success ToolOutcome.ok data
// paymentUrl/orderKey are WooCommerce's customer-facing pay handle for an unpaid order (commerce-
// driven addition): the consumer hands paymentUrl to the buyer as the hosted checkout, or ignores
// it for an offline/COD flow. Both null when WooCommerce issues no pay link.
{ "id": "312", "number": "312", "status": "pending", "total": "300000",
  "orderReference": "xco-7b1f2e",
  "paymentUrl": "https://store.example.com/checkout/order-pay/312/?pay_for_order=true&key=wc_order_abc",
  "orderKey": "wc_order_abc" }
```

```jsonc
// reconcile_order — found
{ "found": true, "order": { "id": "312", "status": "pending", "orderReference": "xco-7b1f2e" } }
// reconcile_order — not found (safe to retry the create)
{ "found": false }
```

```jsonc
// error — Read-only key
{ "isError": true, "structuredContent": { "ok": false, "code": "PROVIDER_AUTH_EXPIRED" } }
```

---

## 6. Open Items → resolved in write-S0 / implementation

| # | Item | Resolution path |
|:--|:--|:--|
| Q-1 | Exact curated writable field set for `update_product` | Confirm with Sara; verify accepted fields in write-S0 |
| Q-2 | Whether `update_order_status` / `create_customer` join this phase | Driven by the backend checkout's needs (Mateo/Sara) |
| Q-3 | **The `reconcile_order` recovery query** (search vs mirror-in-note vs bounded scan) | **write-S0** — pick the mechanism the live store proves reliable |
| Q-4 | Variation vs simple product stock routing edge cases | write-S0 against a variable + a simple product |

---

## 7. Roadmap

| Phase | Scope | Contract impact |
|:--|:--|:--|
| **Phase 2 (this)** | WooCommerce write tools (MCP) | This contract |
| **Next (backend)** | Commerce-vertical integration for `create_order` | Separate contract in xcale-backend (adapter, checkout) |
| **Fast-follow** | `update_order_status`, `create_customer` if the checkout needs them | Additive to this contract |
