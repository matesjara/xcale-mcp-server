# HiMed unified provider — Ship Log (S9: verificación E2E en sandbox)

> Bitácora de la verificación E2E del **provider unificado `himed`** (Opción B: una conexión, tres
> grupos de credenciales) contra el sandbox de HiMed. Journal de trabajo fechado — permitido en español.
> **Sin secretos aquí**: los tres tokens + `codigo_servicio` viven en env/Doppler/la conexión Rail A.
>
> - **Repos:** `xcale-mcp-server` (rama `feat/himed-provider`, provider único `himed`) + `xcale-backend`
>   (rama `feat/himed-connect`, consumidor + lifecycle-messages).
> - **Ambiente:** Sandbox de HiMed. Ventana de pruebas del ship-log previo: **2026-10-01 → 2026-10-09**.
> - **Hosts del sandbox** (via override de env, sin cambio de código):
>   - Demográficos + directorio: `https://demo.medsas.co/interoperabilidad/Api/Controllers`
>   - Autoagendamiento: `https://demo-notificaciones.medsas.co/notificaciones/envioConsumoAutoagendamiento`
> - **Harness:** `scripts/himed-unified-sandbox-e2e.ts` (`npx tsx`). Dos modos: PROBE (sin credenciales)
>   y FULL (con los cuatro env). El flujo completo **muta** el sandbox (crea paciente + cita) y limpia
>   (cancela) al final — igual que el ship-log de `himed-connect`.

## Mapa de credenciales (por rol — valores NO aquí)

| Rol | env del harness | Grupo del provider | Dónde viaja |
|:--|:--|:--|:--|
| Token Demográficos | `HIMED_DEMOGRAFICOS_TOKEN` | `demograficos` | body `api_key` |
| Token de Servicio (directorio) | `HIMED_DIRECTORIO_TOKEN` | `directorio` | body `api_key` |
| Token Autoagendamiento | `HIMED_AUTOAGENDAMIENTO_TOKEN` | `autoagendamiento` | body `token` |
| Código de servicio | `HIMED_CODIGO_SERVICIO` | (contexto `codigo_servicio`) | body `codigo_servicio` |

---

## 2026-10-02 — Sesión S9

### ✅ Lo que verifica S9 (y que el ship-log de Opción A no cubría)
El ship-log de `himed-connect` ya probó el flujo crudo contra el sandbox el 2026-10-01, pero **bajo la
Opción A** (dos providers: `himed` + `himed-scheduling`, split de directorio, `connectWithoutProbe`).
S9 verifica que el **mismo flujo ocurre a través del provider unificado `himed`**: una sola conexión
que lleva el bundle de tres secretos, y **cada tool resuelve el secreto de su grupo y llega a su host**
(ADR `himed-multi-credential-provider`).

### ✅ Unit — enrutamiento por grupo (rama head)
`npm test -- src/providers/himed` → **9 verdes**. Prueba: `create_patient`→Demográficos (`api_key`),
`list_locations`→directorio (`api_key`), `create_appointment`→Autoagendamiento (`token` + `codigo_servicio`),
`get_availability` manda `idEspecialista`, `cancel_appointment` exige `idPaciente`, 401→`AUTH_EXPIRED`.

### ✅ Live PROBE — enrutamiento + clasificación de auth contra el sandbox real (sin credenciales)
`npx tsx scripts/himed-unified-sandbox-e2e.ts` (modo PROBE, con secretos dummy). Los tres grupos del
**provider unificado** (`providerSlug: "himed"`, tools `mcp_himed_*`) alcanzan su host y clasifican el
token inválido como `PROVIDER_AUTH_EXPIRED`:

| Grupo | Tool | Host alcanzado | Respuesta real | Clasificación |
|:--|:--|:--|:--|:--|
| directorio | `mcp_himed_list_locations` | `demo.medsas.co/.../Sedes/consultarSedes.php` | HTTP 401 `{"estado":"error","mensaje":"El token no es válido "}` | `AUTH_EXPIRED` ✅ |
| demograficos | `mcp_himed_create_patient` | `demo.medsas.co/.../Demograficos/crearPaciente.php` | HTTP 401 | `AUTH_EXPIRED` ✅ |
| autoagendamiento | `mcp_himed_list_patient_appointments` | `demo-notificaciones.medsas.co/...` | `{"success":false,"mensaje":"El token ingresado no es correcto."}` | `AUTH_EXPIRED` ✅ |

Esto confirma, en vivo, lo único nuevo de la unificación: **grupo → secreto → host**, y el mapeo de
error por grupo (directorio/Demográficos por status HTTP, Autoagendamiento por `mensaje`).

### ⏳ Pendiente — happy-path completo (crear paciente → agendar → citasPaciente → cancelar)
**No ejecutable en esta sesión**: requiere los tres tokens demo + `codigo_servicio`, que por diseño no
están en el repo ni en Doppler (son credenciales de la conexión, usadas manualmente el 2026-10-01).
El harness ya trae el flujo completo y lo corre con un solo comando cuando se exporten los cuatro env:

```bash
HIMED_DEMOGRAFICOS_TOKEN=…   HIMED_DIRECTORIO_TOKEN=… \
HIMED_AUTOAGENDAMIENTO_TOKEN=… HIMED_CODIGO_SERVICIO=… \
npx tsx scripts/himed-unified-sandbox-e2e.ts
```

Dado que el ship-log de Opción A ya probó cada paso crudo en vivo (incl. `CrearCita`→`idCita`,
`citasPaciente` por presencia, `cancelarCita` con `idPaciente`) y que el PROBE confirma el enrutamiento
del provider unificado, el riesgo residual del happy-path es bajo: queda como una corrida de
confirmación de un comando, no como trabajo de integración.

## Estado E2E (provider unificado)
| Flujo | Resultado |
|:--|:--|
| Unit: enrutamiento por grupo (9 tests) | ✅ |
| Live: hosts alcanzables + endpoints correctos | ✅ |
| Live: clasificación de auth por grupo (PROBE) | ✅ |
| Live: happy-path crear→agendar→citasPaciente→cancelar | ⏳ (1 comando; faltan los 4 env) |

## Seguimiento
- ✅ **Agent templates (S10, decidido por Mateo — Opción A):** los dos templates
  (`himed-patient-admin` + `himed-scheduling-agent`) se **colapsaron en uno**,
  `agent-templates/data/himed-clinic-agent.ts`, atado a `requiredIntegrations: ['whatsapp', 'himed']`,
  con registros + directorio + agenda en un solo agente de clínica. Guarda de contrato nueva: exactamente
  un template HiMed, sobre `himed`, y ningún template referencia el slug retirado `himed-scheduling`.
- ✅ **Muestras `himed-scheduling` en tests genéricos (S10 cleanup):** alineadas a `himed`
  (`mcp-tool-loader`, `mcp-client`, `tool-result-observers` + su test). El escenario "dos providers en
  un eje" de `vertical-scope-registry.test.ts` (que era el split viejo de HiMed, QB1) se **re-basó** a
  `himed` + `saludtools`, que es el par real vigente. Las únicas menciones a `himed-scheduling` que
  quedan son **aserciones negativas** (prueban que el slug ya no existe) y una nota histórica — no son
  referencias huérfanas.

---

## 2026-10-03 — Re-corrida del E2E: sandbox de HiMed caído (504)

Al re-ejecutar `scripts/himed-unified-sandbox-e2e.ts` (modo PROBE), los tres grupos fallaron — pero
**no por nuestro código**: el sandbox de HiMed está devolviendo **`504 Gateway Time-out`** en los
endpoints POST.

- `GET` a los hosts responde 200 (`demo.medsas.co`, `m.medsas.co`); DNS y red locales OK (example.com 200).
- `POST` a los tres grupos cae (verificado con `curl` —HTTP 000 por timeout— y con `node fetch` directo,
  cuerpo HTML de nginx): `Sedes/consultarSedes.php` → **504 (~60s)**, `Demograficos/crearPaciente.php` →
  **504 (~60s)**, `…/envioConsumoAutoagendamiento` → **502 Bad Gateway (~32s)**. Ayer (2026-10-02) esos
  mismos POST respondían **401 en <1s**.
- Nuestro provider clasificó el timeout como `PROVIDER_UNAVAILABLE` (fail-closed) — comportamiento
  correcto: no inventa éxito ante una caída del proveedor.

**Veredicto:** caída/degradación del lado del sandbox, transitoria. El PROBE y el happy-path quedan
pendientes de re-correr cuando el sandbox vuelva (ventana hasta 2026-10-09) y con los cuatro env de
credenciales presentes. Sin cambios de código: el harness y el provider están listos.

**Re-corrida con credenciales reales (mismo día):** con los cuatro tokens del sandbox cargados, el
harness entró en modo FULL (credenciales bien cableadas, las 4 parseadas), pero **las siete llamadas
siguieron dando `PROVIDER_UNAVAILABLE` / `HTTP 0`** — el POST al directorio sigue en timeout (>20s,
sin respuesta) horas después. Confirma que el bloqueo es exclusivamente la caída del sandbox, no las
credenciales ni el código. El happy-path queda pendiente de reintentar cuando HiMed restablezca el
sandbox.

**Cómo cargar credenciales sin exponerlas:** el harness bloquea secretos en línea de comando (bien).
El script ahora lee un archivo local gitignoreado (`.env.himed.sandbox`, patrón `.env.*`) vía un loader
tolerante (`KEY=value`, comillas, comentarios); `process.env` explícito gana. Se corre con
`npx tsx scripts/himed-unified-sandbox-e2e.ts` — ningún token pasa por el comando. El archivo nunca
se commitea.

## 2026-10-04 — Re-corrida del E2E: sandbox de HiMed sigue caído (día 2)

Re-ejecutado `scripts/himed-unified-sandbox-e2e.ts` en modo FULL (credenciales cargadas): **mismas siete
fallas** — `PROVIDER_UNAVAILABLE` / `HTTP 0` en directorio, Demográficos y Autoagendamiento (el
`cancel_appointment` da `PROVIDER_INVALID_INPUT` solo porque no hubo `idCita` que cancelar).

Diagnóstico manual con `curl`:

- `GET https://demo.medsas.co/` → **200 (~1s)**; `GET …/interoperabilidad/` → 403 (~0.3s). Host y DNS OK.
- `POST …/Sedes/consultarSedes.php` y `…/Usuarios/consultarUsuarios.php` → **sin respuesta (timeout
  20–40s)**, con o sin body.
- `POST …/envioConsumoAutoagendamiento` vacío → **400 (~0.8s)**, pero con body JSON → **sin respuesta
  (timeout 40s)**.

**Veredicto:** el front (nginx) de HiMed responde; la capa de aplicación detrás no termina las
requests. Caída del lado del proveedor, no del código ni de las credenciales. Escalado a HiMed.
Happy-path sigue pendiente (ventana hasta 2026-10-09).

## 2026-10-05 — Sandbox intermitente: 6/7 en verde + bug de idempotencia en create_patient

En la mañana seguía caído (timeout, igual que el 03 y 04). A las **16:57** volvió (401/403 en <0.5s
con token dummy) y el E2E FULL dio **6/7 en verde**: `list_locations`, `create_appointment` (idCita
1030), el verifier `list_patient_appointments` (holds), `cancel_appointment` y el verifier (resolved).
**El ciclo completo de agendamiento funciona contra el sandbox real a través del provider unificado.**

El único rojo fue `create_patient` → `PROVIDER_INVALID_INPUT (HTTP 400)`, y era **bug nuestro**: el
paciente de prueba `1099999001` ya existía y HiMed responde un paciente existente con **`400` +
`"El paciente ya existe en HiMed Web"`** (+ `datos_paciente`), no con `201` como asumía `unwrapHimed`.
La tool promete idempotencia, así que un paciente recurrente habría frenado el agendamiento. Un
paciente nuevo sí responde `207 warning` (almacenado, campos opcionales vacíos) — verificado con un
id aleatorio. Fix: ese `400` se mapea a éxito con un envelope sin PHI (`{ estado: 'exists', mensaje }`);
cualquier otro `400` sigue `INVALID_INPUT`. Tests nuevos, suite completa 460/460.

Al re-correr con el fix (**17:06**) el sandbox ya estaba **caído de nuevo** (timeout). Falta una
corrida 7/7 cuando vuelva a estar arriba.

## 2026-10-06 — S9 en verde: E2E 7/7 contra el sandbox real

Sandbox arriba a las **07:35**. La primera corrida siguió en 6/7: el fix de ayer **no se disparaba en
vivo**. Causa: el transporte (`src/core/http.ts`) corta el body de error a 500 caracteres y HiMed
devuelve todo el `datos_paciente`, así que el JSON llegaba truncado, `parseBody` devolvía `null` y el
`mensaje` nunca se leía. El test unitario no lo veía porque usaba un body corto. Fix: leer el `mensaje`
del texto crudo con una regex (va al inicio del body, antes del corte); el test ahora usa un body de
más de 500 caracteres y se vio en rojo antes del fix. Sin tocar `src/core`.

Re-corrida: **7/7 en verde** — `list_locations`, `create_patient` (paciente existente → `exists`),
`create_appointment` (idCita 1032), verifier holds, `cancel_appointment`, verifier resolved.
**S9 cerrado.** Suite completa 460/460.

---

## Estado as-built — cómo quedó funcionando la Opción B

HiMed es **un solo provider multi-credencial** de punta a punta. Una conexión por clínica lleva los
tres secretos + el `codigo_servicio`; cada tool resuelve el secreto de SU grupo y pega a SU host, y el
agente de clínica usa las 14 tools en un mismo turno.

**1. mcp-server (`feat/himed-provider`) — el provider `himed`**
- `authDescriptor.groups: CredentialGroup[]` con tres grupos: `demograficos` (api_key, body),
  `directorio` (api_key, body), `autoagendamiento` (token, body). `fields` lista los dos nombres de
  wire distintos (`api_key`, `token`); el formulario se deriva de `groups` (una entrada por grupo).
- Cada `ToolDefinition` declara su `credentialGroup`. El **materializer group-aware**
  (`materialize(auth, resolved, spec, group?)`) inyecta el secreto del grupo llamado; se conserva el
  invariante de **un solo `.reveal()`** (helper `secretFor`). Las 14 tools: writes de Demográficos +
  lecturas de directorio + Autoagendamiento. Probe = `mcp_himed_list_locations` (lectura de directorio).
- El client rutea por host: Demográficos + directorio a `…/Controllers/{op}.php`; Autoagendamiento al
  endpoint RPC único (dispatch por `accion`). `HIMED_BASE_URL` / `HIMED_SCHEDULING_BASE_URL` por env
  apuntan al sandbox sin tocar código.

**2. El cable (wire) — bundle de secretos**
- El backend reenvía el bundle como header `X-Provider-Credentials` (JSON base64), separado de
  `X-Provider-Token`. El protocolo del gateway (`mcp-server.ts`) envuelve cada valor del bundle en un
  `SecretString` (sin reveal-parse) → `ResolvedCredential.secrets`. El materializer lee de ahí.

**3. backend (`feat/himed-connect`) — conexión + consumo**
- `buildCredentialConfig` (mcp-bootstrap): cuando el descriptor trae `groups`, arma el formulario
  multi-secreto, **prueba con `list_locations`** pasando el bundle, y guarda el bundle como **JSON
  cifrado en `credentialSecret`** (estilo `credential_exchange`). `accountKey = codigo_servicio`.
- El `McpToolExecutor` reenvía el bundle como `credentials` para providers con `credentialGroups`
  (`resolveCredentialBundle` descifra `credentialSecret`). Single-secret sigue mandando solo `token`.
- Catálogo (`toolboxes.ts`): **una** tarjeta `himed`. Vertical scope: **un** registro `himed` en
  `health` (junto a `saludtools`). i18n (es/en): **un** bloque `himed.connect.*` con `codigo_servicio`
  + los tres tokens por grupo.

**4. lifecycle-messages (Fase 3)** — el slug y los tool-names hablan el provider unificado:
`LifecycleIntegration` `'himed'`, `HIMED_BOOKING_TOOL_NAME = 'mcp_himed_create_appointment'`, el
verifier lee `connectionsOf('himed')` y llama `mcp_himed_list_patient_appointments`. El verifier arma
su `callTool` a mano, así que **reenvía el bundle** (`parseCredentialBundle`) para que la lectura de
Autoagendamiento encuentre su secreto de grupo (si no, fallaría cerrado con el token equivocado).

**5. agent-templates** — **un** `himed-clinic-agent` (registros + directorio + agenda), atado a
`requiredIntegrations: ['whatsapp', 'himed']`. Reemplaza el par `himed-patient-admin` +
`himed-scheduling-agent` del modelo viejo.

**Verificación (S9):** unit de ruteo por grupo verde (9 tests); PROBE en vivo contra el sandbox verde
(cada grupo pega a su host y clasifica auth); happy-path completo a un comando cuando se exporten los
tres tokens + `codigo_servicio` (ventana sandbox hasta 2026-10-09).

**Lo que revirtió de la Opción A:** se eliminaron el provider `himed-directory`, el flag
`connectWithoutProbe` y su ADR `probe-less-credential-connect`, y se plegaron `himed-directory` +
`himed-scheduling` dentro de `himed`. ADR que gobierna el modelo nuevo: `himed-multi-credential-provider`.
