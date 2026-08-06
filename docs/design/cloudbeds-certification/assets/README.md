# Capturas y video para Cloudbeds — qué hay, qué falta y quién puede hacerlo

Estado al **5 de agosto de 2026**. Los requisitos y el encuadre de cada imagen están en
`../capture-guide.md`; esto es solo el inventario y el reparto.

Las cuatro imágenes de aquí se tomaron del panel real, con la integración conectada, manejando el
navegador. **Sirven como referencia y como prueba de que la interfaz está lista**, pero léase primero
la sección "Dos límites" antes de mandarlas a Cloudbeds.

---

## Lo que ya está

| Archivo | Qué muestra | Dónde se usa |
|---|---|---|
| `00-signup.jpg` | Pantalla de registro de xcale | Artículo de soporte §2 |
| `01-tools-integrations.jpg` | Catálogo filtrado, tarjeta de Cloudbeds *Conectada · Nativa* | Artículo §3 · directorio |
| `01b-catalogo-completo.jpg` | Catálogo general (contexto: xcale es plataforma, no una sola integración) | Landing · directorio |
| `03-cloudbeds-connected.jpg` | Cloudbeds conectado + la sección de correo automático al huésped | Artículo §3 y §4 |

## Lo que falta, y por qué

| # | Captura | Por qué no está | Quién puede |
|---|---|---|---|
| 2 | **Pantalla de permisos de Cloudbeds** | Solo aparece durante un *connect*, y la propiedad ya está conectada. Sale sola la próxima vez que se conecte una propiedad — y **ahora mostrará los 24 permisos correctos**, no los 32 viejos | Cualquiera, en la próxima conexión |
| 4 | **Agente con la cuenta de Cloudbeds enlazada** | No se llegó a tomar | Cualquiera con sesión en el panel |
| 5 | **Conversación de WhatsApp que termina en reserva** | **Bloqueada** — ver abajo | Requiere acceso a Meta |
| 6 | **Link de pago en el chat** | Misma causa que la 5 | Requiere acceso a Meta |

### El bloqueo de las dos de WhatsApp

El número conectado en `xcale_dev` es **el número de prueba del WABA de desarrollo** (los valores
concretos — número, `phoneNumberId`, WABA — están en la configuración del entorno; no se copian
aquí). Se verificó contra la API de Meta: el token vive, el id es correcto y es el único número de
ese WABA.

Pero las entregas que llegan al túnel de desarrollo vienen de **otro `phoneNumberId`, de otra app de
Meta**, cuyo webhook también apunta al mismo dominio de ngrok. Nuestro receptor las rechaza con 403,
que es el comportamiento correcto: un receptor no debe procesar tráfico de números que no le
pertenecen.

Para desbloquear hace falta **una de dos**, y las dos exigen acceso al panel de Meta:

1. Conectar ese otro número en este entorno (hace falta un token de acceso con permisos sobre su
   WABA), **o**
2. Escribirle al número que sí está conectado (el número de prueba del WABA de desarrollo) desde un
   WhatsApp cualquiera — esto **no** requiere Meta, solo tener el número a mano y que un agente lo
   tenga seleccionado.

La opción 2 es la barata. Nota: al revisar la vinculación, la consulta devolvió **0 agentes
asociados** a ese número, así que conviene confirmar en el panel que el agente de reservas lo tiene
seleccionado — si no, el mensaje entra y nadie lo atiende.

> **De paso, algo que conviene mirar por su cuenta:** ese túnel está recibiendo tráfico de dos apps de
> Meta distintas. Hoy es inofensivo porque lo rechazamos, pero significa que alguien tiene
> conversaciones de huéspedes apuntando a una máquina de desarrollo.

---

## Dos límites de estas capturas

1. **Están en español.** El artículo de soporte va en inglés y Cloudbeds lo exige así. Rehacerlas es
   cuestión de cambiar el idioma de la cuenta y repetir el recorrido — diez minutos.
2. **Son de un entorno local** (`localhost:3201`), no de producción. Para el material de marketing
   conviene tomarlas de producción, donde además hay datos más presentables.

---

## El video

**No está grabado, y no se puede terminar hoy.** Lo que existe es el guion completo —cinco tomas, con
la narración en inglés lista para leer— en `../capture-guide.md` §3.

Reparto realista:

| Toma | Qué se ve | Se puede grabar hoy |
|---|---|---|
| 1 | Conectar Cloudbeds | Sí (navegador) |
| 2 | Enlazar WhatsApp | Sí (navegador) |
| 3 | **La conversación que termina en reserva** | **No** — mismo bloqueo que las capturas 5 y 6 |
| 4 | La reserva dentro de Cloudbeds | Sí (navegador) |
| 5 | Desconectar y ver la app desaparecer de *Manage Apps* | Sí — **ya verificado funcionando en vivo** |

La toma 3 es el corazón del video, así que grabar las otras cuatro sin ella no adelanta gran cosa.

Y dos cosas que ninguna herramienta de aquí resuelve: **la voz** (Cloudbeds lo quiere en inglés; el
texto está escrito, hace falta pasarlo por un TTS o grabarlo) y **la subida** a YouTube, Vimeo o
Wistia, que son los tres alojamientos que aceptan.

---

## Resumen del reparto

- **Se puede hacer sin nadie más:** capturas 2 y 4, y las cuatro tomas de video que no son la 3.
- **Necesita el número o un WhatsApp a mano:** capturas 5 y 6, y la toma 3 — por la vía 2 de arriba,
  que no requiere Meta.
- **Necesita acceso a Meta:** solo si se elige la vía 1 (conectar el otro número).
- **Necesita una persona, sin alternativa:** la voz del video y la subida.
