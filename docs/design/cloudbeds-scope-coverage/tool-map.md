# Cloudbeds — mapa de tools por grupo de rol

> **Estado 2026-07-15.** Paso 3, después del grill. Los hechos están en `scope-endpoint-map.md`; las
> decisiones, en §1. Esto es una **propuesta con números**, no una implementación.

## 1. Lo que el grill fijó

| Decisión | Consecuencia para este mapa |
|---|---|
| Cada tool declara `requiredScopes` | la columna *scopes* de cada tabla **es** el contrato, no documentación |
| `auth.ts` deriva sus scopes de la unión de las tools | **el mapa determina qué se pide**; una tool no construida = un scope no pedido |
| La composición por agente es `enabledTools` (ya existe) | los grupos de abajo son **guía de curación**, no un mecanismo nuevo |
| Consentimiento binario ⇒ pedido == concedido | no hay que negociar scopes en runtime; solo el plan de la propiedad puede denegar |

**Corolario que decide el alcance:** Data Insights y los 3 scopes huérfanos quedan fuera **por
construcción** — sin tools, no se piden. No hay que decidirlo aparte.

## 2. La unidad: un trabajo, no un endpoint

69 operaciones. La propuesta son **~35 tools**, no 69. La regla, tomada de la curación de Composio que
este repo ya documenta (Shopify 490 → ~41): **una tool = una pregunta que un agente necesita hacer.**

El caso más claro son los cuatro scopes de configuración (`appPropertySettings`, `currency`,
`taxesAndFees`, `customFields`): 4 scopes, 4 endpoints de un solo GET, y para un agente son **una sola
pregunta** — *"¿cómo está configurada esta propiedad?"*.

## 3. Estado actual — 13 tools, 7 scopes

`list_reservations` · `get_reservation` · `get_guest` · `get_availability` · `create_reservation` ·
`modify_reservation` · `get_rate_plans` · `list_room_types` · `get_hotel_details` · `list_properties`
\+ 3 de webhooks (`list/ensure/delete_webhook_subscription` — **infraestructura, no superficie de agente**).

## 4. Grupo VENTAS — completar lo que ya existe (+7)

El eje mejor cubierto. Lo que falta son huecos del huésped y las notas.

| Tool | Ops | `requiredScopes` |
|---|---|---|
| `search_guests` | `getGuestList` + `getGuestsByFilter` + `getGuestsByStatus` — **3 endpoints, 1 tool** (el agente busca; el filtro es un argumento, no una tool distinta) | `read:guest` |
| `update_guest` | `postGuest`, `putGuest` | `write:guest` |
| `list_guest_notes` | `getGuestNotes` | `read:guest` |
| `add_guest_note` | `postGuestNote`, `putGuestNote`, `deleteGuestNote` | `write:guest` |
| `assign_guest_to_room` | `postGuestsToRoom` | `write:guest` |
| `list_reservation_notes` | `getReservationNotes` | `read:reservation` |
| `add_reservation_note` | `postReservationNote`, `putReservationNote`, `deleteReservationNote` | `write:reservation` |

**Fuera:** `postGuestDocument`, `postGuestPhoto`, `postReservationDocument` (subida de ficheros — no es
trabajo de agente conversacional); `getGuestsModified`, `getSources` (sincronización/BI, no diálogo).

## 5. Grupo ADMINISTRATIVO — el más lejano a hoy (+10)

| Tool | Ops | `requiredScopes` |
|---|---|---|
| `get_property_configuration` | `getAppPropertySettings` + `getCurrencySettings` + `getTaxesAndFees` + `getCustomFields` — **4 scopes, 4 endpoints, 1 pregunta** | `read:appPropertySettings`, `read:currency`, `read:taxesAndFees`, `read:customFields` |
| `get_payment_options` | `getPaymentMethods` + `getPaymentsCapabilities` | `read:payment` |
| `post_adjustment` | `postAdjustment` | `write:adjustment` |
| `list_groups` | `getGroups` | `read:group` |
| `list_group_notes` | `getGroupNotes` | `read:group` |
| `update_group` | `putGroup`, `patchGroup` | `write:group` |
| `add_group_note` | `postGroupNote` | `write:group` |
| `list_items` | `getItems` + `getItem` + `getItemCategories` | `read:item` |
| `list_email_templates` | `getEmailTemplates` + `getEmailSchedule` | `read:communication` |
| `list_users` | `getUsers` | `read:user` |

⚠️ **`post_adjustment` es financiero.** Publica un cargo/ajuste en una cuenta. `soul.md` pone Security
primero. **No debería entrar en la primera tanda**: merece decisión propia (¿confirmación humana?
¿límite?), y `write:adjustment` es el único write financiero del lote.

⚠️ **`write:communication` (crear plantillas/programaciones de email) queda fuera de la propuesta.** Un
agente que crea plantillas de correo del hotel es un riesgo sin caso de uso claro. Se lee, no se escribe.

⚠️ **`get_property_configuration` falla de forma atómica**: si el plan de la propiedad deniega uno de sus
4 scopes, la tool entera falla. Es el precio de agrupar por pregunta. Alternativa si molesta: partir en
4 tools triviales — pero eso es exactamente lo que la curación evita.

## 6. Grupo REVENUE / INVENTARIO (+8)

| Tool | Ops | `requiredScopes` |
|---|---|---|
| `get_dashboard` | `getDashboard` — la superficie de KPIs sin tocar Data Insights | `read:dashboard` |
| `list_room_blocks` | `getRoomBlocks` | `read:roomblock` |
| `create_room_block` | `postRoomBlock` | `write:roomblock` |
| `update_room_block` | `putRoomBlock` | `write:roomblock` |
| `list_allotment_blocks` | `getAllotmentBlocks` | `read:allotmentBlock` |
| `create_allotment_block` | `createAllotmentBlock` | `write:allotmentBlock` |
| `update_allotment_block` | `updateAllotmentBlock`, `deleteAllotmentBlock` | `write:allotmentBlock` |
| `allotment_block_notes` | `listAllotmentBlockNotes`, `createAllotmentBlockNotes`, `updateAllotmentBlockNotes` | `read:allotmentBlock` ⚠️ |

⚠️ **Rareza del proveedor, verificar antes de construir:** `createAllotmentBlockNotes` y
`updateAllotmentBlockNotes` son **POST** pero el spec los declara bajo **`read:allotmentBlock`**. O es un
bug del spec o Cloudbeds escribe bajo un scope de lectura. Declarar `requiredScopes` copiando el spec sin
comprobarlo propagaría el error a nuestro contrato. **Probar contra la propiedad.**

## 7. El número

| | Tools | Scopes |
|---|---|---|
| Hoy | 13 (10 de agente + 3 de infra) | 7 |
| Ventas | +7 | — |
| Administrativo | +10 (−1 si `post_adjustment` se aplaza) | — |
| Revenue / inventario | +8 | — |
| **Total** | **~38** | **24** (la unión derivada) |

**~38 tools sobre 69 operaciones.** Aterriza justo donde el propio repo dice que funciona (Shopify:
490 → ~41), y `auth.ts` pasaría de pedir 7 a pedir **24** — derivados, no escritos a mano.

## 8. Guardarraíl obligatorio antes de la primera tool

Un test que afirme **`unión(requiredScopes de todas las tools) ⊆ los 32 registrados en App Details`**.

Sin él, una sola tool que declare un scope no registrado (`write:room`, `read:housekeeping`…) mete ese
scope en la URL de authorize y puede **romper el connect de todos los clientes**. Es el mismo espíritu
que el ratchet del backend: mecánico, no interpretable.

## 9. Orden propuesto

1. **El guardarraíl** (§8) — antes de que exista la primera tool nueva.
2. **`requiredScopes` en las 13 existentes** + derivar `auth.ts`. Comportamiento idéntico (siguen siendo
   los mismos 7), así que es un refactor verificable **sin reconectar a nadie**.
3. **Administrativo** — el grupo más lejano a hoy, sin `post_adjustment`.
4. **Revenue / inventario** — resolviendo antes la rareza de §6.
5. **Ventas** — el que menos falta hace; ya funciona.

El paso 2 es el que convierte el grill en código sin arriesgar nada: mismo resultado, otra fuente.
