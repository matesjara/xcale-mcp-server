# Toteat Provider — Tool Contract

> **Feature design**: [`feature-design.md`](./feature-design.md)
> **Pinned vendor spec**: `xcale-backend/docs/vendors/toteat/spec/`
> **Consumer notes**: `xcale-backend/docs/design/toteat-integration/api-contract.md`
> **Last updated**: 2026-08-05
>
> Every input schema below is the **zod source of truth**; the JSON Schema published on `tools/list`
> is generated from it and is never hand-written. All schemas are `.strict()` — an undeclared key
> yields `PROVIDER_INVALID_INPUT`.

---

## 1. Manifest

```ts
{
  slug: 'toteat',
  displayName: 'Toteat',
  category: 'restaurant-pos',
  schemaVersion: '2026-08-01',
  providerVersion: '0.1.0',
  logoUrl: '/assets/toteat.svg',
  capabilities: { webhooks: true },      // Toteat pushes; the consumer receives. Declared, not served here.
  connectionProbe: { tool: 'mcp_toteat_get_shift_status' },
}
```

`connectionProbe` is new and additive: a cheap, no-argument tool a consumer can call to prove a
pasted credential before writing a connection. Strictly declarative — a tool name, nothing else.
Rationale: `xcale-backend/docs/adr/credential-connections-for-mcp-backed-providers.md`.

## 2. Auth descriptor (non-secret, published in the catalog)

```ts
{
  type: 'api_key',
  credentialDelivery: 'forwarded',
  fields: [{ key: 'xapitoken', label: 'API token', placement: 'query' }],
}
```

One secret. `xir` / `xil` / `xiu` are **not** secrets and are not here — they travel as context.

## 3. Context schema

```ts
z.object({
  xir: z.string().min(1),   // restaurant id
  xil: z.string().min(1),   // venue (local) id
  xiu: z.string().min(1),   // user id
}).strict()
```

Published as the provider's `contextSchema`. Validated by the dispatcher **before** any handler runs.
`(xir, xil)` is the account identity — a restaurant may have several venues, and answering from the
wrong one is a cross-venue data leak, not a cosmetic bug.

## 4. Base URL and environments

| Environment | Base |
|:--|:--|
| Production | `https://api.toteat.com/mw/or/1.0/` |
| Development | `https://apidev.toteat.com/mw/or/1.0/` |

From deployment config (`TOTEAT_BASE_URL`). `*.appspot.com` is never used, including the host in the
spec's own `servers:` block — a test asserts it.

## 5. Response envelope — three shapes, and `ok` is the only failure signal

> **Verified live 2026-08-05.** See `xcale-backend/docs/design/toteat-integration/spec-vs-reality.md`.
> Where this section and the pinned OpenAPI spec disagree, **this section is right**.

| Shape | Observed on |
|:--|:--|
| `{ ok, msg: { texto, tipo }, data }` | `shiftstatus`, `orderstatus` |
| `{ ok, msg: { texto }, data }` — no `tipo` | `tables`, `products`, `sales`, `collection`, `orders/cancellation-report` |
| `{ ok, status_code, data }` — **no `msg`** | `salesbywaiter`, `inventorystate`, `accountingmovements` |

`msg` is an object, a string, or absent. **No code may assume `msg.texto` exists.**

`unwrap()` checks **the envelope, not the HTTP status**. This is not defensive programming — it is
the only thing that works: Toteat returns **`200` for every error except rate limiting**. A
status-only check reports a dead token as a successful call with `data: undefined`.

That lesson is already paid for in this repo — Cloudbeds answers some failures with `200` +
`success: false` — and Toteat is the stronger case.

Successful tool results return the provider's `data` **verbatim**. Fidelity over unification.

## 6. Error mapping

```ts
classifyToteatFailure(body: unknown): ProviderErrorCode
```

Observed responses, exhaustively:

| Real response | Code | Consumer effect |
|:--|:--|:--|
| `200` `{"msg":"Date has not a valid format","ok":false}` | `PROVIDER_INVALID_INPUT` | the agent corrects and retries |
| `200` `{"msg":"The maximum period to query is of 15 days","ok":false}` | `PROVIDER_INVALID_INPUT` | idem |
| `200` `{"msg":{"texto":"Not Authorized","tipo":7},"ok":false}` | **`PROVIDER_ERROR`** | consumer re-probes to decide — see below |
| `200` `{"msg":{"texto":"INVALID ORDER NUMBER","tipo":7},"ok":false}` | `PROVIDER_ERROR` | tool error |
| `200` `{"ok":false}` — no `msg` | `PROVIDER_ERROR` | tool error (a wrong `xil` looks like this) |
| `429` `{"msg":"Too many requests, rate limit exceeded: 3 per 1 minute…","ok":false}` | `PROVIDER_RATE_LIMITED` | consumer degrades to its mirror |
| transport failure / 5xx | `PROVIDER_UNAVAILABLE` | reads degrade, writes fail closed |

### Why `"Not Authorized"` must NOT map to `PROVIDER_AUTH_EXPIRED`

`GET /fiscaldocuments` with a **valid** token returns exactly
`{"msg":{"texto":"Not Authorized","tipo":7},"ok":false}` — byte-identical to an invalid token. The
cause is the POS's *Seguridad* tab, which allow-lists which routes an API entry may consume.

Mapping it to `AUTH_EXPIRED` means **one disabled route marks the whole connection as expired** and
the tenant is told to reconnect something that works perfectly. The adapter cannot tell the two apart
— it would need a second call, and it is stateless by design.

So the adapter reports `PROVIDER_ERROR` and the **consumer** decides by re-running the declared
`connectionProbe`: probe OK ⇒ the route is disabled; probe fails ⇒ the credential is dead. That
policy lives in the consumer (`toteat-integration/api-contract.md` §7), not here.

> **Alternative rejected:** adding `PROVIDER_CAPABILITY_DENIED` to `ProviderErrorCode`. It is a closed
> vocabulary that evolves additively **with an ADR**, and Cloudbeds has the same latent problem
> (`classifyEnvelopeFailure` routes "scope not granted" to `AUTH_EXPIRED`, with the same false-
> reconnect hazard). If it is ever added it should fix both at once — which makes it its own ADR, not
> a detail of this provider.

`tipo` is **not** a discriminator: `7` appears on both `"Not Authorized"` and `"INVALID ORDER
NUMBER"`, and `0` on success. It means "this is an error", nothing more.

**Error messages carry status and code only.** They never interpolate the response body (it may hold
provider data) and never the request URL (it holds `xapitoken`).

## 7. Tools

### 7.1 Serving a customer

#### `mcp_toteat_get_shift_status`
```ts
input: z.object({}).strict()
```
`GET /shiftstatus`. Returns `{ restaurantId, localNumber, status, date }`. `status: 'open'` is the
precondition for every order. **3/min.**

#### `mcp_toteat_get_tables`
```ts
input: z.object({}).strict()
```
`GET /tables`. Returns `[{ tableId, tableName, capacity, available, bookable, sectorId, sectorName }]`.

`available` is **current occupancy, not a calendar**. The description says so, because a tool
description is the only thing standing between that field and a model promising a table for 8pm.
**3/min.**

#### `mcp_toteat_get_menu`
```ts
input: z.object({ activeProducts: z.boolean().optional() }).strict()   // default true
```
`GET /products`. Returns products **and** modifiers in one flat list, discriminated by `isModifier`.
Each item carries `localCode` (the code that goes into an order), `price`, `referencePrice`,
`category`, `categoryId`, `sorting`, and `modifiers[]` with
`{ id, name, multi, minQuantity, maxQuantity, sorting }`.

Ordering products and modifiers by `sorting` A→Z reproduces the POS menu order.

**The association is a join, and the consumer must resolve it.** A product does not point at concrete
extras — it points at *categories* of extras:

```
product.modifiers[].id  ===  modifierProduct.categoryId
```

Observed on a real venue (193 items: 110 products + 83 modifiers; only 16 products carry groups):

```jsonc
{ "id": "SB020", "name": "Adicion Salsa Siloh", "price": 800,
  "modifiers": [{ "id": "BA.010", "name": "Deseas Agrandar Tus Papas Combo 3",
                  "multi": false, "minQuantity": 0, "maxQuantity": 3 }] }
{ "id": "SBEX046", "name": "Agrandado De Papa", "price": 3900,
  "isModifier": true, "categoryId": "BA.010" }
```

Without the join the agent knows a group called "Elige Tu Bebida" exists and cannot name a single
drink. The adapter returns the provider's shape verbatim; resolving the join belongs to the
consumer's mirror.

**Undocumented fields present in real responses**, returned as-is: `alcohol` (boolean),
`description` (string), `idToteat` (16-digit int — present on products, **absent on modifiers**).

**3/min — the tightest budget on the API,** and verified: the third call in a minute gets a real
`429` immediately. Buckets are **per endpoint** — exhausting `/shiftstatus` does not affect
`/products`. The description states plainly that this is a
synchronisation read, not a per-conversation read. The consumer mirrors it; this tool is what the
mirror is built from.

#### `mcp_toteat_create_order`
```ts
input: z.object({
  orderReference: z.string().min(1),          // the CALLER's id — the idempotency handle
  type: z.enum(['order', 'delivery', 'takeaway', 'pickup']),
  channel: z.enum(['webstore', 'crm', 'erp', 'pos', 'marketplace', 'app']),
  status: z.enum(['new','created','preparing','ready','ondelivery','delivered']).optional(),
  tableId: z.number().int().optional(),        // required when type === 'order'
  orderId: z.number().int().optional(),        // append to an existing TABLE order; omit to create
  comment: z.string().optional(),
  lines: z.array(z.object({
    productCode: z.string().min(1),
    quantity: z.number().int().positive(),
    comment: z.string().optional(),
    modifiers: z.array(z.object({
      productCode: z.string().min(1),
      quantity: z.number().int().positive(),
    })).default([]),
  })).min(1),
  customer: z.object({ /* name, lastName?, phoneNumber?, email?, fiscalId?, isBusiness?,
                          delivery?: { address, city, country, postalCode?, cityArea?,
                                       floor?, lt?, lg?, comment? } */ }).optional(),
  payment: z.object({
    amount: z.number(),
    amountPaid: z.number().optional(),
    tip: z.number().optional(),
    paymentType: z.number().int(),             // 1000 cash, 2000 credit, 3000 debit, 9001 transfer, …
    pending: z.boolean().default(false),       // true = recorded for the till to confirm
  }).optional(),
}).strict()
```

`POST /orders`. **1/s.**

Three things this schema does on purpose:

1. **`modifiers` is nested, not positional.** The adapter flattens it into Toteat's `line[]` with each
   modifier immediately after its product. The caller never composes the flat array, and the model
   never sees it.
2. **`orderReference` is required.** Toteat describes it as "the id sent by the external API user",
   and it is the only handle by which a caller can later discover whether a call it never got a
   response to actually landed. Making it optional would make idempotency impossible upstream.
3. **`payment` is create-time only.** There is no pay-an-open-order tool because the API has no such
   operation. `pending: true` records the full payment for the venue to confirm at the till.

`restaurantId` / `localNumber` are filled from context, never from input.

**Unknown product codes:** when the venue enables `TOTEATDVYERROR`, an unknown code is silently
accepted under a placeholder while keeping the original name and price. That is a silent success with
the wrong plate. The tool description names it, and the consumer validates codes against its menu
mirror first.

#### `mcp_toteat_get_order_status`
```ts
input: z.object({
  orderId: z.string().min(1),                                             // → `ic`
  detail: z.enum(['ONLY_STATUS','ALL_INFORMATION','DELIVERY_INFORMATION']).default('ONLY_STATUS'),
}).strict()
```
`GET /orderstatus`. Basic shape returns `{ orderReference, orderStatus, orderId, modificationDate,
deliveryStatusId }`.

`orderStatus` ∈ `OPEN` | `CANCELLED` | `CLOSED`. `deliveryStatusId` is the kitchen/delivery step:
40 new · 90 printed · 100 preparing · 110 ready · 120 out for delivery · 180 delivered · 170/172/175
cancelled variants · 200 collected. **10/s.**

#### `mcp_toteat_list_open_orders`
```ts
input: z.object({
  detail: z.enum(['ONLY_STATUS','ALL_INFORMATION','DELIVERY_INFORMATION']).default('ONLY_STATUS'),
}).strict()
```
`GET /orderstatus?listing`. Every `OPEN` order with its `orderReference`.

This is the **reconciliation primitive**: after a `create_order` whose response never arrived, a
caller finds its own `orderReference` here instead of retrying blind. **10/s.**

#### `mcp_toteat_dispatch_order`
```ts
input: z.object({
  orderId: z.string().min(1),
  dispatcher: z.object({
    name: z.string(), phoneNumber: z.string().optional(), email: z.string().optional(),
    vehicle: z.object({ type: z.string(), licensePlate: z.string().optional() }).optional(),
  }),
}).strict()
```
`POST /orders/dispatch`. **Legacy environments only** today — the description says so, and a migrated
venue gets a provider error rather than a silent no-op.

### 7.2 Answering the owner

All of these are period reads. **Each one uses its own parameter names and date format** — read from
its path file, never generalised — and every window is validated client-side before the call, because
a rejected call still burns one of three requests in that minute.

| Tool | Endpoint | Date params | Format | Window |
|:--|:--|:--|:--|:--|
| `get_sales` | `GET /sales` (+ `detail_cancel_order?`) | `ini` / `end` | `YYYYMMDD` | ≤ 15 d **(stated)** |
| `get_sales_by_waiter` | `GET /salesbywaiter` | `initial_date` / `final_date` | `YYYYMMDD` | not stated |
| `get_collection` | `GET /collection` | `date` | `YYYYMMDD` | single day |
| `get_cancellation_report` | `GET /orders/cancellation-report` | `start_date` / `end_date` | **`YYYY-MM-DD`** | not stated |
| `get_fiscal_documents` | `GET /fiscaldocuments` (+ `doc_type?`) | `ini` / `end` | `YYYYMMDD` | ≤ 15 d **(stated)** |
| `get_inventory_state` | `GET /inventorystate` | `initial_date` / `final_date` | `YYYYMMDD` | not stated |
| `get_accounting_movements` | `GET /accountingmovements` (+ `include_sales?`) | `initial_date` / `final_date` | `YYYYMMDD` | not stated |

Three distinct parameter namings and two date formats across seven endpoints — hence the rule of
reading each path file rather than generalising. The one that bites hardest is
`get_cancellation_report`: it is the **only** endpoint using `YYYY-MM-DD` with dashes.

All **3/min**. A window wider than the cap is rejected locally with `PROVIDER_INVALID_INPUT` and a
message that states the limit — the same text the provider would have returned, without spending the
request.

> **Verified live 2026-08-05:** all seven parameter namings above returned `ok: true` against the real
> API with exactly those names and formats. The 15-day cap was **confirmed only on `/sales`**
> (20260601→20260701 rejected with `"The maximum period to query is of 15 days"`); on the other five
> it could not be forced with an empty dataset. The client applies 15 days everywhere as a
> conservative default — an inference, not a contract, and flagged as such.
>
> **Also verified:** `/fiscaldocuments` answers `"Not Authorized"` with a valid token on the test
> venue, because the POS *Seguridad* tab does not allow-list that route. Route availability is a
> per-venue configuration fact, not a provider capability.

#### `mcp_toteat_create_purchase_movement`
```ts
input: z.object({
  documentNumber: z.string().min(1),
  supplier: z.object({ name: z.string(), fiscalId: z.string().optional() }),
  date: z.string(),
  lines: z.array(z.object({
    productCode: z.string().min(1),
    quantity: z.number().positive(),
    unitCost: z.number(),
    tax: z.array(z.object({ name: z.string(), value: z.number() })).optional(),
  })).min(1),
}).strict()
```
`POST /purchasemovements`. Registers an ingredient purchase invoice. **1/s.** A write into the
venue's accounting — it is not a diner-facing tool, and its description says so.

## 8. Webhooks — declared, not served

Toteat pushes four events. **This server does not receive them.** They are listed here because the
adapter's `capabilities.webhooks` declares them and a consumer needs to know what it is wiring:

| Event | Configured in (POS) | Payload note |
|:--|:--|:--|
| `menu_changed` | Productos | `partial: true` = delta · `false` = full menu (absent products are deletions) |
| `shifts_status_changed` | General | `data.status` |
| `order_status_changed` | Pedidos | `data` shape depends on the detail level chosen in the POS — three possible variants |
| `product_transfer` | Información del Integrador | needs Advanced Inventory + multi-venue + migrated env |

Two constraints the consumer must design around, both from the vendor:
`order_status_changed` only covers orders created through the same API entry unless Toteat Support
enables *Webhook Global* (one standard API per venue), and none of the four is signed — the only
authenticity control is the URL and whatever header the venue configures.

Ingest design: `xcale-backend/docs/design/toteat-integration/api-contract.md` §2.

## 9. Fixtures and tests

`__fixtures__/` holds anonymized real responses per tool. The suite must cover:

- **Envelope**: `ok: false` on a `200` is a failure.
- **Error discrimination**: the two `400` shapes map to different codes. Inverting the discriminator
  must turn a test red.
- **Positional modifiers**: `buildOrderLines` output order. Displacing one modifier must turn a test
  red.
- **Date windows**: 16 days is rejected before any HTTP call is made.
- **Credential redaction**: the guard lives in `core/__tests__/http.test.ts`, on
  `redactQueryValues` and on both `sendRequest` paths that produce `body`.

  > **Lesson from the mutation run.** The first version asserted only that a *tool result* was clean.
  > That test passed with the redaction deleted, because the adapter happens not to interpolate
  > `res.body` into its error message — so it proved the adapter's message construction, not the
  > control. `RequestResult.body` is a shared shape any provider or log sink may surface, so the test
  > belongs at that layer. Both tests are kept; only the core one goes red when the redaction is
  > removed.
- **Base URL**: no `appspot` anywhere in the built request.
