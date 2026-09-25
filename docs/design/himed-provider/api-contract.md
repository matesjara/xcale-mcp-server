# HiMed — Tool Contract (himed + himed-scheduling)

> **Feature design**: [`feature-design.md`](./feature-design.md) · **Grill**: [`grill-notes.md`](./grill-notes.md)
> **Last updated**: 2026-09-24
>
> Cada `input` es la **zod source of truth**; el JSON Schema de `tools/list` se genera de ahí, nunca a mano.
> Todos los schemas son `.strict()` — una clave no declarada da `PROVIDER_INVALID_INPUT`.
>
> ⚠️ **Evidence-before-contract (R-2):** todas las formas de request/response aquí vienen de la **doc
> pública** de HiMed (portal + Swagger, 2026-09-24), **no de llamadas reales**. HiMed contradice a menudo su
> doc (lección SaludTools: ~10 desviaciones). **Cada forma marcada `⏳ por verificar` se confirma con UNA
> llamada al sandbox** (que corre sin credenciales) **antes de cerrar el contrato.**

---

## 0. Dos providers

HiMed expone dos backends con auth incompatible → **dos providers** (ver feature-design AD-2):

| Provider | Módulo HiMed | Host | Auth |
|:--|:--|:--|:--|
| `himed` | Demográficos (pacientes) | `m.medsas.co` | `api_key` en el body |
| `himed-scheduling` | Autoagendamiento (citas) | `socket.medsas.co` | `token` + `codigo_servicio` en el body (estáticos) |

---

## 1. Provider `himed` (Demográficos)

### 1.1 Manifest

```ts
{
  slug: 'himed',
  displayName: 'HiMed — Pacientes',
  category: 'health',
  schemaVersion: '2026-09-24',
  providerVersion: '0.1.0',
}
```

### 1.2 Auth descriptor (no-secreto, publicado en el catálogo)

```ts
{
  type: 'api_key',
  credentialDelivery: 'forwarded',
  fields: [{ key: 'api_key', label: 'API Key', placement: 'body' }],   // ⚠️ 'body' NO existe hoy → ADR de core
}
```

`placement: 'body'` requiere extender `authentication-materializer.ts` (ver feature-design R-1 y el ADR de
body-placement). Es el único toque a `src/core` de todo el provider.

### 1.3 Context schema

Ninguno. Una `api_key` identifica a la clínica; no hay scope adicional que desambiguar.

### 1.4 Base URL

| Env | Base |
|:--|:--|
| Prod | `https://m.medsas.co/interoperabilidad/Api/Controllers/Demograficos/` |
| Sandbox | ⏳ por confirmar (HiMed libera URL de prod tras validar en sandbox) |

Todas las operaciones son **POST** a un archivo `.php`.

### 1.5 Response envelope

Éxito: **HTTP 201** con `{ "estado": "success", "mensaje": "…" }`. **`estado` es la señal de éxito**, no solo
el status (patrón ya visto en Toteat/Cloudbeds — no asumir que el HTTP status basta). ⏳ por verificar.

### 1.6 Error mapping

| Código HiMed | Significado (doc) | `ProviderErrorCode` |
|:--|:--|:--|
| 401 | token inválido/vacío | `PROVIDER_AUTH_EXPIRED` |
| 406 | campo requerido inválido / documento vacío | `PROVIDER_INVALID_INPUT` |
| 417 | tipo de documento inválido / docs clínicos en pausa | `PROVIDER_INVALID_INPUT` |
| 404 | campo no editable por este endpoint | `PROVIDER_INVALID_INPUT` |
| 207 | warning de campo opcional (no bloqueante) | (éxito con warning; no error) |
| transporte / 5xx | — | `PROVIDER_UNAVAILABLE` |

Los mensajes de error llevan **status y code**, nunca interpolan el `body` (PHI) ni la request.

### 1.7 Tools

#### `mcp_himed_create_patient`  — **write**
```ts
input: z.object({
  tipoDocumento: z.string().min(1),      // catálogo tabla de referencia (descargable)
  idPaciente: z.string().min(4).max(20),
  primerNombre: z.string().min(1),
  primerApellido: z.string().min(1),
  fechaNacimiento: z.string(),           // ⏳ formato por verificar (ISO vs dd/mm/aaaa)
  // + campos opcionales del catálogo demográfico (segundo nombre/apellido, sexo, contacto…) — ⏳
}).strict()
```
`POST crearPaciente.php`. Crea el paciente **o** confirma su existencia (201 en ambos casos).
**Envelope de creación (R-5):** ⏳ verificar si el id/confirmación viene en un envelope aparte — proyectarlo
como lectura convirtió un alta exitosa en error en SaludTools, y un reintento **duplicó** el paciente.
Salida curada: `{ estado, mensaje }` — **no** eco de PHI de entrada.

#### `mcp_himed_update_patient`  — **write**
```ts
input: z.object({
  tipoDocumento: z.string().min(1),      // identifica, no se modifica
  idPaciente: z.string().min(4).max(20), // identifica, no se modifica
  // + los campos a modificar (allow-list del catálogo) — ⏳
}).strict()
```
`POST modificarPaciente.php`. 201 actualizado · 400 error de campo · 417 docs en pausa.

#### `mcp_himed_change_patient_document`  — **write**
```ts
input: z.object({
  tipoIdActual: z.string().min(1),
  idPacienteActual: z.string().min(1),
  tipoIdNuevo: z.string().min(1),
  idPacienteNuevo: z.string().min(1),
  motivoCambio: z.string().min(1),
}).strict()
```
`POST modificarIdTipoIdPaciente.php`. Cambia tipo/número de documento.

> **Nota:** no hay tool de lectura de paciente aquí — la existencia se consulta desde `himed-scheduling`
> (`patient_exists`). Demográficos solo escribe.

---

## 2. Provider `himed-scheduling` (Autoagendamiento)

### 2.1 Manifest

```ts
{
  slug: 'himed-scheduling',
  displayName: 'HiMed — Citas',
  category: 'health',
  schemaVersion: '2026-09-24',
  providerVersion: '0.1.0',
  capabilities: { webhooks: false },     // modelo pull; recordatorios por polling
}
```

### 2.2 Auth descriptor + el problema de las dos credenciales

Autoagendamiento exige **dos** valores en el body, ambos estáticos y emitidos por HiMed:
`codigo_servicio` y `token`.

```ts
// propuesta
authDescriptor: { type: 'api_key', credentialDelivery: 'forwarded',
                  fields: [{ key: 'token', label: 'Token', placement: 'body' }] }
metadataSchema: z.object({ codigo_servicio: z.string().min(1) }).strict()   // vía X-Provider-Metadata
```

El handler pone `codigo_servicio` (de `ctx.metadata`) en el body; el materializer pone `token` (el secreto)
en el body.

> ✅ **Resuelto por la doc (2026-09-24), confirmar en activación.** La doc distingue: `token` = **"Código de
> seguridad"** (el secreto) y `codigo_servicio` = **"Código"** (sin "de seguridad" → identificador del
> servicio); además `codigo_servicio` **por sí solo no da acceso** (se necesita el `token`). Por eso el diseño
> de arriba es correcto: `codigo_servicio` como metadata (identificador, como `xir` de Toteat), `token` como el
> único secreto. **No** se reabre la vía multi-material ni hace falta ADR extra. Queda una confirmación barata
> en la activación (si HiMed dijera que `codigo_servicio` también es secreto, ahí sí habría que rediseñar).

### 2.3 Context schema

Ninguno. Una conexión abarca N sedes; `idSede` viaja como **argumento explícito** de cada tool (Explicit
Context, ADR-0009). Igual que SaludTools.

### 2.4 Base URL

| Env | Base |
|:--|:--|
| Sandbox | `https://socket.medsas.co:443/test/notificaciones/envioConsumoAutoagendamiento` |
| Prod | ⏳ HiMed libera la URL de prod tras validar en sandbox (probablemente sin `/test/`) |

**Un solo endpoint**; el campo `accion` decide la operación. El `client.ts` mapea cada tool a su `accion`.

### 2.5 Response envelope — **verificado en sandbox (2026-09-24)**

El Swagger declara tres códigos y su semántica: **`201`** = registro exitoso / paciente existe · **`401`** =
error de validación o autenticación · **`200`** = *"consulta exitosa **o error de procesamiento capturado con
estado 200"***. ⚠️ **Un `200` puede ser un error** → el adapter **debe inspeccionar el body**, nunca solo el
status HTTP (mismo patrón que Toteat/Cloudbeds). Listados: array JSON al tope — verificado en vivo con
`listarSedes` → `[{ idSede:number, sede, telefono, celular }]`. "No encontrado" (existePaciente):
`{ mensaje, cantidad: 0 }`.

### 2.6 Error mapping

Mensajes de token observados en doc: *"El token ingresado no es correcto"*, *"Se envía un token no
conocido"*, *"El token está vacío"*, *"No se envía el token en el JSON"* → `PROVIDER_AUTH_EXPIRED`.
Resto de errores de negocio → `PROVIDER_INVALID_INPUT` / `PROVIDER_ERROR`. ⏳ mapear el resto con el sandbox.

### 2.7 Tools

Todos incluyen `codigo_servicio` + `token` (inyectados; **no** van en el `input` que ve el modelo).

#### `mcp_himed_scheduling_patient_exists` — read
```ts
input: z.object({ idPaciente: z.string().min(4).max(20) }).strict()   // accion: "existePaciente"
```
201 `[{ cantidad, nombre, idEntidad }]` · no encontrado `{ mensaje, cantidad: 0 }`.
Curado: `{ found: boolean, nombre?, idEntidad? }` — `nombre` se expone para confirmar identidad con el paciente (PHI mínimo).

#### `mcp_himed_scheduling_list_locations` — read
```ts
input: z.object({}).strict()   // accion: "listarSedes"
```
`[{ idSede, sede, telefono, celular }]`. Curado: `{ idSede, sede }` (drop telefono/celular salvo que el flujo lo pida).

#### `mcp_himed_scheduling_list_specialties` — read
```ts
input: z.object({ idSede: z.number().int() }).strict()   // accion: "listarEspecialidades"
```
`[{ idEspecialidad, descripcion }]`.

#### `mcp_himed_scheduling_list_professionals` — read
```ts
input: z.object({ idSede: z.number().int(), idEspecialidad: z.string().min(1) }).strict()   // "listarUsuarios"
```
`[{ idUsuario, usuario, especialidad, success }]`. `idUsuario` = documento del profesional (se usa en los pasos siguientes).

#### `mcp_himed_scheduling_list_modalities` — read
```ts
input: z.object({ idUsuario: z.string().min(1), idSede: z.union([z.string(), z.number()]) }).strict()   // "listarModalidades"
```
`[{ idModalidad, descripcion }]` (1 Presencial · 2 Telemedicina · 4 Domiciliaria).

#### `mcp_himed_scheduling_list_appointment_types` — read
```ts
input: z.object({ idUsuario: z.string().min(1) }).strict()   // "listarTiposCitas"
```
`[{ ID, nombre, recomendacion, success }]`.

#### `mcp_himed_scheduling_get_availability` — read
```ts
input: z.object({
  idUsuario: z.string().min(1),
  idSede: z.union([z.string(), z.number()]),
  fechaInicial: z.string(),          // DD-MM-YYYY — verificado en sandbox ("01-10-2023")
  fechaFinal: z.string().optional(), // DD-MM-YYYY o "none"
  forma: z.enum(['texto']),          // el sandbox usa "texto"
}).strict()   // "consultarDisponibilidad"
```
**Verificado en sandbox (request), 2026-09-24.** ⚠️ La clave del ejemplo aparece como `fechalnicial` (patrón
I/l) — usar exactamente la que acepte el server. ⏳ Falta capturar la **forma de la respuesta** (no ejecuté este read).

#### `mcp_himed_scheduling_create_appointment` — **write**
```ts
input: z.object({
  idPaciente: z.string().min(4).max(20),
  idSede: z.union([z.string(), z.number()]),
  idUsuario: z.string().min(1),
  fechaCita: z.string(),                 // DD-MM-YYYY (verif: "12-12-2023")
  horaInicioCita: z.string(),            // HH:mm:ss (verif: "08:00:00"; clave ejemplo "horalnicioCita")
  modalidadAtencion: z.string(),         // "1" (catálogo modalidad)
  idTipoCita: z.string(),                // "3" (catálogo tipo de cita)
  tipo: z.enum(['paciente']),            // quién pide (paciente / tercero)
  observaciones: z.string().optional(),
  nombrePideCita: z.string().optional(),     // si un tercero agenda por el paciente
  apellidoPideCita: z.string().optional(),
  parentescoPideCita: z.string().optional(), // catálogo de parentesco ("17")
  // strModulo lo fija el adapter ("himed") — no lo ve el modelo
}).strict()   // "CrearCita"
```
**Request verificado en sandbox (ejemplo), 2026-09-24.** Campos nuevos vs. la doc: `observaciones`,
`nombre/apellido/parentescoPideCita`, `idTipoCita` (distinto de `tipo`). ⏳ forma de la **respuesta**
(éxito con `idCita` / error) por capturar. **Precondición:** el paciente debe existir (`patient_exists` / `create_patient`).

#### `mcp_himed_scheduling_list_patient_appointments` — read
```ts
input: z.object({ idPaciente: z.string().min(4).max(20), forma: z.string() }).strict()   // "citasPaciente"
```
`[{ idCita, textoCita }]` o forma detallada según `forma`. ⏳ verificar. **Primitiva de recordatorios** (polling).

#### `mcp_himed_scheduling_cancel_appointment` — **write**
```ts
input: z.object({ idCita: z.string().min(1), idPaciente: z.string().min(4).max(20) }).strict()   // "cancelarCita"
```
Éxito/error con mensaje.

---

## 3. Curación PHI (allow-list) — resumen

`data` conserva la semántica de HiMed pero **proyectada** por tool (Fidelity over Unification, ADR-0009).
La lista definitiva de campos depende de la decisión legal (#1055). Allow-list: un campo sensible nuevo de
HiMed **no se filtra por defecto**. Sin `direccion`, `email`, `fecha_nacimiento` completa ni teléfonos salvo
que un job concreto lo exija.

## 4. Tools destructivas

Ninguna se publica en `tools/list` (feature-design AD-9): la key puede ser **admin** y el catálogo es lo
único que impide que el agente borre/altere de más. Solo se exponen las 13 de arriba.

## 5. Estado de verificación (R-2)

| Área | Estado |
|:--|:--|
| **El sandbox ejecuta sin credenciales propias** | ✅ **verificado** (Swagger "Execute" sin "Authorize"; `listarSedes` devolvió 200 real con las creds demo del ejemplo) |
| `consultarDisponibilidad` / `CrearCita` (request) | ✅ **capturados del sandbox** (ver §2.7) — antes truncados |
| Formatos de fecha/hora | ✅ `DD-MM-YYYY` y `HH:mm:ss` |
| Envelope: **200 puede ser error** | ✅ verificado (Swagger); inspeccionar body, no status |
| Respuesta de `listarSedes` | ✅ verificada en vivo |
| Respuestas de `consultarDisponibilidad` / `CrearCita` | ⏳ por capturar (no ejecuté disponibilidad ni la escritura) |
| Claves `fechalnicial` / `horalnicioCita` (patrón I/l) | ⏳ usar exactamente la que acepte el server (ejecutar) |
| Envelope de creación (R-5) y "no encontrado" (200 vacío) | ⏳ verificar al ejecutar la escritura |
| Tope de página (R-6) | ⏳ verificar |
| ¿`codigo_servicio` secreto? (§2.2) | ✅ resuelto por doc (identificador, no secreto); confirmar en activación |
| URLs de producción | ⏳ las libera HiMed tras el sandbox |

## 6. Fixtures & tests

`__fixtures__/` con respuestas reales anonimizadas por tool. La suite cubre: envelope (éxito por `estado`,
no por status); mapeo de errores (token→`PROVIDER_AUTH_EXPIRED`); redacción de credenciales en `core` (token
nunca en logs/errores/URL); no-duplicación en `create_patient` (envelope); y que ninguna tool destructiva
aparezca en `tools/list`.
