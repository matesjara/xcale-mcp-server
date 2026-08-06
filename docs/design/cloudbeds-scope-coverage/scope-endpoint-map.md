# Cloudbeds — mapa scope → endpoints (evidencia para el diseño de tools)

> **Estado 2026-07-15.** Paso 2 del plan de cobertura por scopes. Este documento **no decide tools**:
> pone los números y las fuentes sobre la mesa para que el grill decida con datos. Todo lo de aquí está
> **leído de fuentes primarias**, no inferido.

## 1. Fuentes (primarias, verificables)

| Qué | Dónde | Cómo se obtuvo |
|---|---|---|
| Vocabulario canónico de scopes | `OAUTH APP URL` en App Details de la Xcale Partner Account | leído de la página, 2026-07-15 |
| Scope por operación | `github.com/cloudbeds/openapi-specs` › `src/pms-v1.3-openapi.yaml` | `security[].OAuth2[]` por operación |
| Respuesta del token | `developers.cloudbeds.com/reference/post_access-token-2` | esquema OpenAPI |

El índice para agentes está en `developers.cloudbeds.com/llms.txt` — es la vía rápida a los docs en Markdown.

## 2. Las tres capas de permiso (antes las tratábamos como una)

1. **Techo (app-wide).** El selector *Permission Scopes* de App Details. Es de **nuestra** cuenta de
   partner, no del cliente; define qué puede pedir la app xcale. Hoy: **32 scopes** marcados.
2. **Petición (por conexión).** La URL de authorize. **La construimos nosotros** — es la única capa que
   puede variar por cliente. Hoy NO varía: `providers/cloudbeds/auth.ts` fija 7.
3. **Concesión (por propiedad).** La decide el hotel en el consentimiento. Es la que produce
   `"Scope required for this call was not granted by property."`

**Consecuencia de diseño:** la composición por cliente vive en la capa 2 y siempre fue nuestra. Diseñar
contra la capa 2 nos hace inmunes a la incógnita de si un cliente ve o no la página de App Details.

### 2-bis. CORRECCIÓN 2026-08-05 — la capa que el hotel lee es la 1, no la 2

Lo anterior es cierto sobre lo que se **pide**, y llevó a una conclusión equivocada sobre lo que el
hotel **ve**. Observado en la propiedad 320754, en *Manage Apps* → la tarjeta de la app conectada:
Cloudbeds lista ahí **los 32 scopes del registro**, incluidos los siete que nuestra URL de authorize
nunca pidió (`read:adjustment`, `write:adjustment`, los cuatro `read:dataInsights*`,
`read:resourceReservations`, `read:resourceTypes`).

O sea: **el hotel lee y aprueba la capa 1 (App Details), no la 2.** Mientras el registro tuvo 32, a
cada hotel se le pidió permiso para ajustes financieros y Data Insights que ninguna tool ha llamado
jamás. Diseñar solo contra la capa 2 nos dejó ciegos a eso.

**Corregido el mismo día:** el registro quedó en **24** — exactamente la unión que derivan las tools.
Verificado tras guardar: los checkboxes de App Details y la URL de authorize que Cloudbeds genera
llevan los mismos 24, sin sobrantes ni faltantes. El espejo en `providers/cloudbeds/auth.ts` se
actualizó, y un test nuevo (`THE OTHER HALF`) falla si el registro vuelve a cargar un scope que
ninguna tool usa.

Es también, por fin, la razón concreta por la que Cloudbeds verifica *"only required permission scopes
are selected"* en la certificación: lo mira ahí porque ahí es donde el hotel lo lee.

## 3. Los 32 autorizados, repartidos entre APIs distintas

| Grupo | Nº scopes | Dónde vive | Consecuencia |
|---|---|---|---|
| PMS v1.3 | **24** | `pms-v1.3-openapi.yaml` | **69 operaciones** — la superficie real de tools |
| PMS v2.0 | 1 (`read:addon`) | `pms-v2.0-openapi.yaml` (`GET /addons/v1/addons`) | otra API, otro cliente HTTP |
| Data Insights | 4 (`read:dataInsights*`) | `cloudbeds-insights-v1.1-openapi.json` | **producto distinto** — ver §5 |
| Sin endpoint publicado | 3 | ninguna | ver §6 |

## 4. PMS v1.3 — el mapa con números

24 scopes → **69 operaciones únicas**. Hoy cubrimos 7 scopes con 13 tools.

| Scope | Ops | Estado | Métodos |
|---|---|---|---|
| `read:reservation` | 6 | YA | `getReservation`, `getReservationAssignments`, `getReservationNotes`, `getReservations`, `getReservationsWithRateDetails`, `getSources` |
| `write:reservation` | 6 | YA | `deleteReservationNote`, `postReservation`, `postReservationDocument`, `postReservationNote`, `putReservation`, `putReservationNote` |
| `read:guest` | 6 | YA | `getGuest`, `getGuestList`, `getGuestNotes`, `getGuestsByFilter`, `getGuestsByStatus`, `getGuestsModified` |
| `write:guest` | 8 | YA | `deleteGuestNote`, `postGuest`, `postGuestDocument`, `postGuestNote`, `postGuestPhoto`, `postGuestsToRoom`, `putGuest`, `putGuestNote` |
| `read:room` | 6 | YA | `getAvailableRoomTypes`, `getReservationRoomDetails`, `getRoomTypes`, `getRooms`, `getRoomsFeesAndTaxes`, `getRoomsUnassigned` |
| `read:hotel` | 3 | YA | `getFiles`, `getHotelDetails`, `getHotels` |
| `read:rate` | 3 | YA | `getRate`, `getRateJobs`, `getRatePlans` |
| `read:allotmentBlock` | 4 | NUEVO | `createAllotmentBlockNotes`, `getAllotmentBlocks`, `listAllotmentBlockNotes`, `updateAllotmentBlockNotes` |
| `write:allotmentBlock` | 3 | NUEVO | `createAllotmentBlock`, `deleteAllotmentBlock`, `updateAllotmentBlock` |
| `read:item` | 3 | NUEVO | `getItem`, `getItemCategories`, `getItems` |
| `write:group` | 3 | NUEVO | `patchGroup`, `postGroupNote`, `putGroup` |
| `read:group` | 2 | NUEVO | `getGroupNotes`, `getGroups` |
| `read:communication` | 2 | NUEVO | `getEmailSchedule`, `getEmailTemplates` |
| `write:communication` | 2 | NUEVO | `postEmailSchedule`, `postEmailTemplate` |
| `read:payment` | 2 | NUEVO | `getPaymentMethods`, `getPaymentsCapabilities` |
| `write:roomblock` | 2 | NUEVO | `postRoomBlock`, `putRoomBlock` |
| `read:roomblock` | 1 | NUEVO | `getRoomBlocks` |
| `write:adjustment` | 1 | NUEVO | `postAdjustment` |
| `read:appPropertySettings` | 1 | NUEVO | `getAppPropertySettings` |
| `read:currency` | 1 | NUEVO | `getCurrencySettings` |
| `read:customFields` | 1 | NUEVO | `getCustomFields` |
| `read:dashboard` | 1 | NUEVO | `getDashboard` |
| `read:taxesAndFees` | 1 | NUEVO | `getTaxesAndFees` |
| `read:user` | 1 | NUEVO | `getUsers` |

**Lectura:** la cola es larguísima y plana — 14 de los 24 scopes tienen **1 o 2 operaciones**. Eso
refuerza que la unidad no es una tool por endpoint: `read:currency` + `read:taxesAndFees` +
`read:customFields` + `read:appPropertySettings` son 4 scopes y 4 endpoints que un agente usa como **una
sola** pregunta ("¿cómo está configurada esta propiedad?").

## 5. Data Insights NO es una API de recursos

`cloudbeds-insights-v1.1-openapi.json` es **otro producto**: ~130 endpoints de reports, datasets, charts,
hubs, folders, schedules y exports. Auth **bearer JWT**, y **no declara scopes OAuth por endpoint** —
así que los 4 `read:dataInsights*` no se pueden mapear a operaciones desde el spec.

Es un constructor de informes, no un CRUD. "Dar cobertura a Data Insights" significa algo
cualitativamente distinto (ejecutar una query/report y devolver filas), y **merece su propia decisión**.
No debería colarse en el mismo lote que el resto.

## 6. Tres scopes autorizados sin endpoint publicado

`read:adjustment` · `read:resourceReservations` · `read:resourceTypes`

No aparecen en **ningún** spec publicado (v1.3, v2.0, insights, ni los demás del repo). Notable:
`write:adjustment` sí existe (`postAdjustment`) pero `read:adjustment` no tiene lector.

**Esto es una hipótesis, no un hecho:** *"no están en el spec"* ≠ *"no existen"*. Es exactamente la
lectura que este proyecto castiga. Se resuelve probando contra la propiedad, no leyendo.

### 6-bis. PROBADO 2026-08-02 — y el resultado separa dos casos que parecían uno

`probe coverage` contra la propiedad 320754, con **siete** deletreos plausibles para no confundir
*"adivinamos mal el nombre"* con *"no existe"*:

| Scope | Métodos probados | Resultado |
|---|---|---|
| `read:adjustment` | `getAdjustments` · `getAdjustment` · `getAdjustmentTypes` | **404 HTML — no such method** (×3) |
| `read:resourceTypes` | `getResourceTypes` · `getResources` | **404 HTML — no such method** (×2) |
| `read:resourceReservations` | `getResourceReservations` · `getResourcesReservations` | **404 HTML — no such method** (×2) |

Los 12 scopes con endpoint publicado respondieron `OK` en la misma pasada, así que el instrumento
estaba sano: el 404 no es del token ni de la propiedad, es del método.

**Veredicto:** en PMS v1.3 estos tres no tienen endpoint alcanzable. No se puede construir una tool
para ellos, y por tanto **no se pueden demostrar en la llamada de certificación**. Sigue sin poder
afirmarse que no existan *en ninguna parte* — solo se probó v1.3 — pero para decidir el registro de
scopes eso da igual: lo que no se puede llamar no se puede enseñar.

**El contraste que lo prueba, en la misma sesión:** `GET api.cloudbeds.com/addons/v1/addons`
(PMS **v2.0**, `read:addon`) respondió **`403 {"message":"You do not have correct scope to perform
this action"}`**. Un 403 por scope es exactamente lo contrario de un 404: dice *el endpoint está ahí
y te falta el permiso*. Es lo que convirtió `read:addon` de "sin cubrir" a **cubierto** —
`list_addons`, la primera tool de este provider contra v2.0.

**Lección de método:** un 404 y un 403 responden preguntas distintas. Probar un scope y leer solo
"falló" habría metido `read:addon` en el mismo saco que los tres muertos.

### 6-ter. `write:communication` es **create-only** (probado 2026-08-02)

Los dos endpoints del scope hacen cosas muy distintas y conviene no tratarlos como uno:

- `postEmailTemplate` — **crea una plantilla y no envía nada.** Es configuración: asunto y cuerpo
  multi-idioma, remitente, reply-to. Cloudbeds la declara *"exclusively available to third-party
  integration partners, not property client IDs"* — o sea, existe **para apps como la nuestra**.
- `postEmailSchedule` — **ata esa plantilla a un disparador y ahí sí se envía solo**: cambio de
  estado de la reserva (`confirmed`, `canceled`, `checked_in`, `checked_out`, `no_show`) o relativo
  al evento (`after_booking`, `before/after_check_in`, `before/after_check_out`) con desfase en días
  y hora del día. Piden que `scheduleName` lleve el nombre de la app.

**Lo que no está en el spec, y probamos:**

| Método | Verbo | Resultado |
|---|---|---|
| `deleteEmailSchedule` | DELETE | **no such method** |
| `putEmailSchedule` | PUT | **no such method** |
| `deleteEmailTemplate` | DELETE | **no such method** |
| `getEmailSchedule` | GET | **OK** — `data: []` (la propiedad hoy no tiene ninguno) |

(Probado con ids imposibles — `999999999` — precisamente para llegar al router sin tocar nada real.)

**Consecuencia de diseño:** se crea y **no se deshace por API**. Un schedule mal creado es una campaña
de correos automáticos a todos los huéspedes futuros de esa propiedad, y la única forma de pararlo es
que el hotel entre a su propio Cloudbeds. Pero **sí se puede leer de vuelta** (`getEmailSchedule`,
que ya cubrimos con `read:communication`) — y esa es la diferencia con `write:adjustment`, cuyo lector
directamente no existe. Escribir a ciegas y escribir sin borrado son riesgos distintos.

**Lo que esto habilita:** no es "que el agente escriba correos". Es que el hotel configure, **una vez
y a propósito**, sus correos automáticos de pre-llegada y post-estadía. Eso es plano de control, no
superficie de agente — la distinción que el flag `controlPlane` hizo posible.

**CONSTRUIDO 2026-08-02** — `create_email_template` + `schedule_email`, ambas `controlPlane: true`.
La baranda que costó descubrir: cada miembro de la unión de disparadores lleva `.strict()`, no solo
el objeto externo. Zod **descarta** claves desconocidas por defecto, así que
`{type:'reservation_status', status:'confirmed', days:3}` se habría convertido en silencio en un
envío al confirmar, mientras quien lo pidió creía haber programado tres días después — y sin borrado
para arreglarlo. **Un campo descartado en silencio es un correo que sale el día equivocado, para
siempre.**

## 7. Inconsistencias del proveedor que nos van a morder

- **Dos convenciones de nombres.** v1.3 usa `read:hotel`; v2.0 usa `hotel:read`. Invertido. Cualquier
  parser de scopes tiene que tratarlos como opacos, nunca partir por `:` y asumir orden.
- **v2.0 no es "v1.3 mejorado"** sino un conjunto de microservicios nuevos (`doorlock`,
  `market-segmentation`, `amenities`, `events`, `smart-policies`, `addons`). Rutas y estilo distintos.
- **El token no devuelve `scope`** (§8), así que la concesión no es legible desde el token.

## 8. El experimento decisivo (ejecutado 2026-07-15 — `probe coverage`)

**Pregunta:** pedimos 7 scopes; la propiedad autoriza 32. ¿Qué alcanza el token de verdad?

**Resultado: los 12 métodos reales probados → `SCOPE DENIED`, sin una sola excepción.**
`getUsers`, `getCurrencySettings`, `getTaxesAndFees`, `getCustomFields`, `getDashboard`, `getItems`,
`getGroups`, `getPaymentMethods`, `getRoomBlocks`, `getAllotmentBlocks`, `getEmailTemplates`,
`getAppPropertySettings`.

> **PRINCIPIO (adoptado):** el token está acotado por lo que **pedimos**, no por lo que la propiedad
> autoriza. Los otros 25 scopes son inalcanzables hasta que cambien `auth.ts` y el manifiesto del MCP.
> El cambio contractual no es una opción de diseño: es la única puerta.

⚠️ **El mensaje de Cloudbeds miente sobre la causa.** Dice *"not granted by property"*, pero la propiedad
**sí** los autoriza (los 32 están marcados en App Details). Lo que falta es que los pidamos. Quien lea el
mensaje literal buscará el permiso en el lado del hotel y no lo encontrará nunca.

### `/userinfo` — descartado como fuente de verdad

Funciona (`GET userinfo?property_id=…&role_details=true`) y devuelve `acl`, pero es **otro vocabulario**:
permisos de UI del usuario Cloudbeds (`hotel_profile`, `create_folios`, `view_spanish_police`…), no
scopes OAuth. No tiene relación con `read:reservation` y compañía.

**Corroboración lateral valiosa:** devuelve `user_id: 196623333724237` — exactamente el `actor.id`
observado cuando un humano cancela desde el panel (§7.2 del functional-design). La identidad del actor
queda confirmada por una segunda fuente independiente.

### Consecuencia dura

**No existe forma de *leer* lo concedido:** ni del token (sin campo `scope`), ni de `/userinfo` (es otra
cosa). **La única señal es la denegación en runtime.** Eso invalida "filtrar tools por
`connection.scope`" tal como estaba planteado y deja dos caminos honestos para el grill:

1. **Pedir los 32 y tratar la denegación como estado de la tool** (simple; la tool existe y responde
   "no autorizada" en vez de un error opaco).
2. **Sondear la cobertura al conectar** (un read barato por scope) y persistir lo alcanzable.

## 9. Hipótesis abiertas

| # | Hipótesis | Estado | Cómo cerrarla |
|---|---|---|---|
| H1 | El token no devuelve los scopes concedidos | ✅ **CONFIRMADA — observada en el cable** (2026-07-15, reconexión real). Keys de la respuesta: `["access_token","refresh_token","token_type","expires_in","resources"]`. **Sin campo `scope`.** El doc decía la verdad, pero ahora vale porque se observó | — |
| H3 | Una cuenta de hotel normal no ve App Details | ✅ **CONFIRMADA** — ver §10 | — |
| H4 | `/userinfo` expone lo concedido | ❌ **FALSADA** — `acl` es otro vocabulario | — |
| H5 | Los 3 scopes de §6 tienen endpoints no publicados | ✅ **son scopes VÁLIDOS** (están en el enum canónico de Cloudbeds, §11), pero ningún endpoint publicado los declara en `security` | qué protegen sigue sin saberse; no bloquea — y **no se piden**, porque sin endpoints no hay tools que los declaren |
| H6 | El verbo HTTP se deriva del prefijo del método (`put*` → PUT) | ❌ **FALSADA por el spec.** Era NUESTRA regla, no de Cloudbeds: se observó con `putReservation` y se generalizó. `putGroup` · `putRate` · `putAppPropertySettings` · `patchGroup` · `patchRate` son **POST** | cerrada: `client.ts` corregido + test que ancla ambos lados |
| H7 | `createAllotmentBlockNotes` (POST) necesita solo `read:allotmentBlock`, como dice el spec | ⚠️ **INCONCLUSA — y ahora INFALSABLE con esta conexión**: ver §12 | la tool declara ambos scopes (apuesta asimétrica). Para decidirlo hay que estrechar la petición primero |

## 12. La reconexión del 2026-07-16 rompió el instrumento de H7 (y qué probó)

**Confirmado tras la reconexión (predicho ANTES, sin retocar):**

| | Antes | Predicho | Observado |
|---|---|---|---|
| Suscripciones en Cloudbeds | 1 | **1** | ✅ **1** |
| `metadata.webhookSecret` | `1xiCwi8k…` | el mismo | ✅ **el mismo** |
| Scopes concedidos | 19 | **22** | ✅ **22** |

El secreto **sobrevivió**, así que el hook post-connect reutilizó la suscripción en vez de acuñar otra:
el arreglo del rail (`upsert` escribe `metadata` por clave) funciona **contra una reconexión real**, no
solo en tests. Antes habría habido 2, una huérfana 404-eando para siempre.

**Cobertura en vivo: 12/12 OK.** `read:group` era la última denegación y ya pasa.

**El coste, y es un principio general:** el experimento de H7 solo decide algo con un token que tenga
`read:allotmentBlock` y **NO** `write:allotmentBlock` — entonces éxito prueba que el spec acierta y
denegación que miente. Al conceder ambos, **el éxito ya no prueba nada**: cualquiera de los dos podría
estar autorizando la escritura. La propiedad seguía con cero blocks, así que la ventana se cerró sin
haberse podido usar.

> **Lección:** ampliar un grant es irreversible para la observación. Un token estrecho es un
> **instrumento**, y concederle scopes lo rompe. Si hay una pregunta que solo un token estrecho puede
> responder, hay que responderla **antes** de ampliar.

Para decidir H7 haría falta estrechar la petición en el MCP, reconectar (coste humano — ver
`cloudbeds-reconnect-is-costly`) y probar. No vale la pena por un scope de más; la apuesta asimétrica se
queda. `probe allotment` ahora **lee** los scopes concedidos y avisa de que el instrumento está romo —
antes afirmaba su premisa con una cadena hardcodeada que la reconexión volvió falsa.

## 10. El consentimiento es BINARIO — y eso lo cambia todo

**Confirmado por dos fuentes que coinciden:**

- `developers.cloudbeds.com/docs/integration-guide`, en segunda persona **al partner**: *"During development,
  **you'll** have access to change permission scopes for your additional API credentials, you'll find those
  within **your** App Details Page."* El propietario no la ve.
- **Observado** (JuanJo, 2026-07-15): la pantalla real de consentimiento lista *"Allowing access will share:
  read:rate, read:guest, read:hotel, read:reservation, read:room, write:guest, write:reservation"* —
  **una lista y un botón Allow. Sin checkboxes.** Exactamente los 7 de `auth.ts`.

> **PRINCIPIO (adoptado):** el hotel **no elige** scopes. Acepta o rechaza lo que **nuestro código** pide.
> La composición por cliente vive en la capa 2 y es nuestra. No hay atajo vía Cloudbeds.

### El giro: `connection.scope` es accidentalmente correcto

Si el consentimiento es binario, **lo pedido == lo concedido** siempre que la conexión exista. Así que
`connection.scope` —que guarda lo pedido— **sí es un registro fiel de lo que tenemos**. No porque lea la
concesión (no puede: §8), sino porque bajo consentimiento binario ambas coinciden.

**La tautología es real pero inofensiva**, con una excepción: los scopes que el **plan de la propiedad** no
incluye. *Eso* es lo que significa `"not granted by property"` — no una elección del usuario, sino una
capacidad ausente (`read:package` en un hotel sin Packages).

**Modelo honesto: pedido ⊇ concedido.** La diferencia son features que la propiedad no tiene, no
detectables por adelantado. **Filtrar tools por `connection.scope` es correcto**; la denegación en runtime
cubre el residuo. Es un diseño viable — y no requiere inventar nada nuevo.

⚠️ **Corolario de producto:** como el consentimiento es todo-o-nada, pedir los 32 a un hotel que solo
quiere ventas le presenta una pantalla que pide `read:payment`, `read:user` y `write:*`. Eso **no es
gratis**: es exactamente lo que hace que un consentimiento dé miedo, y `soul.md` pone Security primero.
El scope por conexión tiene valor real de producto, no es cosmético.

## 11. El vocabulario canónico: 61 scopes

`GET /integration/v1/connected-applications` (PMS v2.0) declara en el enum de su parámetro `scopes` **la
lista completa de scopes válidos de Cloudbeds: 61**. Los 32 nuestros están todos ahí (ninguno inventado).
Los 29 restantes, por si algún día hacen falta: `write:room`, `write:rate`, `write:payment`, `write:hotel`,
`write:item`, `read:housekeeping`, `read:package`, `read:houseAccount`, `read:nightAudit`,
`read:marketsegment`, `read:doorLockKey`, `read:externalOffer`, `read:dataInsightsInvoices`,
`read:dataInsightsFinancialTransactions`, los `delete:*`, etc.

**Ese endpoint devolvería `oauthScopes` por app conectada** — sería la fuente de verdad de la concesión.
**Pero está cerrado para nosotros:** probado en vivo → `HTTP 403 "Partner tokens are not allowed to access
this endpoint"`. Es para el API user de la propiedad, no para un partner. La conclusión de §8 se mantiene,
pero por otra razón: la fuente existe y no nos la dejan leer.

## 9. Lo que este documento NO decide

Qué tools existen, cómo se agrupan, y si el scope por conexión se implementa. Eso es del grill.
Los datos que necesitaba están arriba.
