# Guía de capturas y video — Cloudbeds

Qué grabar, en qué orden, qué debe verse y qué NO puede verse. Sirve para las dos entregas a la vez:
las capturas del **artículo de soporte** y las del **formulario de marketing** son las mismas.

---

## 0. Lo primero: las especificaciones exactas no están publicadas

Revisé la página de *Partner Marketing Requirements* de Cloudbeds palabra por palabra. Sobre las
imágenes solo dice **"asegúrate de que el icono siga nuestros requisitos"**, *"high-quality images"*
y *"images should be of high quality and demonstrate app usability"*. **No publica dimensiones,
formatos, pesos máximos, cantidad de capturas ni duración del video.** Para el video solo fija el
alojamiento: **YouTube, Vimeo o Wistia**.

Su propia página remite a `integrations@cloudbeds.com` para el detalle. **Hay que pedírselo a
Gabriela** — está añadido como pregunta 7 al final de este documento, lista para reenviar.

Mientras tanto, estos valores son seguros y nunca los van a rechazar por técnicos:

| Recurso | Recomendación mientras Cloudbeds confirma |
|---|---|
| Capturas | **PNG**, 2560×1600 (16:10), tomadas en pantalla a 2× para que se vean nítidas |
| Icono de la app | **PNG cuadrado 512×512**, fondo transparente, con margen interno |
| Imagen destacada | 1920×1080, con el producto visible, sin texto pequeño |
| Video | **2–3 minutos**, 1080p, MP4, subido a **YouTube como "no listado"** |
| Idioma | **Inglés** en todo lo que Cloudbeds vaya a mostrar |

---

## 1. Antes de empezar a capturar — reglas que no son opcionales

1. **Ningún dato real de huésped.** Las capturas son material público. Nada de nombres, teléfonos,
   correos ni números de reserva de personas reales. Usar la propiedad de prueba, o un huésped de
   demostración con nombre inventado y un teléfono claramente ficticio.
2. **Nada de credenciales en pantalla.** Ni tokens, ni URLs de webhook, ni la barra de direcciones
   con parámetros de una sesión, ni pestañas abiertas con otras cuentas.
3. **Ventana limpia.** Ocultar la barra de marcadores, cerrar las notificaciones del sistema, zoom al
   100%, modo claro (contrasta mejor en su directorio), y una ventana de 1280×800 lógicos.
4. **Coherencia.** Las seis capturas deben salir de la misma sesión y del mismo hotel de ejemplo. Que
   el nombre de la propiedad cambie entre una captura y otra se nota, y resta.
5. **Interfaz en inglés.** El artículo va en inglés; una captura en español con un texto en inglés
   alrededor se lee como descuidado.

---

## 2. Las seis capturas

Cada una dice dónde se usa y qué tiene que verse. El nombre de archivo sugerido es el que usan las
referencias del artículo.

### 1 · `01-tools-integrations.png` — el catálogo
- **Dónde:** artículo de soporte (§3) y directorio de apps.
- **Pantalla:** *Tools & Integrations* en el panel de xcale.
- **Debe verse:** la tarjeta de **Cloudbeds** claramente, con su botón **Connect**, dentro de la
  sección *Available to Connect*. Que se vea que hay más integraciones alrededor está bien: comunica
  plataforma.
- **No debe verse:** el nombre de otro cliente real en la barra superior.

### 2 · `02-cloudbeds-authorization.png` — la pantalla de permisos
- **Dónde:** artículo de soporte (§3). Es la más importante para certificación: demuestra que el
  flujo es OAuth real y automatizado.
- **Pantalla:** la pantalla de autorización **de Cloudbeds**, con el nombre de xcale y la lista de
  permisos solicitados.
- **Cómo llegar sin arriesgar nada:** iniciar el flujo *Connect* y capturar **antes** de pulsar
  *Allow*. No hace falta completar la conexión ni desconectar nada.
- **Ojo:** esta captura muestra los permisos que pedimos. **Tomarla después de bajar el registro de
  32 a 22**, o la imagen contradice lo que le declaramos a Cloudbeds.

### 3 · `03-cloudbeds-connected.png` — conectado
- **Dónde:** artículo de soporte (§3).
- **Debe verse:** la tarjeta de Cloudbeds en la sección **Connected**, con el nombre de la propiedad.
- **Detalle que suma:** si se ve el número de herramientas disponibles, mejor — sugiere alcance.

### 4 · `04-agent-integration-linked.png` — el asistente enlazado
- **Dónde:** artículo de soporte (§3, "Link the integration to your assistant").
- **Debe verse:** la configuración del agente con la cuenta de Cloudbeds seleccionada bajo
  *Integrations*.
- **Por qué importa:** es el paso que más soporte genera. Un asistente sin cuenta enlazada no ve
  nada del hotel, y el artículo lo advierte.

### 5 · `05-whatsapp-booking.png` — la conversación que reserva
- **Dónde:** artículo de soporte (§4), landing y directorio. Es **la** imagen del producto.
- **Debe verse:** un hilo de WhatsApp donde el huésped pregunta por disponibilidad, el asistente
  cotiza con precio real y confirma la reserva. Que se vea el número de confirmación es ideal.
- **Cuidado:** teléfono y nombre del huésped ficticios o difuminados. La conversación en inglés si
  la captura va al material de Cloudbeds.

### 6 · `06-whatsapp-payment-link.png` — el pago en el chat
- **Dónde:** artículo de soporte (§4) y landing.
- **Debe verse:** el mensaje con el link de pago de Cloudbeds Payments.
- **Si no hay pay-by-link disponible todavía en la cuenta de prueba:** no inventar la captura. Es
  preferible entregar cinco capturas verdaderas que seis con una montada — la certificación es una
  llamada en vivo y ahí no hay montaje posible.

---

## 3. El video walkthrough

**2:30 objetivo.** Cinco tomas. Sin música; voz o subtítulos, en inglés. Grabar en 1080p, con el
mismo hotel de ejemplo que las capturas.

| # | Toma | Duración | Qué se ve | Narración (inglés) |
|---|---|---|---|---|
| 1 | Conectar Cloudbeds | 0:30 | Tools & Integrations → Connect → pantalla de permisos de Cloudbeds → Allow → conectado | "Connecting your property takes one authorization. xcale asks Cloudbeds only for the permissions it uses, finds your property automatically, and you're done — nothing to copy or configure." |
| 2 | Enlazar WhatsApp | 0:20 | La configuración del agente con el número y la cuenta de Cloudbeds enlazada | "Link the WhatsApp number your guests already write to, and point the assistant at the property it should serve." |
| 3 | La conversación | 1:00 | WhatsApp real: pregunta → disponibilidad → cotización → reserva confirmada → link de pago | "A guest asks about availability. The assistant reads your live rates from Cloudbeds, quotes a real price, creates the reservation, and sends a payment link — in the same conversation, in the guest's language." |
| 4 | La reserva en Cloudbeds | 0:20 | El mismo número de confirmación abierto **dentro de Cloudbeds** | "The reservation is in your PMS, where your front desk already works. Nothing to re-type." |
| 5 | Desconectar | 0:20 | Tools & Integrations → Disconnect → confirmar → y en Cloudbeds, la app ya no aparece en *Manage Apps* | "Disconnecting is one click. We stop every session, remove the event subscriptions we created, and tell Cloudbeds the app is disabled — so it disappears from your Manage Apps list." |

**La toma 5 no es relleno.** La certificación verifica exactamente ese comportamiento. Tenerlo en
video significa que el revisor lo vio funcionar antes de la llamada, y que si algo falla en vivo hay
evidencia de que el flujo es correcto.

**Requisito técnico:** si la toma 5 se graba de verdad, deshabilita la app en la cuenta de prueba y
hay que volver a conectarla — o sea, **una reconexión**. Si se va a hacer, conviene aprovechar el
mismo momento para verificar el aviso de app-state (ver el runbook en el backend). Dos pájaros, un
costo.

---

## 4. Checklist de entrega

| Recurso | Para | Estado |
|---|---|---|
| 6 capturas | Artículo de soporte + directorio | ☐ |
| Icono de la app | App Details | ✅ (subido — confirmar que cumple su spec cuando la manden) |
| Imagen destacada | App Details | ✅ (subida — íd.) |
| Video 2–3 min en YouTube/Vimeo/Wistia | Formulario de marketing | ☐ |
| Artículo de soporte publicado (URL pública, en inglés) | Requisito previo a agendar | ☐ |
| Landing con formulario | Formulario de marketing | ☐ |
| Permisos 32 → 22 | App Details | ☐ |

---

## 5. Pregunta 7 para Gabriela (añadir a las seis del informe)

> Could you share the exact asset specifications for the App Details page and the marketing
> submission — app icon dimensions and format, featured image and screenshot dimensions, accepted
> file formats and size limits, how many screenshots you expect, and the preferred length for the
> walkthrough video? The Partner Marketing Requirements page states the requirements exist but does
> not list the numbers.
