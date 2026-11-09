# Autocore Hotels — Evidencia de Staging

> Diario de verificación (permitido en español: journal de trabajo fechado).
> Objetivo: que el `api-contract.md` solo contenga lo observado contra el API real de Autocore.

- **Fecha:** 2026-11-09.
- **Entorno:** Staging, `https://api-stg.autocore.pro`. Autocore entregó a xcale llaves de **Staging** (no de
  Testing, `api-dev`): son las que da a los integradores.
- **Llaves:** `access_key` + `secret_key` de tipo _Session Token_, entregadas por Autocore por correo para
  matesjara/xcale-mcp-server#188. **Nunca se escriben en el repo.** El spike las recibió como variables de entorno
  de un solo proceso y toda salida pasó por un filtro que las tapa. Su lugar es Doppler (`xcale` / `dev_sara`, junto a
  `AUTOCORE_USER`, `AUTOCORE_PASSWORD` y `AUTOCORE_URL_STAGING` de la web app).
- **Hotel de prueba:** `hotel_id = 5` ("STG XCALE HOTEL"), procesador Redeban, monedas COP (principal) y USD.
- **Datos del huésped:** de prueba (`Jhon Doe`, `guest@example.com`); `temp_webhook_url` apunta a `example.com`,
  así que ningún webhook se recibió en este spike.

---

## Hallazgos transversales

1. **Solo el `Auth-Token` autentica.** Los headers `access_key` + `secret_key` (el esquema de Bookings) dan `401`
   en `GET /v2/hotels`. Resuelve **P-2**: la materialización es la variante imperativa (AD-2).
2. **Las llaves son por ambiente.** Las de Staging dan `401` en `api-dev.autocore.pro`. El ambiente de una conexión
   es `staging` o `production`.
3. **`GET /v2/common/transaction-status` no exige autenticación.** Sin ningún header responde `200` con el estado y el
   `external_ref_id` de un link, conociendo solo su `code` — que va en la URL que recibe el huésped. ⚠️ Reportar a
   Autocore.
4. **Crear un link valida casi nada.** Solo `guest_name` y `amount` son obligatorios (`422`). Acepta sin `email`, sin
   `description`, sin `currency`, con un monto con decimales, con una moneda que el hotel no tiene (`CRC`), con un
   medio de pago que el hotel no tiene (`nequi`) y con `$100`. Resuelve **P-5**: el email no es obligatorio.
5. **`external_ref_id` no es único.** Dos links con la misma referencia se crean los dos: no hay idempotencia, y un
   reintento ciego duplica el link.
6. **`GET /v2/links/schedule/<code>` es público** y devuelve nombre, email y teléfono del huésped (ver _La página de
   pago_). ⚠️ Reportar a Autocore.
7. **El checkout de Staging no deja pagar** ("Not found content type"): el camino pagado no se pudo observar (ver
   _Pagos_).
8. **Un link se puede anular**, aunque la documentación no lo diga: `DELETE /v2/bookings/chatbot/<code>` con el
   `Auth-Token` (ver _Anular un link_). Resuelve la mitad de **P-1**.
9. **Los errores no repiten las llaves.** Todos tienen la forma `{ "code": 0, "message": "Error http: <n>", "detail":
"<texto en español>" }`; `detail` es texto libre, sin código estable.

---

## Autenticación

### `GET /v2/hotels` con cada esquema

| Esquema                                                         | Resultado                                                                        |
| :-------------------------------------------------------------- | :------------------------------------------------------------------------------- |
| `Auth-Token: base64(access_key;ts;sha256_hex(secret_key + ts))` | `200`                                                                            |
| Headers `access_key` + `secret_key`                             | `401` `{"code":0,"message":"Error http: 401","detail":"Credenciales inválidas"}` |
| Sin auth                                                        | `401`, mismo cuerpo                                                              |
| `Auth-Token` construido con un secreto equivocado               | `401`, mismo cuerpo                                                              |
| `Auth-Token` válido contra `api-dev.autocore.pro`               | `401`, mismo cuerpo                                                              |

`ts` = segundos Unix, primeros 10 caracteres. La documentación dice que el token vale 30 s.

---

## Hoteles (probe)

### `GET /v2/hotels` → 200

```json
{
  "paginate_info": {
    "start": 0,
    "items": 10,
    "total_items": 1,
    "total_pages": 1,
    "links": {
      "first": "…?offset=0&limit=10",
      "previous": "…",
      "next": "…?offset=10&limit=10",
      "last": "…"
    }
  },
  "data": [
    {
      "id": 5,
      "is_archived": false,
      "is_active": true,
      "name": "STG XCALE HOTEL",
      "alias": "xcale_hotel",
      "address": "…",
      "logo_url": null,
      "contact_phone": "…",
      "currencies": [
        {
          "is_primary": true,
          "currency": { "name": "Peso Colombiano", "symbol": "$", "code": "COP" }
        },
        {
          "is_primary": false,
          "currency": { "name": "Dólar estadounidense", "symbol": "$", "code": "USD" }
        }
      ],
      "colors_schema": { "primary_color": "…" },
      "company": { "id": 2, "legal_personality": "…" },
      "hotel_services": [
        {
          "payment_method": { "code": "credit_card", "name": "Tarjeta de crédito" },
          "main_service": { "code": "payment_link", "name": "…" },
          "payment_gateway": { "code": "redeban", "name": "Redeban" },
          "payment_gateway_options": null,
          "commission": {
            "local_fee_percent": 0.0149,
            "international_fee_percent": 0.0149,
            "fixed_fee_amount": 0,
            "minimum_commission": 0,
            "auto_collect": false
          }
        }
      ]
    }
  ]
}
```

- **Limitado a las llaves:** `total_items: 1`, solo el hotel asignado. Resuelve **P-6**.
- La moneda es una lista (`currencies[]`, una `is_primary`), no un campo `currency` como dice la documentación.
- `hotel_services` dice qué servicios y medios tiene el hotel: aquí `virtual_terminal`, `payment_link` y `automated`,
  todos con `credit_card` por Redeban.
- Trae datos de la empresa (teléfono, razón social, comisiones) que el probe no devuelve.
- `next` y `last` apuntan a una página más allá del total aunque `total_pages` sea 1: la paginación se corta por
  `total_items`, no por `links.next`.
- Con un `hotel_id` que las llaves no alcanzan, crear un link responde `404` `"Hotel no encontrado"`.

---

## Crear un link

### `POST /v2/links/schedule/` → 200

Cuerpo enviado:

```json
{
  "hotel_id": 5,
  "amount": 150000,
  "currency": "COP",
  "guest_name": "Jhon Doe",
  "email": "guest@example.com",
  "description": "xcale spike link 1",
  "external_ref_id": "xcale-spike-001",
  "available_hours": 24,
  "temp_webhook_url": "https://example.com/xcale-autocore-webhook",
  "send_link_by_email": false
}
```

Respuesta:

```json
{
  "msg": "Link de pago generado exitosamente",
  "url": "https://app-stg.autocore.pro/payment/xcale_hotel/vlxcvpqhcjc8",
  "code": "vlxcvpqhcjc8",
  "reservation_id": null
}
```

La URL es `https://app-stg.autocore.pro/payment/<alias del hotel>/<code>`: viene en la respuesta, no se construye.
El link guardado trae `"source": "xcale"` (la fuente de la cuenta, puesta por Autocore) y `"country_code": "+57"` por
defecto.

### Lo que dice la documentación y no coincide

- La doc marca `email`, `description` y `currency` como obligatorios: el API los acepta ausentes.
- El ejemplo de la doc trae `"country_code": "57"` y la descripción pide alfa-2 (`CO`); el link guardado tiene `+57`.
- `source` es obligatorio solo si la cuenta tiene varias fuentes; la nuestra tiene una.
- Existe un link abierto (`POST /v2/links/open-schedule/`), fuera del alcance de la v1.

### Validación

| Variante                                                           | Resultado                                      |
| :----------------------------------------------------------------- | :--------------------------------------------- |
| Sin `amount`                                                       | `422` `"El campo 'amount' es requerido\n"`     |
| Sin `guest_name`                                                   | `422` `"El campo 'guest_name' es requerido\n"` |
| Cuerpo vacío                                                       | `422`, los dos mensajes en un solo `detail`    |
| Sin `email`                                                        | `200`, link creado                             |
| Sin `description`                                                  | `200`                                          |
| Sin `currency`                                                     | `200`                                          |
| `amount: 150000.5`                                                 | `200`                                          |
| `amount: 100`                                                      | `200`                                          |
| `currency: "CRC"` (el hotel tiene COP y USD)                       | `200`                                          |
| `allowed_payment_options: ["nequi"]` (el hotel solo tiene tarjeta) | `200`                                          |
| `external_ref_id` repetido                                         | `200`, un segundo link (`ucynerg01k2t`)        |
| `hotel_id: 6` (no alcanzado por las llaves)                        | `404` `"Hotel no encontrado"`                  |

La lista de links de la web app de Autocore muestra el de decimales como **$150.000,50 COP** y el de `CRC` como
**₡150.000,00 CRC**: Autocore guarda y cobra la fracción y la moneda tal como llegan.

---

## Anular un link

La web app de Autocore (`app-stg.autocore.pro`, sesión del usuario de Staging de xcale) tiene, en el menú de cada
link, **"Detalles"** y **"Cancelar cobro"**. Se canceló el link de prueba `gmoiew13h8zz` ($100 COP) con el registro de
red activo (2026-11-09, con el OK de Sara):

- La web app pide confirmación ("¿Seguro deseas cancelar el cobro?") y llama
  **`DELETE https://api-stg.autocore.pro/v2/bookings/chatbot/gmoiew13h8zz` → `200`**; muestra "Reserva cancelada
  correctamente" y el link queda **"Pago cancelado"**.
- **El mismo `DELETE` con el `Auth-Token` de la API** sobre el link ya cancelado → `200`
  `{ "msg": "Reserva cancelada correctamente" }`: funciona con nuestras llaves y es idempotente.
- Sin autenticación → `401` `"Credenciales inválidas"`.
- Después, `transaction-status` del link → `200` con `status_code: "cancelled"`, `status_detail: "Cancelado"`,
  `transaction_id: ""`.
- El checkout ya no lo procesa: `GET /v2/links/schedule/gmoiew13h8zz?validate_link_status=true` → `400`
  `"El link de pago no puede ser procesado. Estado: Cancelado"`.
- La ruta es la de la reserva del chatbot (la doc de Bookings documenta `GET /v2/bookings/chatbot/{chatbot_id}`, no
  el `DELETE`): el `code` del link es su `chatbot_id`.

No observado: anular un link ya pagado (bloqueado por el checkout, ver _Pagos_).

---

## Estado de un link

### `GET /v2/common/transaction-status?hotel_id=5&ref_number=<code>&transaction_type=payment_link` — sin pagar → 200

```json
{
  "voucher_url": null,
  "redirect_url": null,
  "details": {
    "type": "charge",
    "id": "vlxcvpqhcjc8",
    "external_ref_id": "xcale-spike-001",
    "status_code": "pending",
    "status_detail": "Pendiente",
    "comments": "",
    "transaction_id": "",
    "transaction_date": ""
  }
}
```

- **`ref_number` es el `code` del link.** Con nuestro `external_ref_id` responde `404` `"Link de pago no
identificado"`. Resuelve **P-3**.
- **Un link sin pagar es `200` con `status_code: "pending"`**, no un `404`. Resuelve la primera mitad de **P-7**.
- Sin transacción, `transaction_id` y `transaction_date` llegan como cadena vacía, no `null`.
- La misma llamada sin `Auth-Token` responde igual (hallazgo 3).

---

## La página de pago

- **El monto va en unidades mayores.** El link de `amount: 150000` muestra **$150.000 COP**. Resuelve **P-4**.
- El checkout (`app-stg.autocore.pro/payment/<alias>/<code>`) carga el link con
  `GET /v2/links/schedule/<code>?validate_link_status=true`, **sin autenticación**. La respuesta trae el nombre, el
  email y el teléfono del huésped, el monto, el estado (`status`, `main_status`), `payments[]`, `transactions[]`,
  `allowed_payment_options` y la configuración del hotel (`api_host_code: "redeban_dev"`, `hotel_services`). ⚠️
  Cualquiera con el código del link lee los datos del huésped: reportar a Autocore.
- El checkout pide los datos del comprador (tipo de persona, tipo y número de documento, contacto, si el comprador es
  quien recibe el servicio) antes de la tarjeta: Autocore los recoge, no el integrador.

## Pagos — bloqueado por el checkout de Staging

Sara intentó pagar (2026-11-09) con las tarjetas de prueba de Autocore:

| Link           | `allowed_payment_options` | Tarjeta de prueba | Resultado                               |
| :------------- | :------------------------ | :---------------- | :-------------------------------------- |
| `vlxcvpqhcjc8` | `[]`                      | Cobro exitoso     | "Pago fallido — Not found content type" |
| `uw1098c1q0vi` | `[]`                      | Cobro declinado   | "Pago fallido — Not found content type" |
| `32h6qurm204j` | `["credit_card"]`         | Cobro declinado   | "Pago fallido — Not found content type" |

- Con el registro de red del navegador activo, **ningún pago salió del navegador**: después de cargar el link, la
  única petición fue el reporte de error a Sentry. El fallo está en el frontend del checkout, antes de llamar al API.
  Un primer intento también registró `TypeError: Cannot read properties of undefined (reading 'spanish')`.
- Después del intento, el link sigue `pending`, sin `transaction_id`.
- No depende de `allowed_payment_options`. Lo más probable es la configuración del hotel 5 en Staging
  (`payment_gateway_options: null` en sus tres servicios de Redeban). Reportado a Autocore.

### La Terminal virtual del panel

Para separar el checkout de links del procesamiento, se probó la Terminal virtual de la web app de Autocore (sesión
del usuario de Staging de xcale, hotel 5, $1.000 COP, cliente de prueba):

- Carga el formulario de tarjeta y, al hacerlo, llama al API con éxito: `GET /v2/hotels…`, `/v2/otas`,
  `/v2/virtual-terminal/unique-code`, **`/v2/nuvei/session-token`** (una sesión del procesador Nuvei, aunque el hotel
  declara Redeban) y `/v2/exchange-rates`, todos `200`. La consola registra
  `TypeError: Cannot read properties of undefined (reading 'rate')` al cargar las tasas.
- Al cobrar con la tarjeta de prueba de cobro exitoso (lo hizo Sara a mano), responde
  **"El origen indicado no pertenece al usuario."**

El "origen" es el `source` de la cuenta (`xcale`, el que Autocore pone en cada link). El usuario o el hotel no lo
tienen bien asociado: es configuración de Autocore, y es la explicación más probable también del fallo del checkout
de links. Reportado.

**Sigue pendiente, hasta que Autocore lo arregle:** un pago `applied` y su voucher (monto y moneda pagados, **P-7**);
pagar dos veces el mismo link y anular uno pagado (**P-1**); los estados intermedios con las tarjetas pendientes (`1ig48efsia90`,
`5armyx2wbps0`); el webhook.
