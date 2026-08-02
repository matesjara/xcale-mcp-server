# Certificación de producción con Cloudbeds — informe de estado

**Fecha:** 2 de agosto de 2026
**Para:** Mateo Escobar
**De:** Juan José
**Alcance:** revisión detallada de la documentación oficial de certificación de Cloudbeds contra el
estado real de nuestro código, para responder a la pregunta *"¿qué nos falta de nuestro lado?"*

---

## 1. Resumen ejecutivo

Revisé la guía completa de certificación de Cloudbeds (las 8 etapas), los requisitos del artículo de
soporte, los de material de marketing, el blueprint de nuestra categoría y la especificación de
conexión/desconexión de apps. Luego contrasté cada punto contra el código de los tres repos.

**Conclusión corta:** técnicamente estamos mucho más cerca de lo que parece — la integración cumple 2
de los 3 puntos obligatorios de la llamada de certificación tal como está hoy. Pero hay **un hueco
técnico real** (el manejo de desconexión) y **dos entregables que nadie ha hecho todavía** (el
artículo de soporte y el material de marketing por formulario). Y hay un malentendido de proceso que
conviene aclarar antes de seguir: lo que Gabriela está esperando no son documentos nuestros, es la
**firma del acuerdo de conectividad**.

| Bloque | Estado |
|---|---|
| Acuerdo de partnership | ⚠️ Formulario enviado ≠ acuerdo firmado — es el bloqueante actual |
| Perfil de la app, fotos, políticas | ✅ Hecho (tu parte) |
| Artículo de soporte público | ❌ No existe |
| Material de marketing (Google Form) | ⚠️ Probablemente falta — es un entregable distinto del perfil |
| Ajuste de permisos (scopes) | ⚠️ Registrados 32, usamos 22 — hay que bajarlo |
| Autenticación (OAuth) | ✅ Cumple |
| Flujo de autorización / llamadas a la API | ✅ Cumple lo obligatorio de nuestra categoría |
| Conectar / desconectar apps | ❌ **No implementado — falla la llamada de certificación** |
| Segunda cuenta de prueba (Island 2) | ❌ No la tenemos, hay que pedirla |

---

## 2. Lo primero: qué está esperando Gabriela exactamente

Su frase es literal:

> *"In order to move with certification, it's necessary to have a Partnership agreement in place."*

Eso **no** es el formulario de la web. El formulario es la solicitud; lo que habilita la certificación
es el **Connectivity Agreement**, un acuerdo estandarizado que Cloudbeds emite después de revisar esa
solicitud (y un NDA si aplica). Es la Etapa 1 de su proceso y ninguna de las siguientes se puede
agendar sin ella.

Por eso, por mucho que pulamos documentos, la aguja no se mueve hasta tener ese acuerdo. **La
pregunta concreta que hay que hacerle a Gabriela es:** *"el formulario ya está enviado — ¿cuál es el
siguiente paso para tener el Connectivity Agreement firmado y cuánto suele tardar?"*.

---

## 3. Entregables previos a poder agendar la llamada

Cloudbeds exige tres cosas **antes** de dar fecha para la llamada de certificación.

### 3.1. Artículo de soporte público — ❌ no existe

Es el entregable más grande que falta y no lo cubren las políticas de privacidad ni los términos que
ya subiste. Requisitos textuales de Cloudbeds:

- Alojado **públicamente** en nuestro sitio o en un centro de ayuda / base de conocimiento.
- **En inglés** (salvo que la app soporte exclusivamente otros idiomas).
- Seis secciones obligatorias:
  1. Cómo darse de alta en nuestra app.
  2. Cómo es el proceso de conexión inicial con Cloudbeds.
  3. Qué hace la integración (funcionalidad específica).
  4. Cómo desconectar la app.
  5. **Cómo implementamos nosotros la desconexión** (qué pasa de nuestro lado).
  6. Contacto de soporte.
- Debe **enlazar** el artículo propio de Cloudbeds *"Disconnect an app from myfrontdesk"*.
- Debe incluir **capturas de pantalla**.
- Opcionales recomendados: limitaciones, FAQ, video de 2-3 minutos.

**Estado de nuestro sitio:** revisé xcale.app y hoy sólo hay `/es/privacy` y `/es/terms`. No existe
centro de ayuda, ni sección de documentación, ni ninguna página de hotelería o de Cloudbeds, y todo
el sitio está únicamente en español. Es decir: hay que **crear el artículo y crear el lugar donde
vivirá** (basta con un Freshdesk / Notion público / una ruta `/help` del sitio).

Nota: la sección 5 no se puede escribir todavía con verdad, porque la desconexión **es justamente lo
que no está implementado** (punto 4.3). El artículo depende de ese slice.

### 3.2. Material de marketing por Google Form — ⚠️ entregable separado

Ojo con esto porque es fácil pensar que ya está hecho al haber llenado el perfil de la app. Son dos
cosas distintas: el **App Details page** (dentro del portal de Cloudbeds) y el **material de
marketing** (que va por un formulario de Google aparte). Lo que pide el formulario:

- Resumen de la app, bullets de beneficios (orientados al usuario, no a la tecnología) y descripción.
- Icono de la app, imágenes del directorio, imagen destacada y capturas de alta calidad.
- Enlace a nuestra página de marketing.
- **Una landing page alojada por nosotros, con formulario de captación de leads, dedicada a la
  integración con Cloudbeds.**
- **Un video walkthrough** alojado en YouTube, Vimeo o Wistia mostrando la integración funcionando.
- Precios (opcional).

La landing page y el video son trabajo real que no está hecho.

### 3.3. Permisos: "sólo los scopes necesarios" — ⚠️ ajuste pendiente

Cloudbeds verifica explícitamente que en el App Details *"only required permission scopes are
selected"*. Situación actual:

- La app registrada (la de prueba) está autorizada para **32 scopes**.
- El código pide realmente **22** (17 de lectura + 5 de escritura).
- **Los 22 que declaraste en tu correo cuadran exactamente con lo que llama el código.** Lo verifiqué
  tool por tool: nada de lo que pedimos deja de usarse, y nada de lo que usamos deja de pedirse
  (la lista de scopes se deriva automáticamente de las herramientas, no se mantiene a mano).

**Acción:** bajar la selección de 32 a 22 en el App Details, y actualizar el espejo de esa lista en
el código (`xcale-mcp-server/src/providers/cloudbeds/auth.ts`). Son 10 minutos, pero si llegamos a la
llamada con 32 seleccionados es una observación segura del revisor.

---

## 4. La llamada de certificación: los 3 puntos obligatorios

La llamada dura ~60 minutos, **se graba**, y verifica tres cosas. Este es el análisis punto por punto
contra nuestro código.

### 4.1. Autenticación — ✅ cumple

Piden que el redirect URI sea HTTPS y que el proceso de conexión sea **completamente automatizado**
(sin pegar credenciales a mano). Nuestro flujo es OAuth 2.0 authorization-code con refresh, y el
redirect de producción que les diste —`https://api.xcale.app/api/v1/connections/cloudbeds/callback`—
**coincide exactamente con la ruta real del backend**. No hay nada que arreglar aquí.

Un detalle a favor: el ID de propiedad se descubre solo (llamando a `getHotels`), no se le pide al
usuario que lo pegue. Eso es justo lo que entienden por "fully automated".

### 4.2. Flujo de autorización y llamadas a la API — ✅ cumple lo obligatorio

Nuestra categoría declarada mapea al blueprint de *Guest Communication / Reputation Management*. Lo
único **obligatorio** de ese blueprint es:

> *"Use getReservations with the parameters indicated above depending on if pre / during or post
> communication (at least one of them)."*

Lo cumplimos: nuestra herramienta de listar reservas soporta `status`, `checkInFrom` y `checkInTo`,
que cubren los escenarios de pre-llegada y de huésped en casa. Los webhooks, en este blueprint, son
explícitamente opcionales (*"you may also subscribe"*), y nosotros ya estamos suscritos a
`reservation/status_changed`.

**Detalle menor:** no soportamos los filtros `checkedOutFrom` / `checkedOutTo`, así que no podríamos
demostrar el escenario de post-salida. Como basta con uno de los tres, no bloquea; añadir esos dos
parámetros es trabajo de minutos si queremos enseñar los tres.

**Advertencia importante:** en la llamada hay que mostrar **todas** las llamadas a la API que usamos,
obligatorias y opcionales. Son 38 herramientas. La buena noticia es que tras la reconexión de julio
la propiedad de prueba ya concede los 22 scopes y la cobertura en vivo dio 12/12, así que no hay
nada que se quede sin poder demostrarse por permisos.

### 4.3. Conectar y desconectar apps — ❌ **este es el hueco**

Cloudbeds define un contrato explícito para esto y **no tenemos nada implementado**. Busqué en los
tres repos las tres piezas del contrato (`postAppState`, `getAppState`, `appstate_changed`): cero
coincidencias.

Lo que ellos verifican en la llamada, y lo que pasaría hoy:

| Lo que se prueba | Qué pasa hoy |
|---|---|
| El hotel desconecta la app **desde nuestra interfaz** → la app debe desaparecer de *Manage Apps* en Cloudbeds | ❌ Existe el mecanismo interno (el rail `onDisconnect`), pero sólo Shopify lo usa. Con Cloudbeds no enviamos `postAppState app_state=disabled`, así que la app sigue apareciendo como conectada en su lado. |
| El hotel desconecta la app **desde el Marketplace de Cloudbeds** → nosotros debemos **terminar todas las sesiones de inmediato** | ❌ No estamos suscritos al webhook `appstate_changed` ni consultamos `getAppState`. Nos enteraríamos sólo al recibir un 401 en la siguiente llamada, y nuestra política actual marca la conexión como "expirada" (recuperable), nunca la termina. |
| El botón cambia de estado correctamente (*Connect App* ↔ *Login*) | ❌ Depende de lo anterior. |

Efecto colateral ya conocido: al desconectar tampoco damos de baja la suscripción de webhook, que
queda huérfana apuntando a un receptor que ya no debería recibir nada.

**Esto es lo único que hoy haría fallar la certificación.** Y es un trabajo acotado, no un proyecto:

1. Añadir las llamadas `postAppState` / `getAppState` al provider de Cloudbeds en el MCP.
2. Implementar el hook de desconexión de Cloudbeds (el rail ya existe, hay que llenarlo): enviar
   `app_state=disabled` y borrar las suscripciones de webhook de esa propiedad.
3. Suscribirnos a `appstate_changed` junto al webhook de reservas que ya tenemos, y al recibirlo
   terminar la conexión de verdad (no marcarla como expirada) — filtrando por nuestro propio client
   ID, como exige su documentación.

**Estimación: un slice de trabajo, con pruebas.** Es lo primero que haría, porque es lo único de toda
esta lista que no se resuelve escribiendo un documento.

### 4.4. Prueba en dos "islas" — ❌ falta la segunda cuenta

La llamada se ejecuta contra **una propiedad de prueba en Island 1 y una segunda en Island 2**.
Nosotros sólo tenemos una cuenta de prueba. Hay que **pedirle a Cloudbeds la segunda**, y confirmar
si Island 2 responde en el mismo host de API que usamos hoy — nuestro cliente tiene el host de la API
v1.3 fijo (con posibilidad de sobreescribirlo), así que si son hosts distintos hay que hacerlo
configurable por conexión. Es una pregunta directa para Gabriela, no una suposición que debamos
resolver por nuestra cuenta.

---

## 5. Sobre Hotel Bio Hábitat

Estoy de acuerdo en que es el piloto natural, pero el orden que marca la guía es este y conviene no
saltárselo:

1. Acuerdo de conectividad firmado.
2. Entregables (artículo de soporte + marketing + scopes ajustados).
3. **Llamada de certificación** (contra la cuenta de prueba).
4. Emisión de **credenciales de producción** con nuestro redirect URI de producción.
5. **Limited Release**: la app **no** es visible en el Marketplace; se comparte un enlace oculto con
   las propiedades piloto. Requieren **5 propiedades** y dura típicamente 2-4 semanas.
6. Go Live y visibilidad pública.

Es decir: **Bio Hábitat encaja perfecto como piloto #1 de los 5**, pero conectarlo con credenciales
reales antes de certificar es justo lo que hay que preguntarle a Gabriela — la guía plantea que el
desarrollo ocurre contra la cuenta de prueba del partner.

Dos cosas que conviene tener presentes para manejar expectativas:

- Cloudbeds pide explícitamente **no promocionar la integración hasta terminar el Limited Release**.
  La visibilidad en su portal de aliados —que es lo que más nos interesa del partnership— llega al
  final del proceso, no al principio.
- Requieren **5 propiedades** para el Limited Release. Con una sola no se avanza a Go Live. Si
  arrancamos con menos, hay que negociarlo con ellos explícitamente (es tu pregunta 3 y no está
  documentada ninguna excepción).

---

## 6. Respuestas a tus cinco preguntas, según la documentación

1. **¿Qué necesitan para agendar la llamada?** El acuerdo firmado, más los tres entregables de la
   sección 3 (artículo de soporte, material de marketing por formulario, y perfil con sólo los
   scopes necesarios). Los tiempos de respuesta que publican son de 1-2 días hábiles para soporte de
   desarrollo, pero no publican el tiempo de espera para agendar: hay que preguntarlo.
2. **Redirect URI de producción.** Sí, se registra al emitir las credenciales de producción. Además,
   en re-certificaciones dan hasta 2 juegos adicionales de credenciales (test / dev / staging) y para
   cada uno hay que aportar su redirect URI. Vale la pena pedir el juego de staging desde ya.
3. **Limited Release con menos propiedades.** Su texto es tajante: *"We require 5 properties to join
   the Limited Release phase before proceeding with going live"*. No hay excepción documentada.
4. **Cloudbeds Payments / pay-by-link.** Cada propiedad piloto necesita tener Cloudbeds Payments como
   pasarela **y** pay-by-link activado; se verifica llamando a `getPaymentsCapabilities`, que debe
   devolver `cloudbedsPayments: true` y `payByLink: true` (nuestra integración ya hace esa
   comprobación). Además hay que poner nuestro dominio en la whitelist del Booking Engine de la
   propiedad, y eso se coordina con ellos. **Restricción importante:** pay-by-link *"is not intended
   to allow adding cards on file, only charges or authorizes on a brand new card each time"*, y los
   reembolsos se hacen manualmente dentro de Cloudbeds, no por API.
5. **Formato del artículo de soporte.** Sí hay formato: las seis secciones de la 3.1, en inglés,
   público, con capturas y con el enlace a su artículo de desconexión. Publican un ejemplo de
   referencia (la integración de Sponteous) que sirve de plantilla.

---

## 7. Orden de trabajo propuesto

1. **Preguntarle a Gabriela por el Connectivity Agreement** (bloquea todo lo demás) y de paso pedirle
   la segunda cuenta de prueba (Island 2). — *hoy*
2. **Implementar el slice de conexión/desconexión.** Es lo único que puede tumbar la certificación y
   es prerequisito para poder escribir con verdad la sección 5 del artículo de soporte. — *yo*
3. **Bajar los scopes de 32 a 22** en el App Details. — *tú, 10 minutos*
4. **Escribir y publicar el artículo de soporte en inglés**, en una ruta pública del sitio o en un
   centro de ayuda. — *puedo escribir el borrador completo*
5. **Landing page de la integración + video walkthrough**, y enviar el Google Form de marketing.
6. **Agendar la llamada** y preparar el guion de demo: hay que poder mostrar las 38 llamadas.
7. **Limited Release** con Bio Hábitat como piloto #1, más 4 propiedades por conseguir.

---

## 8. Preguntas listas para enviarle a Gabriela (en inglés)

> 1. The partnership form has been submitted. What's the next step to get the Connectivity Agreement
>    in place, and what's the typical turnaround?
> 2. Certification requires a test property in Island 1 and one in Island 2 — we currently only have
>    one partner test account. Could you provision the second one, and confirm whether Island 2 uses
>    a different API host than `hotels.cloudbeds.com`?
> 3. Can a real property (our pilot hotel) connect to our current app before certification, or must
>    all pre-certification work happen against the partner test account?
> 4. We're a small team launching with fewer than 5 pilot properties. How do partners in that
>    position handle the Limited Release requirement?
> 5. For Cloudbeds Payments pay-by-link on our pilot properties: what do you need from us for the
>    Booking Engine domain whitelisting, and who enables pay-by-link on the property side?
> 6. Could you share the support article template or a couple of reference articles from apps in the
>    Guest Experience & Communication category?

---

## Anexo — Estado del frente ePayco (no relacionado con Cloudbeds)

Aprovechando, revisé el estado de la línea de pagos después de tus cambios del 1 de agosto:

- Tu Stage 2 (#387: perfil de titular obligatorio, límite de alta de tarjeta por usuario, errores 4xx
  localizados) y nuestra mitad (#384: el perfil llega al registro de cliente de ePayco, rechazo de
  cobros desatendidos sin perfil, y el correo de cobranza corregido) **ya están reconciliados**.
- El PR #384 está limpio y mergeable contra `dev`. Corrí la batería de pagos e infraestructura HTTP:
  **178 pruebas, todas en verde**.
- Tres solapamientos resueltos: el registro de despliegue quedó en unión cronológica, se eliminó una
  clave de traducción duplicada que estaba tapando la tuya, y se reescribió una prueba que cubría un
  camino que tu Stage 2 volvió inalcanzable.
- Dos observaciones para tu radar:
  - La validación de teléfono acepta **sólo móvil colombiano** (`3` + 9 dígitos). Un titular con fijo
    o con tarjeta de otro país no puede registrar tarjeta. Es coherente con ePayco, pero es una
    decisión de producto que quedó dentro de una validación técnica.
  - Sigue activa la sonda que imprime la cadena de reenvío en el alta de tarjeta (para saber cuántos
    saltos de proxy hay y si la IP que le mandamos a ePayco es la real del cliente). Cuando entre la
    próxima alta de tarjeta real hay que leer ese log y decidir si se retira.
