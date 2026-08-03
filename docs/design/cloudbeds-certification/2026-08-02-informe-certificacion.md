# Certificación de producción con Cloudbeds — informe de estado

**Fecha:** 2 de agosto de 2026 · **Versión 2** (reemplaza la versión de esta mañana: aquella
listaba lo que faltaba; esta dice además qué de eso ya está hecho)
**Para:** Mateo Escobar
**De:** Juan José

---

## 1. Resumen ejecutivo

Revisé la guía completa de certificación de Cloudbeds y la contrasté contra nuestro código. De todo
lo que faltaba, **ya está hecho todo lo que se podía hacer desde el código y desde el escritorio**:
el hueco técnico que nos habría hecho fallar la llamada está cerrado y probado, y los documentos que
Cloudbeds exige están escritos. Lo que queda es tuyo o de ellos: firmas, accesos, capturas de
pantalla y publicar.

| Bloque | Estado | Dueño |
|---|---|---|
| Acuerdo de partnership (Connectivity Agreement) | ⚠️ Pendiente — es el bloqueante real | Cloudbeds / tú |
| Perfil de la app, fotos, políticas | ✅ Hecho | Tú |
| **Manejo de conexión/desconexión (punto obligatorio de la llamada)** | ✅ **Implementado y probado** | Hecho |
| Autenticación OAuth | ✅ Cumple, sin cambios | Hecho |
| Llamadas a la API de nuestra categoría | ✅ Cumple; se añadió el filtro que faltaba | Hecho |
| **Artículo de soporte** | ✅ **Escrito** — falta publicarlo y 6 capturas | Tú |
| **Material de marketing (Google Form)** | ✅ **Copy y landing escritos** — falta publicar, capturas y video | Tú |
| Ajuste de permisos: 32 registrados → 22 usados | ⚠️ Pendiente, 10 minutos | Tú |
| Segunda cuenta de prueba (Island 2) | ⚠️ Hay que pedirla | Cloudbeds |
| 5 propiedades para el Limited Release | ⚠️ Pendiente | Tú |

---

## 2. Lo que Gabriela está esperando (no son documentos nuestros)

Su frase es literal:

> *"In order to move with certification, it's necessary to have a Partnership agreement in place."*

Eso **no** es el formulario de la web. El formulario es la solicitud; lo que habilita la
certificación es el **Connectivity Agreement**, un acuerdo estandarizado que Cloudbeds emite después
de revisar esa solicitud. Es la Etapa 1 de su proceso y ninguna de las siguientes se agenda sin ella.

**Pregunta concreta para ella:** *"el formulario ya está enviado — ¿cuál es el siguiente paso para
tener el Connectivity Agreement firmado y cuánto suele tardar?"*. Al final de este informe están esa
y las otras cinco preguntas, ya redactadas en inglés para reenviar tal cual.

---

## 3. Lo que ya hicimos (código, terminado y probado)

### 3.1. El hueco que nos habría hecho fallar la llamada — cerrado

De los tres puntos obligatorios de la llamada de certificación pasábamos dos. El tercero —
**conectar y desconectar apps** — no estaba implementado en ninguna de sus dos direcciones. Ahora sí:

- **Cuando un hotel se desconecta desde nuestra plataforma**, ahora se lo decimos a Cloudbeds: le
  quitamos las suscripciones a los eventos de la propiedad y le decimos que la app queda
  deshabilitada, así que xcale desaparece del *Manage Apps* del hotel. Antes el hotel apretaba
  desconectar, nuestro sistema decía "desconectado", y Cloudbeds seguía mostrando una integración
  viva para siempre.
- **Cuando el hotel nos desconecta desde el Marketplace de Cloudbeds**, ahora nos enteramos y
  cortamos todo acceso de inmediato, como ellos exigen. Antes solo lo notábamos como un error de
  credenciales que nuestro sistema interpretaba como "el token está viejo, ya se arreglará", y
  seguía reintentando contra una conexión que ya no existía.

Un detalle de seguridad que vale la pena que sepas: Cloudbeds **no firma sus avisos**, así que
cualquiera que conociera nuestra URL podría enviar un aviso falso de "este hotel te desconectó".
Nuestro sistema no le cree al aviso: lo usa solo como señal para ir a preguntarle a Cloudbeds
directamente, y solo desconecta cuando Cloudbeds lo confirma.

### 3.2. Un error silencioso en producción, encontrado por el camino

Al implementarlo apareció que **las suscripciones a eventos de Cloudbeds llevaban rotas semanas**:
un cambio de seguridad de julio retiró unas herramientas que nuestro backend seguía llamando, y la
llamada fallaba en silencio. Las propiedades ya suscritas seguían funcionando (por eso no se notó),
pero **ninguna conexión nueva quedaba suscrita**. Queda arreglado en el mismo cambio.

### 3.3. El escenario de la demo que no podíamos enseñar

Nuestra categoría exige demostrar la lectura de reservas en al menos uno de los tres momentos de una
estadía. Teníamos dos —los que llegan y los que están en casa— y no el tercero, los que ya salieron.
Se añadió el filtro; ahora podemos enseñar los tres en la llamada.

**Todo lo anterior está probado:** 2.927 pruebas automáticas en el backend y 157 en el servidor de
integraciones, todas en verde.

---

## 4. Los documentos que ya escribimos — dónde están y qué les falta

Los cuatro archivos están en el repositorio `xcale-mcp-server`, en la carpeta
**`docs/design/cloudbeds-certification/`**. Estarán visibles en GitHub en cuanto se suba el PR de
documentación; mientras tanto Juan José te los puede pasar adjuntos.

| Archivo | Qué es | Qué le falta |
|---|---|---|
| `2026-08-02-informe-certificacion.md` | Este informe | — |
| `support-article-en.md` | **El artículo de soporte** que Cloudbeds exige antes de agendar la llamada | Publicarlo · 6 capturas · confirmar el correo de soporte |
| `marketing-landing-copy.md` | Copy del App Details (resumen, bullets, descripción) + copy de la landing en inglés y español + checklist del Google Form | Decidir precios (opcional) |
| `landing-cloudbeds.html` | **La landing de la integración con formulario de captación**, lista para publicar | Publicarla · conectar el formulario · una captura real |

### 4.1. El artículo de soporte

Cubre las seis secciones obligatorias, en inglés, incluida la que Cloudbeds pide explícitamente:
*cómo implementamos nosotros la desconexión*. Esa sección **describe el comportamiento real** del
código que acabamos de escribir, no una intención — que es justamente por qué convenía escribirla
después y no antes.

Le faltan tres cosas, todas humanas:

1. **Dónde vive.** El sitio xcale.app no está en nuestros repositorios (nuestro código es la
   aplicación, no la web de marketing), así que publicarlo no es algo que podamos hacer nosotros.
   Sirve cualquiera de estas: una ruta pública en xcale.app (sugerido:
   `xcale.app/help/cloudbeds`), o un centro de ayuda tipo Freshdesk/Notion público. Cloudbeds solo
   exige que sea **público y en inglés**.
2. **Seis capturas de pantalla.** El archivo marca exactamente dónde va cada una y qué debe mostrar.
3. **El correo de soporte.** El borrador usa `support@xcale.app` marcado como pendiente de
   confirmar. Ojo con este: es la dirección que Cloudbeds usará, y su compromiso de servicio en vivo
   es **responder el mismo día hábil** los problemas urgentes y en 24 horas las dudas de
   onboarding. Si esa dirección no existe o nadie la lee, es mejor cambiarla ahora que después.

### 4.2. El material de marketing

Es un envío **distinto** del perfil de la app: va por un formulario de Google aparte, y además del
copy pide una **landing propia con formulario de captación** y un **video walkthrough**. La landing
está escrita y lista (autocontenida, se puede subir tal cual); solo hay que publicarla y apuntar el
formulario a donde recojamos los datos.

Falta lo que no se puede producir desde un teclado:

- **El video** (2–3 minutos). El archivo trae el guion en cinco tomas: conectar Cloudbeds → enlazar
  WhatsApp → una conversación real que termina en reserva → la reserva apareciendo en Cloudbeds →
  desconectar. Esa última toma vale más de lo que parece: la certificación pide demostrar la
  desconexión, y tenerla en video significa que el revisor ya la vio funcionar antes de la llamada.
- **Las capturas**, que son las mismas seis del artículo de soporte.

---

## 5. Lo que queda pendiente y es tuyo o de Cloudbeds

1. **El Connectivity Agreement.** Bloquea todo lo demás. (Cloudbeds / tú)
2. **Ajustar los permisos en App Details.** Cambió respecto a la versión anterior de este informe:
   ya no es "bajar de 32 a 22". Ver §5-bis. (Tú, con la lista ya resuelta)
3. **Publicar el artículo de soporte y la landing**, con sus capturas. (Tú)
4. **Grabar el video** y enviar el formulario de marketing. (Tú)
5. **Pedir la segunda cuenta de prueba (Island 2)** y confirmar si responde en el mismo servidor que
   usamos hoy — la llamada se ejecuta contra una propiedad en cada "isla" y solo tenemos una. (Cloudbeds)
6. **Las 5 propiedades del Limited Release.** Su texto es tajante y no hay excepción documentada;
   Bio Hábitat es la número 1 de 5. (Tú)

---

## 5-bis. Los permisos: qué pasó cuando fuimos a mirar de verdad

En la versión anterior recomendé bajar de 32 a 22 marcados. Juan José objetó con razón: **esos 32
los marcaste tú a propósito**, porque son los que el sistema debe llegar a manejar. Desmarcarlos no
es higiene, es renunciar a alcance. Así que en vez de decidirlo por criterio, lo probamos contra la
propiedad real. Los 10 sin cubrir resultaron ser **cuatro problemas distintos**, no uno.

| Grupo | Scopes | Qué encontramos | Qué hacer |
|---|---|---|---|
| **Sin endpoint** | `read:adjustment`, `read:resourceTypes`, `read:resourceReservations` | Probamos **siete** nombres de método plausibles: los siete respondieron *"no such method"*. En la misma pasada, los 12 scopes con endpoint publicado respondieron OK — o sea que el instrumento estaba sano y el 404 es real | **Desmarcar.** No se puede construir una tool para algo que no se puede llamar, y en la llamada hay que demostrar cada llamada que usamos |
| **Ya cubierto** | `read:addon` | Parecía del grupo anterior y resultó lo contrario: respondió **403 "no tienes el scope correcto"**. Un 403 dice *el endpoint está ahí y te falta permiso* | **Dejar marcado — ya está cubierto.** Construí `list_addons` (extras: desayuno, traslados, late checkout). Es nuestra primera tool contra la API v2.0 de Cloudbeds |
| **Otro producto** | los 4 `read:dataInsights*` | No es una API de recursos: es un constructor de informes con ~130 endpoints, otra autenticación, y su spec **no declara scopes por endpoint**. Cubrirlo significa algo cualitativamente distinto (ejecutar reportes) | **Desmarcar por ahora.** Merece su propio proyecto después de certificar. Volver a añadir scopes de **lectura** después es barato — Cloudbeds dice que ampliar solo-lectura puede no exigir re-certificación |
| **Decisión tuya** | `write:communication`, `write:adjustment` | Ambos tienen endpoint y son construibles. Los excluimos en su momento por riesgo, no por imposibilidad | **Tú decides — y decide ahora.** Ver abajo |

### Los dos de escritura: por qué hay que decidirlos antes de la llamada

Cloudbeds dispara **re-certificación** cuando se añaden funciones que requieren **nuevos scopes de
escritura**. Los de lectura son baratos de añadir después; los de escritura cuestan otra llamada. Así
que estos dos no son "después vemos":

- **`write:communication`** (crear y programar las plantillas de correo del hotel). Encaja con nuestra
  categoría —*Guest Communication*— y son 2 endpoints: se construye rápido. Lo dejamos fuera porque
  un agente redactando el correo del hotel es riesgo sin caso de uso claro. **Si lo quieres, se
  construye esta semana y entra a la certificación.**
- **`write:adjustment`** (registrar ajustes financieros). Aquí sí te recomiendo no hacerlo, y no por
  esfuerzo: **es ciego e irreversible**. `read:adjustment` no tiene endpoint —acabamos de probarlo—
  así que no podríamos ni leer lo que escribimos, y no hay scope de borrado registrado. Un ajuste mal
  puesto no se ve y no se deshace. Si algún día se hace, debería ser con confirmación humana
  explícita y con un lector que exista.

### Cómo queda el registro

**23 marcados** = los 22 que ya usábamos + `read:addon`. **Desmarcar 9** (los 3 sin endpoint, los 4
de Data Insights, y los 2 de escritura si decides no construirlos).

**Un detalle que importa para la agenda:** pedir `read:addon` cambia la pantalla de consentimiento,
así que las propiedades ya conectadas necesitan **reconectar** para que la tool funcione. La app se
comporta bien —dice "reconexión necesaria" en vez de fingir que no hay extras— pero significa que
`list_addons` solo se puede demostrar en la llamada **si hay una reconexión antes**. Es la misma
reconexión que ya hacía falta para la toma del video y para verificar el aviso de app-state: **una
sola sesión resuelve las tres**.

---

## 6. La única decisión técnica que falta, y tiene un costo

Nuestro sistema se entera de que un hotel nos desconectó desde Cloudbeds por un aviso que ellos
documentan pero que **nunca hemos visto llegar**. Cloudbeds acepta suscripciones a eventos que no
existen y responde que todo salió bien, así que la documentación no basta: hay que verlo entregar
una vez.

El instrumento ya está listo y probaría las tres variantes posibles de una sola pasada. **Pero
hacerlo entregar exige deshabilitar y volver a habilitar la app en la cuenta de prueba, y eso es una
reconexión** — que ya sabemos que tiene costo humano y suele dejar suscripciones huérfanas.

Son dos caminos legítimos y hay que elegir antes, no a mitad:

- **Verificarlo ahora:** una sola pasada, con las tres variantes suscritas y la limpieza lista
  inmediatamente después. Cuesta una reconexión.
- **No verificarlo:** la llamada de certificación es la primera prueba — el revisor desconecta la
  app él mismo como parte del guion. Si acertamos, no pasó nada. Si no, el error se descubre delante
  de él y cuesta una re-certificación, no una tarde.

Mi recomendación: verificarlo, aprovechando la próxima vez que se toque esa cuenta por cualquier otro
motivo.

---

## 7. Sobre Hotel Bio Hábitat

El orden que marca la guía es: acuerdo firmado → entregables → llamada de certificación (contra la
cuenta de prueba) → credenciales de producción → **Limited Release** (app oculta, enlace privado, 5
propiedades, 2–4 semanas) → visible en el Marketplace.

Bio Hábitat encaja perfecto como **piloto #1 de los 5**, pero conectarlo con credenciales reales
antes de certificar es justo lo que hay que preguntarle a Gabriela: la guía plantea que el desarrollo
ocurre contra la cuenta de prueba del partner. Y dos cosas para manejar expectativas: Cloudbeds pide
explícitamente **no promocionar la integración hasta terminar el Limited Release** (la visibilidad en
el portal de aliados llega al final), y **exigen 5 propiedades** para pasar a Go Live.

---

## 8. Respuestas a tus cinco preguntas, según la documentación

1. **¿Qué necesitan para agendar la llamada?** El acuerdo firmado, más el artículo de soporte
   publicado, el material de marketing enviado y los permisos ajustados. No publican el tiempo de
   espera para agendar: hay que preguntarlo.
2. **Redirect URI de producción.** Sí, se registra al emitir las credenciales de producción. El que
   diste (`https://api.xcale.app/api/v1/connections/cloudbeds/callback`) **coincide exactamente con
   la ruta real** del backend — lo verifiqué. En re-certificaciones dan hasta 2 juegos adicionales de
   credenciales; vale la pena pedir el de staging desde ya.
3. **Limited Release con menos propiedades.** *"We require 5 properties…"*. Sin excepción documentada.
4. **Cloudbeds Payments / pay-by-link.** Cada propiedad piloto necesita Cloudbeds Payments **y**
   pay-by-link activo; se verifica con `getPaymentsCapabilities`, que nuestra integración ya
   consulta. Además hay que poner nuestro dominio en la whitelist del Booking Engine de la propiedad.
   **Restricción importante:** pay-by-link *"is not intended to allow adding cards on file, only
   charges…"* y los reembolsos se hacen dentro de Cloudbeds, no por API.
5. **Formato del artículo de soporte.** Sí hay formato, y ya está aplicado en el borrador: seis
   secciones, en inglés, público, con capturas y enlazando su artículo de desconexión.

---

## 9. Preguntas listas para enviarle a Gabriela (en inglés)

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

- Tu Stage 2 (#387) y nuestra mitad (#384) **ya están reconciliados**. El PR #384 está limpio y
  mergeable contra `dev`; la batería de pagos e infraestructura HTTP pasa completa (178 pruebas).
- Tres solapamientos resueltos: el registro de despliegue quedó en unión cronológica, se eliminó una
  clave de traducción duplicada que tapaba la tuya, y se reescribió una prueba que cubría un camino
  que tu Stage 2 volvió inalcanzable.
- Dos observaciones para tu radar:
  - La validación de teléfono acepta **solo móvil colombiano**. Un titular con fijo o con tarjeta de
    otro país no puede registrar tarjeta. Es coherente con ePayco, pero es una decisión de producto
    que quedó dentro de una validación técnica.
  - Sigue activa la sonda que imprime la cadena de reenvío en el alta de tarjeta. Cuando entre la
    próxima alta real hay que leer ese log y decidir si se retira.
