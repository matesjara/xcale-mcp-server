# Wompi — Evidencia de Sandbox

> Diario de verificación (permitido en español: journal de trabajo fechado).
> Objetivo: que el `api-contract.md` solo contenga lo observado contra el API real de Wompi.

- **Fechas:** 2026-10-21 (parte 1, solo lectura) y 2026-10-22 (parte 2).
- **Entorno:** `https://sandbox.wompi.co/v1`.
- **Llaves:** las de prueba de Doppler (`xcale` / `dev`: `WOMPI_PUBLIC_KEY` `pub_test_…`, `WOMPI_PRIVATE_KEY` `prv_test_…`). Son de la cuenta **personal** de Mateo; él autorizó usarlas "desde que sea sandbox" (2026-10-22). Toda salida pasó por un filtro que tapa las llaves.
- **Pagos de prueba:** los hizo Sara en el navegador, con las tarjetas de prueba de Wompi.
- **Limpieza:** los links de prueba (`test_XGd2UH`, `test_JfBLcc`, `test_PtpZUv`) quedaron desactivados.

---

## Hallazgos transversales

1. **⚠️ Wompi repite la llave recibida en su mensaje de error.** Ejemplo: `401 INVALID_ACCESS_TOKEN` con `"El token proporcionado no tiene el formato correcto, se recibió: prv_test_…"`. El cliente nunca debe propagar ni registrar el cuerpo de error tal cual. (Una llave de prueba quedó así en el registro de una sesión → se pidió a Mateo regenerarlas.)
2. **Los rechazos de negocio vienen como texto, sin código.** El monto mínimo responde `422 UNPROCESSABLE` con un `reason` en español. No hay un código estable que leer.
3. **`single_use` no impide un segundo pago.** Después de un pago `APPROVED`, el link sigue `active: true` y la página de pago deja pagar otra vez.
4. **El filtro `payment_link_id` de `GET /v1/transactions` se ignora.** Las transacciones de un link se encuentran listando por fechas y filtrando del lado nuestro.

---

## Cuenta (llave pública)

### `GET /v1/merchants/{public_key}` → 200

Sin llave en el header (es público). Cuenta activa, `accepted_currencies: ["COP"]`. Medios aceptados: `CARD`, `PSE`, `NEQUI`, `DAVIPLATA`, `BANCOLOMBIA_TRANSFER`, `BANCOLOMBIA_QR`, `BANCOLOMBIA_COLLECT`, `BANCOLOMBIA_BNPL`, `BANCOLOMBIA`, `SU_PLUS`, `CARD_POS`. La respuesta trae datos del comercio (nombre, correo, teléfono): **no sirve como probe**, porque devuelve datos personales y no valida la llave privada.

---

## Llave privada (probe)

### `GET /v1/transactions?reference=<inexistente>` → 200

Con `Authorization: Bearer <prv_test_…>`: `{ "data": [], "meta": {} }`. Valida la llave privada sin crear nada ni devolver datos. **Es el `connectionProbe`.**

| Variante                                                        | Resultado                                                                                                                |
| :-------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| Llave inválida (`prv_test_` + texto cualquiera)                 | `401` `{ "error": { "type": "INVALID_ACCESS_TOKEN", "reason": "Llave no válida" } }`                                     |
| Sin llave                                                       | `401` `INVALID_ACCESS_TOKEN`, "Se esperaba una llave pública o privada pero no se recibió ninguna"                       |
| `GET /v1/payment_links?page=1&page_size=1` con la llave privada | `401 INVALID_ACCESS_TOKEN` ("no tiene el formato correcto" + **la llave**). Los links no se listan con la llave privada. |

---

## Crear un link

### `POST /v1/payment_links` → 201

```json
{
  "name": "Valoracion inicial (spike xcale)",
  "description": "Spike #1070 - sandbox",
  "single_use": true,
  "collect_shipping": false,
  "currency": "COP",
  "amount_in_cents": 15000000,
  "expires_at": "2026-10-24T14:36:01.000Z"
}
```

Respuesta (`data`): `id: "test_XGd2UH"` (prefijo `test_` en sandbox), `name`, `amount_in_cents`, `currency`, `single_use`, `description`, `sku: null`, `expires_at` (el que mandamos), `collect_shipping`, `collect_customer_legal_id`, `redirect_url`, `image_url`, `active: true`, `customer_data`, `created_at`, `updated_at`, `taxes: []`, `default_language: "es"`, `available_installments`, `merchant_public_key`.

- **No trae la URL de pago.** `https://checkout.wompi.co/l/test_XGd2UH` carga (`200`).
- **Solo la llave privada.** No hizo falta la llave de integridad.

| Variante                                                                    | Resultado                                                                                                                                                                                          |
| :-------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sin `description`                                                           | `422` `{ "error": { "type": "INPUT_VALIDATION_ERROR", "messages": { "description": ["No está presente"] } } }`                                                                                     |
| `amount_in_cents: 100` y `100000` ($1 y $1.000)                             | `422` `{ "error": { "type": "UNPROCESSABLE", "reason": "La base de la transacción debe ser igual o mayor a 150000 y/o el porcentaje de los impuestos deben ser menores a 50% del monto total" } }` |
| `amount_in_cents: 150000` ($1.500) con `sku: "pr_6712f0c1a9e4b2d3c4e5f601"` | `201`; `sku` vuelve tal cual. **Mínimo: 150000 centavos.**                                                                                                                                         |

### `GET /v1/payment_links/{id}` → 200

Con la llave pública. Devuelve el mismo objeto, con `active`.

---

## Desactivar un link

### `PATCH /v1/payment_links/{id}` `{ "active": false }` → 200

`data.active: false`, y al leerlo sigue `false`.

---

## Pagos y transacciones

Link `test_XGd2UH` ($150.000). Sara pagó primero con una tarjeta de rechazo y luego, **en el mismo link**, con una de aprobación.

| Transacción                 | Estado                                                                  | `reference`                        | `payment_link_id` |
| :-------------------------- | :---------------------------------------------------------------------- | :--------------------------------- | :---------------- |
| `11977675-1792680256-98745` | `DECLINED` (`status_message`: "La transacción fue rechazada (Sandbox)") | `test_XGd2UH_1792680105_4j0UfKjTy` | `test_XGd2UH`     |
| `11977675-1792680357-70475` | `APPROVED`                                                              | `test_XGd2UH_1792680297_4K9ybxbQs` | `test_XGd2UH`     |

- **Un rechazo no cierra el link**: se pudo reintentar.
- `reference` = `<linkId>_<timestamp>_<aleatorio>`, una por intento; no se conoce antes del pago.
- Después del `APPROVED`, el link sigue `active: true` y **la página de pago deja pagar otra vez** (Sara lo vio, 2026-10-22). Se desactivó a mano.

### `GET /v1/transactions/{id}` → 200

Campos: `id`, `status`, `status_message`, `amount_in_cents`, `currency`, `reference`, `payment_link_id`, `payment_method_type` (`CARD`), `payment_method`, `payment_source_id`, `created_at`, `finalized_at`, `customer_email`, `customer_data`, `billing_data`, `shipping_address`, `merchant`, `taxes`, `tip_in_cents`, `bill_id`, `disbursement`, `entries`, `refunds`, `redirect_url`.

### `GET /v1/transactions` (listado)

| Consulta                                                                                     | Resultado                                                                                                                                                                                |
| :------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sin `from_date` / `until_date` / `page` / `page_size` (solo `payment_link_id`)               | `422 INPUT_VALIDATION_ERROR`: `from_date` y `until_date` "No está presente"; `page` "Debe ser mayor a 0, menor o igual a 1000000"; `page_size` "Debe ser mayor a 0, menor o igual a 200" |
| `from_date=2026-10-22T00:00:00.000Z&until_date=2026-10-23T00:00:00.000Z&page=1&page_size=50` | `200`, las 2 transacciones; `meta: { page, page_size, total_results }`                                                                                                                   |
| Lo mismo `&payment_link_id=test_XGd2UH`                                                      | `200`, las mismas 2                                                                                                                                                                      |
| Lo mismo `&payment_link_id=test_NOPE00` (no existe)                                          | `200`, **las mismas 2** → el filtro se ignora                                                                                                                                            |
| Lo mismo `&status=APPROVED`                                                                  | `200`, solo la aprobada → `status` sí filtra                                                                                                                                             |
| `?reference=<exacta>`                                                                        | `200`, esa transacción                                                                                                                                                                   |
| `?reference=test_XGd2UH` (prefijo)                                                           | `200`, vacía                                                                                                                                                                             |

---

## Webhook (es del consumidor, no del provider)

- Prueba del 2026-10-22: se prendió el túnel ngrok de desarrollo de Sara y se pagó un link de $1.500. **No llegó ningún evento de Wompi**: el panel de sandbox de la cuenta no apunta a ese túnel. Ese túnel es también el de WhatsApp de dev.
- Según la documentación oficial: una URL de eventos por ambiente, configurada a mano en el panel; firma SHA256 en `X-Event-Checksum`. Queda para el consumidor (xcale-backend).
