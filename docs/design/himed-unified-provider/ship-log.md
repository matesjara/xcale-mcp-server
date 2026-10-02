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
- **Ejemplos en tests genéricos de mcp** (`mcp-tool-loader`, `mcp-client`, `tool-result-observers`)
  usan `himed-scheduling` como string de muestra; inocuo, pero conviene alinearlos al renombrar.
  Deuda cosmética, no un fallo.
