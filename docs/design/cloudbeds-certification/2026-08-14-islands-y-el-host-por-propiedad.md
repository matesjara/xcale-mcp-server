# Islands: el host por propiedad — el mecanismo, y por qué no lo hemos construido

**Fecha:** 14 de agosto de 2026 · **Anexo** al informe de certificación (`2026-08-02-informe-certificacion.md`)

> Esto responde a medias la pregunta 2 de §9 del informe — _"confirm whether Island 2 uses a
> different API host than `hotels.cloudbeds.com`"_ — con lo que dice su documentación, y deja
> escrito el mecanismo para que la respuesta de Gabriela se traduzca en código sin volver a
> investigar.

## Qué dice su documentación

Cloudbeds publica `GET /oauth/metadata` con un propósito explícito: _"to retrieve the precise
location of the property associated with the provided access token"_, en el contexto de _"properties
being distributed across multiple localizations"_. Devuelve `data.api.url` — el host correcto **para
esa propiedad**, resuelto a partir del token.

Es decir: el host no es una constante del proveedor, es un atributo de la conexión.

## Dónde nos golpea

`src/providers/cloudbeds/client.ts` tiene `DEFAULT_BASE_URL = 'https://hotels.cloudbeds.com/api/v1.3'`
como constante de construcción. `baseUrl` es un override del **constructor**, no un valor por
llamada, así que hoy todas las propiedades comparten un host.

Si Island 2 usa otro host, un hotel de esa región conectaría bien —el OAuth vive en
`hotels.cloudbeds.com` para todos— y **luego fallarían todas las llamadas de datos**. El fallo
llegaría como error de proveedor genérico, sin nada que apunte a la región.

La certificación prueba explícitamente Island 1 **e** Island 2, así que esto se topa con el revisor
aunque no se tope antes con un cliente.

## El diseño, si la respuesta es "sí, hay otro host"

Encaja mayormente en maquinaria que ya existe:

1. **Descubrir** el host tras el OAuth, análogo a lo que ya hacemos con `propertyID` — pero con dos
   piezas reales de trabajo: `contextDiscovery` hoy es un objeto único `{ key, tool, resultPath }`
   (`src/core/provider-port.ts`), así que una segunda clave (`apiBaseUrl`) exige reformarlo a
   multi-entrada; y su fuente sería `GET /oauth/metadata`, que hoy no está expuesto como tool de
   descubrimiento. Sigue siendo un cambio **aditivo** del catálogo (ADR
   `additive-contract-versioning`), pero toca el port — no es solo declarar una clave más.
2. **Guardarlo** en el `metadata` de la conexión: eso ya lo hace el consumidor en `onConnected`.
3. **Reenviarlo** por `X-Provider-Metadata`, que ya viaja en cada `tools/call` y ya se valida contra
   el `metadataSchema` del proveedor (`src/core/provider-factory.ts`).
4. **Usarlo** como `baseUrl` por llamada en el cliente de Cloudbeds.

**La parte que no es mecánica, y es la razón de no improvisarla:** el paso 4 hace que el servidor
llame a un host que le llegó **desde el consumidor**, con el token del cliente. Eso es una superficie
SSRF. Tiene que ir con una **allowlist de dominio** (`*.cloudbeds.com`) validada en el egress del
proveedor, y con el fallback al host por defecto cuando el valor no pasa. Sin esa validación, un
`metadata` corrupto exfiltra el token de un hotel.

`PAYMENTS_BASE_URL` y `V2_BASE_URL` quedan **fuera** del override: ya están declarados como
constantes deliberadamente independientes del `baseUrl` de v1.3, y no hay evidencia de que Payments
esté regionalizado.

## Por qué está parado

- **La pregunta ya está hecha** (§9 #2). Si la respuesta es "el host es el mismo para todas las
  islas", todo lo de arriba sobra y habríamos añadido una superficie SSRF a cambio de nada.
- **No tenemos con qué probarlo.** El informe ya lo lista: _"Segunda cuenta de prueba (Island 2) —
  hay que pedirla — Cloudbeds"_. Construir una resolución de host por propiedad sin una segunda
  propiedad contra la que ejercitarla es escribir código que solo se estrena en la llamada de
  certificación.

**Disparador para retomarlo:** que Gabriela confirme hosts distintos, o que llegue la cuenta de
Island 2 — lo que ocurra primero.

## Referencias

- `2026-08-02-informe-certificacion.md` §9 (pregunta 2) y la tabla de §1 (segunda cuenta de prueba)
- `src/providers/cloudbeds/client.ts` — `DEFAULT_BASE_URL`, `PAYMENTS_BASE_URL`, `V2_BASE_URL`
- `src/providers/cloudbeds/manifest.ts` — `contextDiscovery`
- Cloudbeds: [oauth/metadata](https://developers.cloudbeds.com/reference/get_oauth-metadata-2) ·
  [Integration Guide](https://developers.cloudbeds.com/docs/integration-guide)
