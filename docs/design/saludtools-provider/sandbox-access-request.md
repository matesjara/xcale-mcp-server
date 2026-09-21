# Sandbox access request — SaludTools / CareCloud

Draft for Q1, track 2 (see `grill-notes.md` §6). **Not sent.** Review, adjust the sender's name and
company details, then send.

**Still needed, and now with a harder reason.** A production ApiKey arrived on 2026-09-21 and
**`saludtools.qa.carecloud.com.co` rejects it** (`412`, "La llave es invalida para generar el token"), so
QA needs a credential of its own. And the key we do hold is a live clinic's, carrying
`role_admin`/`role_superadmin` — there is no read-only scope on offer — which is not something to keep
running an integration's test suite against. Mention both facts if it helps: they are a concrete,
verifiable reason for a QA key rather than a vague request for access.

The body is in **Spanish** — it is external copy addressed to a Colombian vendor, the carve-out the repo's
language rule makes for copy in its audience's language. Everything else in this folder stays English.

## Where to send it

| Field                         | Value                                                                          | Source                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| To                            | `comercial@saludtools.com`                                                     | saludtools.com/contacto — "nuevos clientes y cotizaciones"                                                             |
| Cc                            | `ayuda@saludtools.com`                                                         | same page — support channel, keeps a ticket trail                                                                      |
| WhatsApp (faster first touch) | +57 311 666 4347                                                               | same page — the vendor advertises it as "respuesta inmediata"                                                          |
| Worth checking first          | `saludtools.com/portal-de-habilitadores` and the _directorio de habilitadores_ | the vendor runs an enablers/partner programme; if it has a self-serve path to API access, it is faster than this email |

**Send the WhatsApp message too.** The vendor pushes that channel hardest, and the Cloudbeds lesson is that
a partner-access conversation left in email can sit for weeks. A short WhatsApp asking who handles API
integrations, with the email already sent, costs nothing.

## Subject

> Solicitud de credenciales de ambiente de pruebas (QA) — integración con la API de Saludtools

## Body

Buen día,

Escribo desde **xcale**, una plataforma de agentes de inteligencia artificial que atienden por WhatsApp a
los pacientes de las clínicas y consultorios que la usan: reconocen al paciente, le dicen qué citas tiene y
le agendan, mueven o cancelan una cita contra la agenda real del prestador.

Estamos construyendo la integración con Saludtools a partir de su documentación pública
(`developer.saludtools.com`) y de la colección de Postman que ustedes publican allí. El diseño ya está
hecho y funcionando: autenticación por ApiKey contra `/integration/authenticate/apikey/v1/` y los eventos
de paciente y de cita contra `/integration/sync/event/v1/`.

Una de nuestras clínicas cliente nos facilitó su ApiKey de producción y con ella verificamos el contrato,
pero **el ambiente de pruebas la rechaza** (`412`, "La llave es invalida para generar el token"), así que
entendemos que QA requiere credenciales propias. Preferimos no seguir probando contra la cuenta real de un
prestador — sobre todo porque la credencial que emite Saludtools trae permisos de administrador y no vemos
una opción de solo lectura.

Para poder terminarla necesitamos **credenciales (key y secret) del ambiente de pruebas**, el que aparece
en su propia documentación como `saludtools.qa.carecloud.com.co`. Las usaríamos únicamente para:

1. verificar el contrato real de la API — la forma exacta de las respuestas, los códigos de error y el
   tiempo de vida del `access_token`;
2. dejar pruebas automatizadas contra respuestas reales, no inventadas;
3. validar el flujo completo de agendamiento sin tocar datos de pacientes reales.

Tres cosas que quizá les ayuden a ubicar la solicitud:

- **No necesitamos acceso a datos de producción para esto.** Un ambiente de pruebas con datos ficticios es
  exactamente lo que buscamos, y es la razón por la que preferimos QA antes que la cuenta de una clínica.
- **La credencial de cada clínica es de la clínica.** Nuestro modelo es que cada prestador emite y es dueño
  de su propia ApiKey; nosotros somos el integrador y la custodiamos cifrada por cuenta del cliente. No
  revendemos acceso a Saludtools.
- **Estamos tratando datos de salud como datos sensibles** (Ley 1581): la integración expone únicamente los
  campos necesarios para agendar, y las operaciones de escritura sobre la historia clínica quedan fuera del
  alcance del agente.

Quedo atento a saber cuál es el camino correcto para esto — si se gestiona por el **portal de habilitadores**,
si hay un programa de integraciones o partners, o si requieren algún acuerdo firmado previo. Si necesitan
que lo canalice otra persona de nuestro lado o información adicional de la empresa, me la piden sin problema.

Muchas gracias,

**[Nombre]**
xcale — [cargo]
[correo] · [teléfono]

## Notes for whoever sends it

- **Do not attach or paste any credential**, ours or a clinic's, in this thread.
- If they answer "get it through a client clinic", that is Q1 track 1 and it is already moving — say so and
  still ask whether a QA key can be issued to the integrator, because a QA key is what lets us keep
  recording fixtures after the clinic's key is in production use.
- If they ask for a signed agreement: that is a Mateo decision, not a build blocker to negotiate over email.
  Bring it back rather than accepting terms.
- Log the outcome in `grill-notes.md` §6 Q1 with the date, whichever way it goes.
