# Restofy Provider — API Contract

> **Module**: `src/providers/restofy/` (xcale-mcp-server). The connection's registration and the mint live in xcale-backend (Rail A); they are referenced here, not specified.
> **Kind**: external-provider adapter contract. It documents three surfaces: (A) **Restofy's API, as observed**, (B) the **`credential_exchange` authDescriptor**, (C) the **MCP tools** the provider publishes.
> **Upstream**: [feature-design.md](feature-design.md) · the evidence comments on matesjara/xcale-backend#2934 (2026-11-18).
> **Last updated**: 2026-11-18.

> **🔬 Evidence.** Every wire value below was observed on 2026-11-18 against Restofy's production API with a free Básico account xcale owns: restaurant _xcale Test Restaurante_ (`tenantKey` `xcaletestrestaurante`, public slug `xcale-test-resto`), 4 products in 2 categories, 2 modifier groups, channels _Domicilio propio_ (delivery) and _Para llevar_ (takeout), area _Salón Principal_. Test data is synthetic (contact "Comensal Prueba xcale", `+573001112233`). Writes made: 3 orders (`xcale-test-001`, `-004`, `-005`), 2 reservations created and cancelled, 1 contact. Where the docs and the wire disagree, the wire is written and the disagreement is named.

---

## 0. Resolved facts at a glance

| Datum                | Value                                                                                                                                           | Source                                     |
| :------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------- |
| Base URL             | `https://restofy.pro/api` — every call is `POST /api/{module}/{action}` with a JSON body                                                        | Observed                                   |
| Auth                 | `POST /auth/create-api-token` `{ apiKey, tenantKey }` → `200 { success, message, data: { accessToken, actorUuid, name } }`                      | Observed                                   |
| Token                | JWT, claims `actorUuid, name, tenantKey, exp`; **7 days**; no refresh endpoint; the restaurant is sealed in it (`X-Tenant-Key` not needed)      | Observed (the request page says otherwise) |
| Token placement      | `Authorization: Bearer <accessToken>`                                                                                                           | Observed                                   |
| Envelope             | always `{ success: boolean, message: string, data }`; `data` is `[]` on errors                                                                  | Observed                                   |
| Status codes         | `200` success; `400` every business and validation error (with a plain Spanish `message`); `401` invalid or expired token. No error codes.      | Observed                                   |
| Rate limit           | none documented, no headers sent                                                                                                                | Observed                                   |
| Money                | integers in **cents** of the restaurant's currency (COP 32.000 → `3200000`); quantities are decimal strings (`"2.0000"`)                        | Observed                                   |
| Order idempotency    | **`Idempotency-Key` header required** on `create-order` (dry runs included), undocumented; `externalReference` is the duplicate key             | Observed                                   |
| Integration channels | a new restaurant has only "En mesa", which integrations never see → `list-fulfillments` is empty until it creates a delivery or takeout channel | Observed                                   |
| Kitchen stages       | `cooking` / `ready` / `dispatched` are **not visible** through `integration/get-order`                                                          | Observed                                   |
| Contacts             | lookup by **exact** phone string; `set-party` on an existing phone **renames** that contact                                                     | Observed                                   |
| Reservations         | management create checks neither capacity nor party size; confirmed at once; slots only on the public diner surface                             | Observed                                   |

---

## A. Restofy's API — the observed wire

### A.1 Transport

`POST https://restofy.pro/api/{module}/{action}`, `Content-Type: application/json`, `Authorization: Bearer <accessToken>`. Field names are camelCase. A body `{}` is accepted where an action takes no parameter.

### A.2 Authentication — `POST /auth/create-api-token`

- Request: `{ "apiKey": "<the key, shown once in the panel>", "tenantKey": "<the account key>" }`. Both live in Rail A; this server never sees them.
- Response `200`: `{ success: true, message: "Operación realizada correctamente", data: { accessToken, actorUuid, name } }`. `name` is the key's user ("integracion xcale"). There is no expiry field; the JWT's `exp` is 7 days after the mint.
- A key that does not belong to the account fails the exchange with an authorization error (docs).
- A rejected token on a data call: `401 { success: false, message: "Token de autorización no es válido", data: [] }` (observed).

### A.3 Errors on data calls

`400 { success: false, message, data: [] }` for everything else. Messages observed, verbatim:

| Situation                                 | `message`                                                                                            |
| :---------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| `create-order` without `Idempotency-Key`  | `Falta la clave de idempotencia. Genera una e intenta de nuevo.`                                     |
| Same key, different body                  | `La clave de idempotencia ya se usó para otra operación. Genera una nueva e intenta de nuevo.`       |
| Required modifier group missing           | `Hamburguesa de la casa: el grupo "Término de la carne" requiere mínimo 1 selección(es), recibido 0` |
| Delivery without customer data            | `Falta el nombre, el teléfono o la dirección del cliente. Complétalos e intenta de nuevo.`           |
| Unknown `fulfillmentUuid`                 | `El canal de entrega no existe. Consulta los canales disponibles e intenta de nuevo.`                |
| Unknown or inactive `channelCode`         | `El canal no existe o no está activo. Revisa el código del canal e intenta de nuevo.`                |
| `get-order`, unknown reference            | `No encontramos ese pedido. Revisa el identificador o la referencia e intenta de nuevo.`             |
| `get-order` with neither id nor reference | `Indica el pedido por su identificador o por su referencia externa, uno de los dos. …`               |
| Reservation in the past                   | `La fecha de la reserva debe ser futura`                                                             |
| Cancel a cancelled reservation            | `La reserva no se puede cancelar en su estado actual`                                                |
| Slots with an unknown slug                | `El restaurante no está disponible. Vuelve a intentar más tarde.`                                    |
| Unknown action                            | `Acción no encontrada: <action>`                                                                     |

### A.4 `business-profile/get-business-profile` — `{}`

`data: { profile, schedule, timezone, isOpenNow }`. `profile`: `tradeName, managerName, phone, email, website, slug, addressLine1, addressLine2, countryCode, municipalityCode, city, stateRegion, latitude, longitude, description, cuisineCode, whatsapp, …`. `schedule: { dateStart, dateEnd, periods[] { dayOfWeek (1–7), isAllDay, timeStart, timeEnd }, exceptions[] }`. `timezone: "America/Bogota"`. `isOpenNow: boolean`.

### A.5 `tenants/get-tenant-info` — `{}`

`data: { slug, name, legalName, address, city, country, phone, taxId, ownerName, timezone, currency, locale }`. `slug` is the restaurant's public address (`restofy.pro/link/<slug>`). The slots endpoint accepted both the custom slug and the account key (observed).

### A.6 `integration/list-fulfillments` — `{ channelCode? }`

`data: { channelCode, fulfillments[], deliveryZones[] }`. Default channel `channel.staff.pos`.

- `fulfillments[]`: `{ fulfillmentUuid, fulfillmentName, fulfillmentTypeCode (fulfillment.delivery | fulfillment.takeout | …), fulfillmentTypeName, deliveryFeeMode (disabled | free | fixed | per_zone | manual), deliveryFixedFeeCents, deliveryMinFeeCents, deliveryMaxFeeCents, deliveryFreeAboveCents }`.
- `deliveryZones[]`: `{ fulfillmentUuid, deliveryZoneId, name, feeCents }`.
- Dine-in and room channels are never listed. A new restaurant answers `fulfillments: []`.

### A.7 `integration/list-catalog-products` — `{ fulfillmentUuid, channelCode?, menuId?, page?, limit? }`

`fulfillmentUuid` (36 chars) required. `page` and `limit` work though the docs' table omits them; `limit` defaults to 50 and is **capped at 100 silently** (`limit: 500` → `100`). `menuId` omitted → the first menu.

`data`:

- `menus[] { menuId, name, description }`, `categories[] { categoryId, name, productCount }`.
- `products[] { productId, productUuid, sku, menuId, categoryId, name, description, basePriceCents, requiresConfig, imageUrls, allergens[] { allergenId, name, contains: contains | may_contain | free } }`. `requiresConfig: true` when the product has a required group.
- `prices[] { productId, productPriceId, name, priceType, resolvedPriceCents }` and `priceOptions[] { productPriceId, productPriceOptionId, description, priceCents }` — empty when the restaurant set no alternate price; `basePriceCents` is then what is charged.
- `productModifierGroups[] { productId, modifierGroupId, name, description, minSelections, maxSelections }`, `modifiers[] { modifierId, modifierGroupId, name, priceCents, minQuantity, maxQuantity, defaultQuantity }` — **only for the products on this page** (observed).
- `pagination { page, limit, total, totalPages, hasNext, hasPrev }`.

### A.8 `integration/create-order`

Header **`Idempotency-Key`** (we send a UUID-shaped value). Body:

```ts
{
  externalReference: string;          // 1..60, the caller's own id; required
  fulfillmentUuid: string;            // 36
  channelCode?: string;               // ≤60
  dryRun?: boolean;                   // validate and price, save nothing
  notes?: string;                     // ≤500
  customerName?: string;              // ≤150
  customerPhone?: string;             // ≤30
  addressLine?: string;               // ≤300
  addressDetail?: string;             // ≤200
  municipalityCode?: string;          // ≤10
  reference?: string;                 // ≤300, a delivery landmark
  deliveryZoneId?: number;            // ≥1
  deliveryFeeCents?: number;          // ≥0, manual fee mode
  items: Array<{
    productId?: number; sku?: string; // one of them
    menuId: number; qty: number;      // qty 1..999
    note?: string;                    // ≤500
    productPriceId?: number; productPriceOptionId?: number;
    modifiers?: Array<{ modifierGroupId: number; modifierId: number; quantity: number }>;
  }>;
}
```

Response `data: { order, items[], itemModifiers[], isExistingOrder, isDryRun }`:

- `order: { orderUuid, orderCode, externalReference, lifecycleStatus, paymentStatus, channelCode, fulfillmentUuid, fulfillmentTypeCode, notes, subtotalCents, discountCents, taxCents, tipCents, deliveryFeeCents, grandTotalCents, paidCents, balanceCents, deliveryStatus, createdAt }`. `orderUuid` and `orderCode` are `null` on a dry run.
- `items[] { itemUuid, productId, name, qty, unitPriceCents, modifiersTotalCents, priceCents, lifecycleStatus, note }`, `itemModifiers[] { itemUuid, modifierId, name, quantity, unitPriceCents, totalCents }`.

Observed:

- A new order: `lifecycleStatus: "open"`, `paymentStatus: "unpaid"`, `deliveryStatus: "pending"` on delivery and `null` on takeout, items `confirmed`.
- **Idempotency:** same key + same body → the same order, replayed. New key + used `externalReference` → the existing order, `isExistingOrder: true`. Same key + another body → `400`.
- **Totals:** 2 × burger (32.000) + Queso extra (3.000 each) + 1 limonada (12.000) → `subtotalCents: 8200000`. The order is atomic.
- Delivery requires `customerName`, `customerPhone` and `addressLine`.

### A.9 `integration/get-order` — `{ orderUuid? , externalReference? }`

Exactly one of the two. Same `data` as A.8 without `isExistingOrder`/`isDryRun`. An integration only sees orders it created (docs). **No customer fields** in the response.

Status values: `lifecycleStatus` `open` (observed); `paymentStatus` `unpaid` (observed); `deliveryStatus` `pending`, `cancelled` (observed), `in_transit`, `delivered`, `failed` (documented on `pos-order/set-delivery-status`). Moving the order through `cooking`, `ready`, `dispatched` left all three unchanged.

### A.10 Contacts — `parties/*`

- `get-party-by-phone { phone }` (5..30): `data: { party }`, `party` = `{ id, phone, name, notes, creditType, creditLimitCents, accountId, addresses[], vehicles[], couriers[], invoiceRecipients[], suppliers[] }` or **`null`** when none matches (`200`). **Exact string match** (observed).
- `set-party { partyId?, name?, phone?, … 53 fields }`: creates or updates; `data: { party }`. Without `partyId`, a phone that already exists **reuses and updates** that contact (observed: the name was overwritten).
- `search { query (2..100), context? }`: `data: { parties[], pagination }`; matches names (not used in v1).

### A.11 Reservation areas

- `reservation-areas/list-reservation-areas {}`: `data: { reservationAreas[], pagination }`, rows `{ reservationAreaId, reservationAreaUuid, name, description, capacityMax, isOnlineBookable, requiresAdvance, advanceMode, advanceChargeType, advanceAmountCents, sortOrder, isActive, isAvailable }`.
- `reservation-areas/get-reservation-area { reservationAreaId }`: `data: { reservationArea }` with the rules as well: `minAdvanceMinutes, maxAdvanceDays, slotCapacity, minPartySize, maxPartySize, advanceHoldMinutes, advanceTerms, scheduleId, schedule`. New restaurant default: _Salón Principal_, `capacityMax 50`, `minAdvanceMinutes 120`, `maxAdvanceDays 30`, `slotCapacity 4`, party 1..8, `isOnlineBookable 0`.

### A.12 Slots — `diner-reservation/list-reservation-areas` (public)

`{ slug, reservationToken: null }` → `data: { areas[] { areaUuid, name, description, minPartySize, maxPartySize, advance, days[] { date: "YYYY-MM-DD", slots[] { iso, isFull } } }, occasions[] }`: every online-bookable area with its open days and their half-hour slots in UTC (`2026-11-21T01:00:00.000Z` = 20:00 Bogotá). Answers without a token (observed 2026-11-20). A day the area does not open is absent. This is what Restofy's own diner booking page reads; the former `list-reservation-slots` action answers `Acción no encontrada` since 2026-11-20 (observed).

### A.13 Reservations — `reservations/*` (permission `reservations.module`)

- `create-reservation { partyId, reservationAreaId, guestCount (1..255), reservedAt (future, **UTC with a `Z`suffix only** — an offset is refused:`reservedAt debe ser fecha/hora ISO-8601 en formato UTC con sufijo Z`, observed 2026-11-19), assignedTableId?, guestOccasionId?, durationMinutes? (15..600, default 90), notes? (≤2000) }` → `data: { reservationId }`, message `Reserva creada`. Confirmed at once. **Neither capacity nor party size is checked** (observed: 60 guests in an area for 50 with a maximum party of 8). Restofy reminds the contact by WhatsApp before the time (docs).
- `get-reservation-detail { reservationId }` → `data: { reservation }`: `{ reservationId, reservationUuid, partyId, partyName, partyPhone, reservationAreaId, areaName, assignedTableId, tableName, orderId, guestCount, guestOccasionId, occasionName, occasionIcon, reservedAt, durationMinutes, status, notes, prepaidAccountId, advanceAmountCents, advanceRequiredCents, advanceMode, advanceDueAt, confirmedAt, cancelledAt, cancellationReason, isAvailable, createdAt }`.
- `list-reservations { scope: today | upcoming | history, search? (≤100) }` → `data: { reservations[], pagination }` (rows as above without `areaName`, `tableName`, `orderId`, the timestamps and the reason). `search` matches notes, the contact's name and phone. Days are in the restaurant's timezone.
- `cancel-reservation { reservationId, cancellationReason (2..300) }` → `data: { reservationId }`, message `Reserva cancelada`; `status` becomes `cancelled`. Only `pending`, `confirmed`, `seated` cancel.
- `status` values: `confirmed`, `cancelled` (observed); `pending`, `seated`, `finished`, `no_show` (documented).

---

## B. The authDescriptor

```ts
export const restofyAuth: ProviderAuthDescriptor = {
  type: 'credential_exchange',
  credentialDelivery: 'reference',
  tokenEndpoint: 'https://restofy.pro/api/auth/create-api-token',
  method: 'POST',
  bodyFields: { apiKey: 'apiKey', tenantKey: 'tenantKey' },
  responseFields: { token: 'data.accessToken' },
  tokenTtlSeconds: 86_400,
  tokenPlacement: 'bearer_header',
};
```

- The connect form collects `apiKey` and `tenantKey`. These are field **names**, published by design (ADR 0020).
- `tokenTtlSeconds` is declared because the response has no expiry field; one day sits inside the observed 7 (feature design AD-2).
- **No `contextSchema`** and no `X-Provider-Metadata`: one token, one restaurant.
- No `connectionProbe`: a `credential_exchange` provider proves its credential by minting (Siigo, Erbon, Avirato).

---

## C. MCP tools

Names are `mcp_restofy_<verb>`. Every handler `POST`s to `https://restofy.pro/api/…` through the core's authenticated request.

- Results are Restofy's `data`, **verbatim** (Fidelity over Unification), with the exceptions named in C.2.
- **Menu** tools are published in `tools/list`, each with `audience: 'customer'`. **Control-plane** tools are routable but not listed (ADR 0013).

| Tool                         | Restofy                                                                | Surface       | `readOnly` | Identity policy                                                                                                                                                                                                                                                                                                     |
| :--------------------------- | :--------------------------------------------------------------------- | :------------ | :--------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_business_profile`       | `business-profile/get-business-profile`                                | menu          | ✓          | none                                                                                                                                                                                                                                                                                                                |
| `list_fulfillments`          | `integration/list-fulfillments`                                        | menu          | ✓          | none                                                                                                                                                                                                                                                                                                                |
| `list_catalog`               | `integration/list-catalog-products`                                    | menu          | ✓          | none                                                                                                                                                                                                                                                                                                                |
| `quote_order`                | `integration/create-order` (`dryRun: true`)                            | menu          | ✓          | none                                                                                                                                                                                                                                                                                                                |
| `get_order`                  | `integration/get-order` (`orderUuid`)                                  | menu          | ✓          | `subject-bound`, `identityFields: []`, `recordOwnershipField: 'orderUuid'`, `recordOwnershipKind: 'restofy:order'`, `recordAction: 'read'`                                                                                                                                                                          |
| `find_contact_by_phone`      | `parties/get-party-by-phone`                                           | menu          | ✓          | `subject-bound`, `identityFields: ['phone']`, `identityFieldKinds: { phone: 'phone' }`                                                                                                                                                                                                                              |
| `create_contact`             | `get-party-by-phone`, then `set-party` if none                         | menu          |            | `subject-bound`, `identityFields: ['phone']`, `identityFieldKinds: { phone: 'phone' }`                                                                                                                                                                                                                              |
| `list_reservation_areas`     | `list-reservation-areas` + `get-reservation-area`                      | menu          | ✓          | none                                                                                                                                                                                                                                                                                                                |
| `list_reservation_slots`     | `tenants/get-tenant-info` + `diner-reservation/list-reservation-areas` | menu          | ✓          | none                                                                                                                                                                                                                                                                                                                |
| `create_reservation`         | `reservations/create-reservation`                                      | menu          |            | `subject-bound`, `identityFields: []`, `recordOwnershipKind: 'restofy:reservation'`, `createdRecordIdField: 'reservationId'` — it reads nobody; the consumer records the created id as the writer's own (ADR 0023) [CTO 2026-11-19, xcale-backend#2935]                                                             |
| `find_reservations_by_phone` | `reservations/list-reservations` (`search`)                            | menu          | ✓          | `subject-bound`, `identityFields: ['phone']`, `identityFieldKinds: { phone: 'phone' }`, `recordLookup: true`, `recordKind: 'reservation'`, `resultItemsPath: 'items'`, `resultIdentityFields: { partyPhone: 'phone' }`, `resultRecordIdField: 'reservationId'`, `resultDateField: 'reservedAt'`, `projection` (C.2) |
| `get_reservation`            | `reservations/get-reservation-detail`                                  | menu          | ✓          | `subject-bound`, `identityFields: []`, `recordOwnershipField: 'reservationId'`, `recordOwnershipKind: 'restofy:reservation'`, `recordAction: 'read'`                                                                                                                                                                |
| `cancel_reservation`         | `reservations/cancel-reservation`                                      | menu          |            | `subject-bound`, `identityFields: []`, `recordOwnershipField: 'reservationId'`, `recordOwnershipKind: 'restofy:reservation'`, `recordAction: 'cancel'`                                                                                                                                                              |
| `create_order`               | `integration/create-order`                                             | control plane |            | none — its creator owns what it creates                                                                                                                                                                                                                                                                             |
| `find_order_by_reference`    | `integration/get-order` (`externalReference`)                          | control plane | ✓          | none — the caller reconciles its own reference                                                                                                                                                                                                                                                                      |
| `list_reservations`          | `reservations/list-reservations`                                       | control plane | ✓          | `subject-scoped` — names nobody, returns everyone's bookings; for the consumer's sync (#2936)                                                                                                                                                                                                                       |

### C.1 Inputs

```ts
// Ids: positive integers unless named Uuid (36-char UUID). Phones: E.164, /^\+[1-9]\d{6,14}$/.
// Dates: "YYYY-MM-DD". Datetimes: ISO 8601 with offset or Z.
get_business_profile:   {}
list_fulfillments:      { channelCode?: string }                                            // ≤60
list_catalog:           { fulfillmentUuid: string; menuId?: number; page?: number;          // page ≥1, default 1
                          limit?: number }                                                  // 1..100, default 100
type OrderLine = {
  productId: number; menuId: number; qty: number;                                           // qty 1..999
  note?: string;                                                                            // ≤500
  productPriceId?: number; productPriceOptionId?: number;
  modifiers?: Array<{ modifierGroupId: number; modifierId: number; quantity: number }>;     // quantity ≥1
};
type OrderDraft = {
  fulfillmentUuid: string;
  items: OrderLine[];                                                                       // 1..100
  customer?: { name?: string; phone?: string };                                             // ≤150, E.164
  delivery?: { addressLine: string; addressDetail?: string; reference?: string;             // ≤300, ≤200, ≤300
               municipalityCode?: string; deliveryZoneId?: number; deliveryFeeCents?: number };
  notes?: string;                                                                           // ≤500
  channelCode?: string;
};
quote_order:            OrderDraft                                                          // sent with dryRun: true
create_order:           OrderDraft & { externalReference: string }                          // 1..60
get_order:              { orderUuid: string }
find_order_by_reference:{ externalReference: string }                                       // 1..60
find_contact_by_phone:  { phone: string }
create_contact:         { phone: string; name: string }                                     // name 1..150
list_reservation_areas: {}
list_reservation_slots: { areaUuid: string; date: string }
create_reservation:     { partyId: number; reservationAreaId: number; guestCount: number;   // 1..255
                          reservedAt: string; durationMinutes?: number;                     // 15..600
                          guestOccasionId?: number; notes?: string }                        // ≤2000
find_reservations_by_phone: { phone: string; scope?: 'today' | 'upcoming' | 'history' }     // default 'upcoming'
get_reservation:        { reservationId: number }
cancel_reservation:     { reservationId: number; cancellationReason: string }               // 2..300
list_reservations:      { scope: 'today' | 'upcoming' | 'history'; search?: string;         // ≤100
                          page?: number; limit?: number }                                   // limit 1..100
```

- **The draft maps to Restofy's flat body:** `customer.name` → `customerName`, `customer.phone` → `customerPhone`, `delivery.*` → the same top-level names. Grouping them keeps the agent from mixing a delivery field into a takeout order; nothing is renamed beyond that.
- **The `Idempotency-Key` is derived, never an input** (feature design AD-6): `create_order` and `quote_order` send `uuid(sha256(externalReference ‖ canonicalJson(body)))`, formatted as a UUID. `quote_order` uses a fixed `externalReference` of `quote-` + the same hash, since Restofy requires one even on a dry run.
- **`create_order` takes no amount.** Restofy prices it from the restaurant's catalog; `deliveryFeeCents` exists only for the `manual` fee mode.
- `list_catalog` defaults `limit` to 100, Restofy's real cap, so a small menu is one call.

### C.2 Results

| Tool                         | `data` returned                                                                                                                                                                                                                                                                                                          |
| :--------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_business_profile`       | `{ profile, schedule, timezone, isOpenNow }` (A.4) verbatim, plus `tenant: { currency, slug, locale }` from `tenants/get-tenant-info` (A.5) — left out if that read fails                                                                                                                                                |
| `list_fulfillments`          | A.6, verbatim. An empty `fulfillments` means the restaurant has no delivery or takeout channel; the description says so.                                                                                                                                                                                                 |
| `list_catalog`               | A.7, verbatim                                                                                                                                                                                                                                                                                                            |
| `quote_order`                | A.8 `data`, verbatim (`isDryRun: true`, ids `null`)                                                                                                                                                                                                                                                                      |
| `create_order`               | A.8 `data`, verbatim, `isExistingOrder` included                                                                                                                                                                                                                                                                         |
| `get_order`                  | A.9 `data`, verbatim                                                                                                                                                                                                                                                                                                     |
| `find_order_by_reference`    | A.9 `data`, verbatim; an unknown reference answers `{ found: false }` (success), so a caller reconciling a lost response can tell "never landed" from an error                                                                                                                                                           |
| `find_contact_by_phone`      | `{ found: false }` when Restofy answers `party: null`; otherwise `{ found: true, contact: { id, phone, name, notes } }` — the sub-lists (addresses, invoice recipients, suppliers, couriers, vehicles) are left out                                                                                                      |
| `create_contact`             | `{ created: boolean, contact: { id, phone, name, notes } }`; `created: false` returns the existing contact **unchanged**, its name as the restaurant has it                                                                                                                                                              |
| `list_reservation_areas`     | `{ items: ReservationArea[] }` — each row of `list-reservation-areas` merged with its `get-reservation-area` rules (A.11); `schedule` and `scheduleId` left out                                                                                                                                                          |
| `list_reservation_slots`     | `{ slots: [{ iso, isFull }] }` verbatim. An area not bookable online, or a restaurant with no slug, answers `{ slots: [], reason }` with `reason` `"not_bookable_online"` `"no_public_address"` or, for an `areaUuid` the restaurant does not have, `"unknown_area"` — a fact, not an error                              |
| `create_reservation`         | `{ reservationId }` (A.13). `reservedAt` is taken with any offset and sent as the same instant in UTC (`Z`), the only form Restofy accepts                                                                                                                                                                               |
| `find_reservations_by_phone` | `{ items: Reservation[] }`: Restofy's rows for `search: phone`, **kept only where `partyPhone` equals the phone exactly** (Restofy's `search` also matches names and notes). Projection: `reservationId, reservedAt, durationMinutes, guestCount, status, reservationAreaId, occasionName, notes, partyName, partyPhone` |
| `get_reservation`            | A.13 `reservation`, verbatim                                                                                                                                                                                                                                                                                             |
| `cancel_reservation`         | `{ reservationId }`                                                                                                                                                                                                                                                                                                      |
| `list_reservations`          | `{ reservations, pagination }` verbatim                                                                                                                                                                                                                                                                                  |

**Descriptions carry the facts the agent needs** (wording in the implementation): `get_order` says kitchen stages are not visible; `create_reservation` says Restofy confirms at once and does not check capacity or party size, so read `list_reservation_areas` and `list_reservation_slots` first, and that Restofy reminds the diner by WhatsApp; `create_contact` says it never renames an existing contact; phones say E.164.

---

## D. Error mapping

| Restofy                                                         | `ToolResult`                                                                                                                         |
| :-------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| `401`                                                           | `PROVIDER_AUTH_EXPIRED` (the token expired or the key was revoked; a fresh mint or a reconnect fixes it)                             |
| `403`                                                           | `PROVIDER_ERROR` (a permission the key's user lacks; not observed, mapped by the canonical pattern)                                  |
| `429`                                                           | `PROVIDER_RATE_LIMITED` (not observed)                                                                                               |
| `400` with `message`                                            | `PROVIDER_INVALID_INPUT`, message: Restofy's `message` when it passes the redaction rule below, else `"Restofy refused the request"` |
| `400` `No encontramos ese pedido…` on `find_order_by_reference` | success, `{ found: false }`                                                                                                          |
| `200` with `success: false`                                     | `PROVIDER_ERROR` with the message under the same rule (not observed)                                                                 |
| `5xx`, network failure, timeout                                 | `PROVIDER_UNAVAILABLE`                                                                                                               |

**Redaction rule:** a message is forwarded only if it is ≤300 characters and contains no `{`, `}`, `http`, `Bearer`, `token=` or `key=`. Restofy's observed messages are plain sentences for a person and all pass. No error ever echoes the request URL, a header or the body (Credential-in-Transit-Only). The mint's own errors never reach this server: Rail A mints.

---

## E. Mock data (fixtures)

Recorded from the test restaurant on 2026-11-18, synthetic data only, one file per response under `src/providers/restofy/__fixtures__/`:

| Fixture                                                                                                          | From                                                                                                                                                                |
| :--------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `businessProfile.json`                                                                                           | A.4                                                                                                                                                                 |
| `tenantInfo.json`                                                                                                | A.5 (`slug: "xcale-test-resto"`)                                                                                                                                    |
| `fulfillments.json` / `fulfillmentsEmpty.json`                                                                   | A.6, with the two channels / a new restaurant                                                                                                                       |
| `catalog.json` / `catalogPage2.json`                                                                             | A.7, `limit: 100` / `limit: 2, page: 2`                                                                                                                             |
| `quote.json`                                                                                                     | A.8 dry run, 8.200.000 cents                                                                                                                                        |
| `order.json` / `orderExisting.json`                                                                              | A.8 `xcale-test-001`, then the same reference with a new key                                                                                                        |
| `orderDelivery.json`                                                                                             | A.9 `xcale-test-004`, `deliveryStatus: "pending"`                                                                                                                   |
| `partyFound.json` / `partyNull.json`                                                                             | A.10                                                                                                                                                                |
| `areas.json` / `area.json`                                                                                       | A.11                                                                                                                                                                |
| `dinerAreas.json`                                                                                                | A.12, one area, two days                                                                                                                                            |
| `reservationCreated.json` / `reservationDetail.json` / `reservationsUpcoming.json` / `reservationCancelled.json` | A.13                                                                                                                                                                |
| `errors/*.json`                                                                                                  | A.3: idempotency missing and reused, required modifier, delivery without address, unknown channel, order not found, past reservation, cancel twice, bad token (401) |

---

## F. Roadmap — what joins this contract, additively

- **Registering an external payment** on an integration order (`pos-payment` / `payments`), for xcale's Payment Request — once observed.
- **Reservation deposits** (`create-reservation-advance`).
- **Modifying a reservation** (`update-reservation`) and **guest occasions** (`guest-occasions/*`).
- **Contacts for the CRM** (`search`, addresses), with #2936's sync.
