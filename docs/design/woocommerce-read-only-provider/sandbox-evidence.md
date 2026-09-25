# WooCommerce Sandbox Evidence (S0)

> Journal de verificación (permitido en español — journal de trabajo fechado).
> Objetivo: observar respuestas reales de WooCommerce REST v3 para quitar los `⏳` del `api-contract.md`.

- **Fecha:** 2026-09-14
- **Entorno:** LocalWP, WordPress + WooCommerce, base `http://localhost:10004/wp-json/wc/v3`
- **WooCommerce version:** `11.1.0` (visto en `order.version`)
- **Auth usada:** query-param (`consumer_key`/`consumer_secret`) sobre `http` local — confirma el fallback de Q-1. Llave **read-only**.
- **Formato de respuesta de listas:** array JSON al tope (no envuelto).

---

## Hallazgos confirmados

### `GET /products` y `GET /products/{id}`
- `id`: **number** (`12`) — el contrato asumía string → ajustar / coercionar a string en el resultado curado.
- `price` / `regular_price` / `sale_price`: **string** (`"100000"`) ✅ · `on_sale`: bool.
- `stock_status`: **`"instock"`** ✅ · `stock_quantity`: **number** (`46`) · `manage_stock`: bool.
- `sku`: string (`"CL-001"`).
- `type`: `"simple"` (para productos simples; `variations: []` vacío).
- `categories`: `[{ id (number), name, slug }]`.
- `images`: `[{ id, src, alt, thumbnail, ... }]` · `permalink`: string.
- `attributes`: `[{ id, name, options: string[], variation: bool }]` — `variation:false` cuando NO define variaciones.
- ⚠️ **`description`: HTML crudo** (mucho markup VTEX) · `short_description`: vacío en este dato. → el adaptador debe **quitar tags** (o preferir `short_description`) para uso conversacional.
- Ruido a descartar en el curado: `_links`, `price_html`, `meta_data`, `srcset`.

### `GET /products/categories`
- `[{ id (number), name, slug, parent (number), count (number), image: null|obj, description, display, menu_order }]` ✅ coincide con `WooCategory`.

### `GET /shipping/zones`
- `[{ id (number), name, order }]` ✅ coincide con `WooShippingZone`.
- ⚠️ WooCommerce **siempre añade la zona `id:0`** = `"Locations not covered by your other zones"` (catch-all) además de las creadas (aquí `id:1` = "Quindio"). El adaptador/agente debe tratar la 0 como el resto-del-mundo.

### `GET /orders`
- `{ id (number), number (string "14"), status ("processing"), currency ("COP"), total (string "400000"), customer_id (number), date_created (ISO), billing{}, shipping{}, line_items[], payment_url, needs_payment (bool), needs_processing (bool) }`.
- `line_items`: `[{ id, name, quantity (number), total (string), subtotal (string), product_id (number), variation_id (number), sku, price (number ⚠️), image }]`.
- ⚠️ **Inconsistencia de tipo:** `product.price` es **string**, pero `line_item.price` es **number**. → normalizar a string en el curado.
- Estado observado: `"processing"` (falta ver el set completo; WooCommerce estándar: `pending`, `processing`, `on-hold`, `completed`, `cancelled`, `refunded`, `failed`).
- `payment_url` existe (relevante para Fase 3, no v1).

---

### `GET /shipping/zones/{id}/methods`
- `[{ id, instance_id, title, order, enabled (bool), method_id ("free_shipping"|"flat_rate"), method_title, method_description (HTML), settings{...} }]`.
- ⚠️ **La tarifa NO está en un campo suelto** — vive dentro de `settings`:
  - `flat_rate` → `settings.cost.value` (ej. `"18000"`); **puede ser una fórmula** (`10.00 * [qty]`) según el `description`.
  - `free_shipping` → `settings.requires.value` (`min_amount`) + `settings.min_amount.value` (ej. `"250000"`) = umbral, no costo.
- `settings` trae mucho ruido (labels, tips, HTML, options). → curar a `{ method_id, title, enabled, baseCost: settings.cost?.value }` y descartar el resto. **Confirma R-6** (tarifa base, no cotización de carrito).

### Paginación (headers)
- ✅ Confirmado: `X-WP-Total: 1`, `X-WP-TotalPages: 1`. `Access-Control-Expose-Headers: X-WP-Total, X-WP-TotalPages, Link`.
- `definePaginatedList` lee esos headers para el `total`. Máximo `per_page` documentado como 100 (no estresado aún).

### `GET /shipping/zones/{id}/locations`
- ✅ **Confirmado (2026-09-17)** con una región asignada. Forma real: `{ code, type }` con `type` = `continent | country | state`. Ejemplo: `{code:"SA",type:"continent"}`, `{code:"CO",type:"country"}`, `{code:"CO:CO-QUI",type:"state"}` (el código de estado es `PAIS:ESTADO`).

### `GET /products/{id}/variations`
- ✅ **Confirmado (2026-09-17)** contra un producto variable (Talla S/M/L). Forma real por variación: `{ id (number), attributes:[{name,slug,option}], price (string "150000"), stock_status ("instock"), stock_quantity (number), sku }`. Nuestro curado `{ id, attributes:[{name,option}], price, stockStatus, stockQuantity }` calza. (`manage_stock` puede venir como `"parent"` en variaciones — no lo usamos.)

---

## Pendiente por capturar (para cerrar S0)

**Ninguno — S0 cerrado al 100% (9/9 endpoints confirmados).**

- [x] `GET /products/{id}/variations` — confirmado contra producto variable (2026-09-17).
- [x] `GET /shipping/zones/1/locations` — confirmado con región asignada (2026-09-17).
- [x] `GET /shipping/zones/{id}/methods` — capturado (tarifa en `settings.cost.value`).
- [x] Headers de paginación — `X-WP-Total` / `X-WP-TotalPages` confirmados.
- [x] `GET /orders/{id}` — el detalle coincide con el item de la lista (esperado).

---

## Impacto en el contrato (a aplicar al cerrar S0)

- `id` (product/category/order): documentar como **number** en el origen; el resultado curado lo expone como string (coerción).
- `description`: marcar que llega como HTML → el adaptador lo limpia.
- `price`: normalizar a string siempre (product vs line_item difieren).
- Zonas: documentar la zona `id:0` catch-all.
- Confirmar `stock_status`, `currency`, `total`, `line_items` (ya observados).
