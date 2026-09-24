# Dentalink Provider (v1) — Implementation Plan

> **Companion of**: [feature-design.md](feature-design.md) · [api-contract.md](api-contract.md) · [grill-log.md](grill-log.md)
> **ADR honored**: [api-key-header-scheme-prefix](../../adr/api-key-header-scheme-prefix.md), [0045 (backend)](../../../xcale-backend/docs/adr/0045-credential-connections-for-mcp-backed-providers.md), [0009 canonical-provider-pattern](../../adr/0009-canonical-provider-pattern.md), [0010 credential-delivery](../../adr/0010-credential-delivery-strategies.md)
> **Status**: Draft — build map. **Blocked on a real token for the verification gate (no sandbox exists).**
> **Last Updated**: 2026-09-24

---

## Meta-descripción

Este plan construye el provider `dentalink` en `xcale-mcp-server` como **MCP credential provider**
(`api_key`, `Authorization: Token <token>`, `forwarded`), más el único cambio de core que su auth
obliga (el `scheme` prefix del ADR) y el cableado mínimo del consumer (`xcale-backend`). La forma es
un adaptador delgado calcado de Siigo/Toteat: `manifest.ts` + `auth.ts` + `client.ts` + `tools.ts` +
`errors.ts` + `provider.ts` + `index.ts`, registrado con **una línea** en `src/providers/index.ts`.

**La restricción que gobierna el plan: no hay token ni sandbox** (el cliente confirmó que Dentalink no
ofrece ambiente de pruebas). Por eso el trabajo se parte en dos fases separadas por un **gate de
verificación**:

- **Fase A (token-independiente)** — todo lo que se puede construir y verificar **sin** tocar la API
  real: el cambio de core (con test unitario + mutación), el scaffold del provider, los inputs zod de
  las tools, y el cableado del backend. Sale verde con `tsc` + `npm test` sin red.
- **Fase B (token-gated)** — lo que **solo** se puede congelar observando la API real: las
  result-shapes verbatim, el clasificador de errores (`errors.ts`), los `__fixtures__` reales, la
  conformance suite, y el **write path** (`create_patient`/`create_appointment`), que al no haber
  sandbox se ejerce contra producción read-first y con sign-off explícito (como el "first write" de
  Toteat).

"Done" de Fase A = compila y las tools existen con inputs válidos. "Done" de v1 = Fase B verde contra
un token real, todos los `⏳` del api-contract resueltos, `sandbox-evidence.md` escrito.

> **Detalle por fase (rolling-wave):** la Fase A está especificada a nivel de símbolo (su código no
> depende de la API). La Fase B está a nivel de slice a propósito — sus shapes/errores **no existen
> hasta observarlos**, y anclarlos ahora sería inventar (regla anti-alucinación + Evidence rule del
> api-contract). Su detalle por-archivo se autoría en su gate, contra las respuestas reales.

---

## Target file tree

```
xcale-mcp-server/
├── src/
│   ├── core/
│   │   ├── provider-port.ts                         MODIFIED  (api_key field gana `scheme?`)
│   │   └── auth/
│   │       ├── authentication-materializer.ts       MODIFIED  (branch header aplica el prefix)
│   │       └── __tests__/authentication-materializer.test.ts  MODIFIED (test + mutación)
│   ├── config/…                                     MODIFIED  (DENTALINK_BASE_URL)
│   └── providers/
│       ├── index.ts                                 MODIFIED  (1 línea: dentalinkProvider)
│       └── dentalink/                               NEW
│           ├── manifest.ts                          NEW
│           ├── auth.ts                              NEW
│           ├── client.ts                            NEW
│           ├── tools.ts                             NEW
│           ├── errors.ts                            NEW  (Fase B: clasificador real)
│           ├── provider.ts                          NEW
│           ├── index.ts                             NEW
│           ├── __tests__/                           NEW
│           └── __fixtures__/                        NEW  (Fase B: respuestas reales)
├── .env.example                                     MODIFIED  (DENTALINK_BASE_URL)
└── docs/design/dentalink-provider/
    └── sandbox-evidence.md                          NEW  (Fase B: journal de verificación)

xcale-backend/                                       (consumer — repo aparte)
├── src/modules/mcp/toolboxes.ts                     MODIFIED  (1 entrada MCPToolboxDefinition)
└── src/infrastructure/i18n/locales/{en,es}.json     MODIFIED  (dentalink.error.invalid_credentials)
```

`UNCHANGED (context)`: `src/core/provider-factory.ts`, `src/core/tool.ts`, `src/core/pagination.ts`,
`src/core/http.ts`, `src/modules/mcp/mcp-bootstrap.ts` (backend) — el registro credential es genérico
(ADR-0045), no se toca.

---

## Cambios por archivo (nivel ejecutivo — firmas + intención, sin cuerpos)

### Core (Fase A) — el cambio del ADR

**`src/core/provider-port.ts`** (MODIFIED) — ancla `provider-port.ts:16-25`

| Símbolo | Firma | Intención | Seam | Tipo |
|:--|:--|:--|:--|:--|
| `ProviderAuthDescriptor` (variante `api_key \| bearer`) | agregar `readonly scheme?: string` al objeto de `fields[]` (junto a `key`/`label`/`placement`) | declarar el prefijo de esquema opcional para header placement | catálogo público (`server/discover`) + materializer | MODIFIED |

**`src/core/auth/authentication-materializer.ts`** (MODIFIED) — ancla `authentication-materializer.ts:39-43`

| Símbolo | Firma | Intención | Seam | Tipo |
|:--|:--|:--|:--|:--|
| `materialize(auth, resolved, spec): HttpRequest` — branch `case 'api_key'` header | `headers[field.key] = field.scheme ? \`${field.scheme} ${secret}\` : secret` | aplicar el prefix cuando está declarado; sin `scheme` = comportamiento actual byte-idéntico | el único `.reveal()` (`:26`); `assertNever` (`:64`) intacto | MODIFIED |

**`src/core/auth/__tests__/authentication-materializer.test.ts`** (MODIFIED) — ancla `:19` (test api_key header)

| Símbolo | Intención | Tipo |
|:--|:--|:--|
| test `api_key header con scheme → Authorization: Token <secret>` | prueba el prefix; **mutación**: quitar el prefix debe poner el test en rojo | NEW (dentro del archivo) |
| test `api_key header sin scheme → secreto crudo` | fija que el default no cambió | NEW |

### Provider `dentalink` (calcado de `siigo/*` y `toteat/*`)

**`src/providers/dentalink/auth.ts`** (NEW) — molde `toteat/auth.ts:23-27`

| Símbolo | Firma | Intención | Tipo |
|:--|:--|:--|:--|
| `dentalinkAuth` | `ProviderAuthDescriptor` = `{ type:'api_key', credentialDelivery:'forwarded', fields:[{ key:'Authorization', label:'API Token', placement:'header', scheme:'Token' }] }` | declarar la auth; el token va en header con prefijo `Token ` | NEW |

**`src/providers/dentalink/manifest.ts`** (NEW) — molde `toteat/manifest.ts:18-33`

| Símbolo | Firma | Intención | Tipo |
|:--|:--|:--|:--|
| `SLUG` | `= 'dentalink'` | slug estable | NEW |
| `dentalinkManifest` | `ProviderManifest` (`slug`, `displayName:'Dentalink'`, `category:'healthcare'`, `schemaVersion`, `providerVersion`, `connectionProbe:{ tool:\`mcp_${SLUG}_list_branches\` }`) | identidad + el probe obligatorio (ADR-0045). **Sin** `contextSchema`/`accountContextKeys` (un token = una clínica; `id_sucursal` es argumento) | NEW |

**`src/providers/dentalink/client.ts`** (NEW) — molde `siigo/client.ts` (GET) + `toteat/client.ts` (POST)

| Símbolo | Firma | Intención | Tipo |
|:--|:--|:--|:--|
| `createDentalinkClient(deps): DentalinkClient` | `{ baseUrl?, fetchImpl? }` → `{ get(path, ctx.request, query?), post(path, ctx.request, body) }` sobre `core/http` | HTTP tipado sobre la base URL fija; **nunca** interpola el token/URL en errores | NEW |

**`src/providers/dentalink/tools.ts`** (NEW) — molde `siigo/tools.ts` (`defineTool`/`definePaginatedList`)

| Símbolo | Firma | Intención | Tipo |
|:--|:--|:--|:--|
| `buildDentalinkTools(client): ReadonlyArray<ToolDefinition>` | las 9 tools `mcp_dentalink_*` (§1.2 api-contract), inputs zod `.strict()` (§1.3) | menú del agente; `find_patient` compone el filtro `q={"<col>":{"eq":documento}}` | NEW (inputs Fase A; result-shapes Fase B) |

**`src/providers/dentalink/errors.ts`** (NEW) — molde `siigo/errors.ts:51-63`

| Símbolo | Firma | Intención | Tipo |
|:--|:--|:--|:--|
| `unwrapDentalink(res, operation): Unwrapped` | clasifica éxito/error; **permiso ≠ `PROVIDER_AUTH_EXPIRED`**; conflicto → `PROVIDER_CONFLICT` | **Fase B** — el clasificador se escribe contra el comportamiento observado (¿4xx limpio o `200+ok:false`?), no contra supuestos | NEW (Fase B) |

**`src/providers/dentalink/provider.ts`** (NEW) — molde `siigo/provider.ts:27-42`

| Símbolo | Firma | Intención | Tipo |
|:--|:--|:--|:--|
| `createDentalinkProvider(deps): IProvider` | vía `createProvider({ manifest, auth, tools, fetchImpl? })` | factory con DI | NEW |
| `dentalinkProvider` | `= createDentalinkProvider()` | instancia default | NEW |

**`src/providers/dentalink/index.ts`** (NEW) — re-export (molde `siigo/index.ts`).

**`src/providers/index.ts`** (MODIFIED) — ancla `providers/index.ts:15-21`

| Símbolo | Intención | Tipo |
|:--|:--|:--|
| `PROVIDERS` | `import { dentalinkProvider } from './dentalink'` + añadirlo al array | MODIFIED (1 línea) |

**`src/config/*`** (MODIFIED) + `.env.example` — `DENTALINK_BASE_URL` (default `https://api.dentalink.healthatom.com/api/v1/`).

### Backend consumer (`xcale-backend`) — genérico, sin código por-provider (ADR-0045)

| Archivo | Cambio | Tipo |
|:--|:--|:--|
| `src/modules/mcp/toolboxes.ts` | 1 entrada `MCPToolboxDefinition` (`id:'dentalink'`, `category:'healthcare'`, displayName, description, features, `mcpServerUrl`) | MODIFIED |
| `src/infrastructure/i18n/locales/en.json` + `es.json` | key `dentalink.error.invalid_credentials` | MODIFIED |

---

## Vertical slices (ordenadas)

| # | Slice | Fase | Banda | Depende de | Footprint |
|:--|:--|:--|:--|:--|:--|
| **S0** | Core `scheme` prefix + tests (unit + mutación) | A | foundation | — | `provider-port.ts`, `authentication-materializer.ts` (+ test) |
| **S1** | Scaffold del provider: `manifest.ts`, `auth.ts`, `client.ts`, `provider.ts`, `index.ts` + línea en `providers/index.ts` + config | A | foundation | S0 | `src/providers/dentalink/*` (skeleton), `providers/index.ts`, `config` |
| **S2** | Tools de lectura: inputs zod + handlers de las 6 reads (`list_branches`, `list_specialties`, `list_professionals`, `list_treatments`, `list_services`, `list_available_slots`) | A(build)/B(verify) | independent | S1 | `tools.ts` (reads) |
| **S3** | Tools de paciente + booking: `find_patient` (filtro `q`), `create_patient`, `create_appointment` | A(build)/B(verify) | independent | S1 | `tools.ts` (writes) |
| **S4** | Backend wiring: entrada en `toolboxes.ts` + i18n | A | integration | S1 | `xcale-backend/*` |
| **GATE** | **Verificación con token real** (no sandbox → producción read-first) | B | — | S2, S3 | — |
| **S5** | `errors.ts` clasificador + `__fixtures__` reales + conformance + result-shapes finales | B | integration | GATE | `errors.ts`, `__fixtures__/`, `__tests__/`, `tools.ts` (shapes) |
| **S6** | Write path probado contra clínica real (sign-off) + `sandbox-evidence.md` | B | integration | S5 | `sandbox-evidence.md`, ajustes |

---

## Delegation map & fan-out

Files tocados ≈ 12-14; slices independientes reales = 2 (S2, S3, y comparten `tools.ts` → **no**
paralelizan sin pisarse). **Recomendación: build solo (main agent), no fan-out.** S0 es la foundation
(se hace primero, sola). El umbral (>4 slices independientes o >~12 files disjuntos) no se cumple:
la mayor parte es un módulo provider cohesivo con un único seam de escritura (`tools.ts`).

**No 6b sub-issues** (PD-1): 1 epic → 1 lane → 1 PR. No hay paralelismo genuino que lo justifique.

---

## Test strategy & Definition of Done

Comandos reales del repo (MCP, no backend `localhost:3200`):

- Type check: `npx tsc --noEmit` limpio.
- Lint: `npm run lint` limpio.
- Tests: `npm test` (Vitest) — el materializer test (S0, con mutación), y la conformance del provider (S5).
- Contract probe: `node scripts/contract-probe.mjs` verde.

**DoD por fase:**

- **Fase A done** (sin token): `tsc` + `lint` + `npm test` verdes; el provider aparece en el catálogo
  (`server/discover`); `list_tools` lista las 9 tools; el materializer emite `Authorization: Token …`
  probado por test. Las tools **existen con inputs válidos** pero sus result-shapes/errores están
  marcados provisionales.
- **GATE (bloqueante, no silencioso — soul.md):** con un token real de una clínica, correr el §8 del
  api-contract. **Read-first**; el write path solo con sign-off explícito (no hay sandbox → es
  producción). Si el gate no puede correr (sin token), **la v1 no cierra** — Fase A se puede mergear
  como base, pero el provider **no se anuncia como conectable** hasta pasar el gate.
- **v1 done**: todos los `⏳` del api-contract resueltos contra respuestas reales; `errors.ts`
  clasifica el comportamiento observado (permiso ≠ auth-expired; conflicto → `PROVIDER_CONFLICT`);
  `__fixtures__` reales anonimizados; conformance verde; `sandbox-evidence.md` escrito.

**Checkboxes (se tildan al construir):**

- [x] S0 core scheme prefix + mutación
- [ ] S1 scaffold provider + registro + config
- [ ] S2 read tools (build)
- [ ] S3 patient + booking tools (build)
- [ ] S4 backend wiring (toolboxes + i18n)
- [ ] GATE verificación con token real (§8 api-contract)
- [ ] S5 errors + fixtures + conformance (post-token)
- [ ] S6 write path con sign-off + sandbox-evidence.md

---

## Riesgos específicos del build

- **R-plan-1 — Sin token/sandbox, S5/S6 no pueden verificarse.** Es el gate. Fase A avanza; el resto
  espera el token del cliente. No congelar shapes/errores contra supuestos (Evidence rule).
- **R-plan-2 — El prefix podría ser innecesario** si en vivo Dentalink acepta otra forma de auth
  (Q-1). S0 es barato y genérico igual; si resulta innecesario, se revierte el descriptor (no el core).
- **R-plan-3 — Escritura contra producción real** (no hay sandbox): S6 es la única forma de probar
  `create_*`. Mitigación: paciente/cita de prueba, sign-off explícito, y borrado manual en el panel
  por el staff (v1 no expone cancelar). Read-first siempre primero.
- **R-plan-4 — `errors.ts` es el riesgo clase-Toteat.** No se escribe hasta observar si Dentalink
  devuelve 4xx limpio o `200+ok:false`, y si "sin permiso" se distingue de "token inválido".

---

## Next steps

1. **Construir Fase A** (S0→S1→S2/S3 build→S4) — no necesita token; deja el provider en el catálogo y
   el core listo. `/tdd` por slice (S0 es el más limpio para TDD: unit + mutación).
2. **Esperar el token** del cliente → correr el GATE (§8 api-contract) → S5/S6.
3. `/git-workflow` para el PR a `dev` (ya vamos commiteando en `feat/dentalink-provider`).
