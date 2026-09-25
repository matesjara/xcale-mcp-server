# HiMed — Implementation Plan (himed + himed-scheduling)

> **Inputs**: [`feature-design.md`](./feature-design.md) · [`api-contract.md`](./api-contract.md) · [`grill-notes.md`](./grill-notes.md)
> **ADR requerido**: body-placement (nuevo, ver Slice 0). **Last updated**: 2026-09-24
>
> Símbolos + intención, **no cuerpos**. Cada cambio a archivo existente está anclado a un `file:line` real.

## Meta

Se agregan **dos providers MCP** — `himed` (Demográficos) y `himed-scheduling` (Autoagendamiento) — siguiendo
el patrón `add-provider` (`manifest`/`auth`/`client`/`tools`/`errors`/`provider` + `__fixtures__`/`__tests__`).
La forma del cambio: un **único toque a `src/core`** — enseñar al materializer a colocar un `api_key` en el
**body** (`placement: 'body'`), habilitado por un **ADR excepcional** (golden rule). Sobre ese cimiento, los
dos providers se construyen **en paralelo** (footprints disjuntos). "Done" = los dos providers descubribles,
sus tools ejecutables contra el **sandbox** (que corre sin credenciales), errores mapeados, PHI curado, y
`tsc`/`lint`/tests verdes. Las formas marcadas `⏳` en el api-contract se **verifican contra el sandbox** dentro
de los slices 1–2 antes de fijarlas.

> **Fan-out recomendado:** el plan supera el umbral (2 slices independientes de footprint disjunto, >12 archivos).
> Slice 0 (core) lo hace el orquestador; slices 1 y 2 se delegan a un subagente cada uno; slice 3 lo cierra el orquestador.

## Árbol objetivo

```
src/core/
├── provider-port.ts                    MODIFIED  (placement union += 'body')
└── auth/
    ├── authentication-materializer.ts  MODIFIED  (rama body en el case api_key)
    └── __tests__/authentication-materializer.test.ts  MODIFIED  (caso body)

src/providers/
├── index.ts                            MODIFIED  (+ himedProvider, himedSchedulingProvider)
├── himed/                              NEW  (Demográficos)
│   ├── manifest.ts  auth.ts  client.ts  tools.ts  errors.ts  provider.ts  index.ts
│   ├── __fixtures__/*.json
│   └── __tests__/himed.test.ts
└── himed-scheduling/                   NEW  (Autoagendamiento)
    ├── manifest.ts  auth.ts  context.ts  client.ts  tools.ts  errors.ts  provider.ts  index.ts
    ├── __fixtures__/*.json
    └── __tests__/himed-scheduling.test.ts

docs/adr/
└── body-placement-for-api-key.md       NEW  (ADR excepcional; numerado al merge)
```

## Cambios por archivo (nivel ejecutivo)

### Core (Slice 0 — foundation)

| Archivo | Símbolo | Firma / cambio | Intención | Tipo |
|:--|:--|:--|:--|:--|
| `src/core/provider-port.ts:23` | `ProviderAuthDescriptor` | `placement: 'header' \| 'query' \| 'body'` | Habilita declarar credencial en el body | MODIFIED |
| `src/core/auth/authentication-materializer.ts:31-45` | `materialize()` | nueva rama en el case `api_key`: si `placement === 'body'`, parsea `spec.body` (JSON), inserta `{[field.key]: secret}`, re-serializa; header/query sin cambios | Coloca el secreto dentro del JSON del body (único punto con `.reveal()`) | MODIFIED |
| `src/core/auth/__tests__/authentication-materializer.test.ts` | test | caso: `placement:'body'` mete el secreto en el body y no lo filtra en URL/headers | Fija el contrato del nuevo placement | MODIFIED |

> **Nota de diseño (materializer):** `RequestSpec.body` es `string \| URLSearchParams` (`http-request.ts:25`).
> La rama body aplica solo a `body` JSON (string); si el body es `URLSearchParams` o ausente, es un error de
> descriptor (surface loud, no silencioso). El `.reveal()` sigue siendo el único del runtime.

### Provider `himed` (Slice 1 — Demográficos)

| Archivo | Símbolo | Firma | Intención | Tipo |
|:--|:--|:--|:--|:--|
| `himed/manifest.ts` | `himedManifest` | `ProviderManifest` (`slug:'himed'`, `category:'health'`) | Identidad + versión | NEW |
| `himed/auth.ts` | `himedAuth` | `ProviderAuthDescriptor` `api_key`/`forwarded`/`fields:[{key:'api_key',placement:'body'}]` | Credencial en body | NEW |
| `himed/client.ts` | `createHimedClient(deps?)` · `post(path, request, body)` | arma `RequestSpec` POST a `Demograficos/{op}.php` con body JSON | Cliente HTTP fino | NEW |
| `himed/errors.ts` | `classifyHimedFailure(status, body): ProviderErrorCode` | 401→`AUTH_EXPIRED`; 406/417/404→`INVALID_INPUT`; 5xx→`UNAVAILABLE` | Mapeo sobre `mapHttpStatusToErrorCode` | NEW |
| `himed/tools.ts` | `buildHimedTools(client)` → `create_patient`, `update_patient`, `change_patient_document` | `defineTool` con input zod (ver api-contract §1.7); salida curada `{estado,mensaje}` | Las 3 tools de paciente (write) | NEW |
| `himed/provider.ts` | `createHimedProvider(deps?)` · `himedProvider` | `createProvider({manifest,auth,tools})` (patrón `toteat/provider.ts:22-31`) | Factory + instancia default | NEW |

### Provider `himed-scheduling` (Slice 2 — Autoagendamiento)

| Archivo | Símbolo | Firma | Intención | Tipo |
|:--|:--|:--|:--|:--|
| `himed-scheduling/manifest.ts` | `himedSchedulingManifest` | `ProviderManifest` (`capabilities:{webhooks:false}`) | Identidad | NEW |
| `himed-scheduling/auth.ts` | `himedSchedulingAuth` | `api_key`/`forwarded`/`fields:[{key:'token',placement:'body'}]` | `token` = único secreto en body | NEW |
| `himed-scheduling/context.ts` | `himedSchedulingContext` | `z.object({ codigo_servicio: z.string().min(1) }).strict()` | `codigo_servicio` como metadata (no secreto, §2.2 api-contract) | NEW |
| `himed-scheduling/client.ts` | `createHimedSchedulingClient(deps?)` · `call(accion, request, ctx, args)` | arma un POST único; mete `accion` + args + `ctx.metadata.codigo_servicio` en el body; el materializer añade `token` | Un endpoint, dispatch por `accion` | NEW |
| `himed-scheduling/errors.ts` | `classifyHimedSchedulingFailure(body)` | mensajes de token→`AUTH_EXPIRED`; resto→`INVALID_INPUT`/`ERROR` | Mapeo por forma del body | NEW |
| `himed-scheduling/tools.ts` | `buildHimedSchedulingTools(client)` → 10 tools (ver api-contract §2.7) | `toolFactory<{codigo_servicio}>()`; inputs zod; salida curada PHI | patient_exists, list_*, get_availability, create/cancel_appointment, list_patient_appointments | NEW |
| `himed-scheduling/provider.ts` | `createHimedSchedulingProvider(deps?)` · `himedSchedulingProvider` | `createProvider({manifest,auth,metadataSchema:context,tools})` | Factory + instancia | NEW |

### Integración (Slice 3 — orquestador)

| Archivo | Cambio | Tipo |
|:--|:--|:--|
| `src/providers/index.ts:14-19` | importar y agregar `himedProvider`, `himedSchedulingProvider` a `PROVIDERS` | MODIFIED |

## Slices verticales (ordenados)

| # | Slice | Banda | Depende de | Footprint (owns) |
|:--|:--|:--|:--|:--|
| **S0** | ADR body-placement + `placement:'body'` en el materializer + tests | foundation (orquestador) | — | `docs/adr/`, `src/core/provider-port.ts`, `src/core/auth/*` |
| **S1** | Provider `himed` (Demográficos, 3 tools) + fixtures/tests + verificación sandbox | independent (subagente) | S0 | `src/providers/himed/**` |
| **S2** | Provider `himed-scheduling` (Autoagendamiento, 10 tools) + fixtures/tests + verificación sandbox | independent (subagente) | S0 | `src/providers/himed-scheduling/**` |
| **S3** | Registro en `index.ts` + round-trip (`server/discover`/`tools/list`/`tools/call` incl. 401) | integration (orquestador) | S1, S2 | `src/providers/index.ts` |

S1 y S2 tienen footprints **disjuntos** → corren en paralelo tras S0. Nadie más escribe el core después de S0.

## Mapa de delegación

- **Foundation (orquestador):** S0. El cambio de core se hace una vez; nunca se fanout (definición compartida).
- **Independent (un subagente c/u):** S1 y S2. Brief = este plan + api-contract + el ADR de S0 + libertad de lectura; owns solo su carpeta `src/providers/{slug}/**`.
- **Integration (orquestador):** S3 + `tsc`/`lint`/tests + verificación en sandbox.

## Verificación en sandbox (R-2) — dentro de S1/S2

Antes de fijar cada forma `⏳` del api-contract, una llamada al sandbox (`socket.medsas.co/test/...` para
citas; el de Demográficos según lo que libere HiMed). **Obligatorio** para `consultarDisponibilidad` y
`CrearCita` (doc truncada) y para: formato de fecha/hora, envelope de creación (R-5), "no encontrado" (200
vacío), tope de página (R-6). Lo capturado alimenta `__fixtures__/`.

## Test strategy + Definition of Done

Por slice y global (soul.md: nada "done" sin chequeo real):
- **S0:** `authentication-materializer.test.ts` — body placement mete el secreto en el body y **no** en URL/headers; quitar la rama pone el test en rojo.
- **S1/S2:** conformance (`runProviderConformance`) + por tool: input zod valida, salida curada (ningún campo PHI fuera del allow-list), errores mapeados (token→`PROVIDER_AUTH_EXPIRED`), redacción de credencial en `core/__tests__/http.test.ts`, no-duplicación de `create_patient` (envelope), y que ninguna tool destructiva aparezca en `tools/list`.
- **Global:** `npx tsc --noEmit` limpio · `npm run lint` limpio · `npm test` verde · round-trip S3 (incl. 401→`PROVIDER_AUTH_EXPIRED`).

## Sub-issues (Step 6b)

Aplica el disparador de paralelismo real (S1/S2 disjuntos). **Opcional**: materializar S0–S3 como sub-issues.
Ojo de repo: la épica #1053 es de **xcale-backend**; estas sub-issues son de **`xcale-mcp-server`** (o se
referencian cruzadas). **Misma rama, un solo PR a `dev`, gates una vez** — la descomposición solo compra
construir S1/S2 en paralelo. (Pendiente confirmar con Sara si se crean.)

## Fuera de este plan (track backend, gated)

Registrar `(health, himed)` en `register-vertical-scopes.ts`, conexiones Rail A y curación PHI a nivel
consumidor viven en **xcale-backend**, gated a que `feat/saludtools-connect` mergee a `dev` (feature-design §10).
Ley 1581 = `xcale-backend#1055`.
