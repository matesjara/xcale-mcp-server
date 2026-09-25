# HiMed — Evidencia de Sandbox (Autoagendamiento)

> Journal de verificación (permitido en español — journal de trabajo fechado).
> Objetivo: ejecutar cada endpoint contra el sandbox real de HiMed para quitar los `⏳` del `api-contract.md`.

- **Fecha:** 2026-09-24 / 2026-09-25
- **Entorno:** Swagger interactivo de HiMed (`https://www.medsas.co/apisandbox/docs/#/`), módulo API Autoagendamiento.
- **Endpoint:** `POST https://socket.medsas.co/test/notificaciones/envioConsumoAutoagendamiento` (un solo endpoint, dispatch por `accion`).
- **Auth usada:** las credenciales **demo del propio ejemplo** (`codigo_servicio` / `token`). Confirmado: **el sandbox ejecuta sin credenciales propias** (hay "Execute", no hay "Authorize").
- **Formato:** todo el body es JSON; `token` + `codigo_servicio` van en el body.

---

## Hallazgos transversales

1. **El sandbox corre sin key propia** → se puede construir y verificar sin esperar credenciales de la clínica.
2. **Un `200` puede ser error** (Swagger: _"consulta exitosa o error de procesamiento capturado con estado 200"_) → clasificar por el **body**, no por el status.
3. **`401` está sobrecargado**: HiMed lo usa para token inválido **y** para errores de validación. → el adapter clasifica por el `mensaje` (contiene "token" → `PROVIDER_AUTH_EXPIRED`; si no → `PROVIDER_INVALID_INPUT`).
4. **Los ejemplos de HiMed traen typos** — no copiarlos a ciegas:
   - `listarTiposCitas` venía como `"accion": "listar TiposCitas"` (espacio) → 401.
   - `consultarDisponibilidad` / `CrearCita` traen las claves como `fechalnicial` / `horalnicioCita` (patrón I/l). La doc dice las canónicas: `fechaInicial` / `horaInicioCita`.

---

## Reads — verificados en vivo

### `existePaciente` → 201

Request: `{ accion:"existePaciente", idPaciente:"11111111", codigo_servicio, token }`

```json
[{ "cantidad": 1, "nombre": "Paciente de pruebas HM", "idEntidad": "13-18" }]
```

No encontrado: `{ "mensaje": "...", "cantidad": 0 }`. → curado: `{ found, nombre?, idEntidad? }`.

### `listarSedes` → 200

```json
[
  { "idSede": 1, "sede": "Cartagena, cra 71s 22", "telefono": "4421122", "celular": "3002201122" },
  { "idSede": 2, "sede": "Medellin, calle 123", "telefono": "5555555", "celular": "3001231212" }
]
```

Curado a `{ idSede, sede }` (se descartan telefono/celular).

### `listarEspecialidades` → 200

Request incluye `idSede`.

```json
[
  { "idEspecialidad": "232", "descripcion": "Medico general" },
  { "idEspecialidad": "121", "descripcion": "Alergología" }
]
```

### `listarUsuarios` (profesionales) → 200

Request incluye `idSede` + `idEspecialidad`.

```json
[
  {
    "idUsuario": "123457890",
    "usuario": "Andres Felipe Martinez Arrieta",
    "especialidad": "MEDICO GENERAL",
    "success": true
  }
]
```

`idUsuario` es el documento del profesional (se usa en los pasos siguientes). Curado sin `success`.

### `listarModalidades` → 200

```json
[
  { "idModalidad": 1, "descripcion": "Presencial" },
  { "idModalidad": 2, "descripcion": "Telemedicina interactiva" },
  { "idModalidad": 4, "descripcion": "Domiciliaria" }
]
```

### `consultarDisponibilidad` → 200

Request: `{ idUsuario, fechaInicial:"01-10-2023", fechaFinal:"none", idSede:"2", forma:"texto", … }`

```json
[
  {
    "disponibilidad": "Lunes, 18 de Diciembre - 02:00 PM",
    "fecha": "18-12-2023",
    "hora": "14:00:00",
    "duracion": "00:15:00"
  }
]
```

Fecha `DD-MM-YYYY`, hora/duración `HH:mm:ss`.

### `listarTiposCitas`

El ejemplo daba **401** por el typo `"listar TiposCitas"` (espacio). Con el `accion` correcto (`listarTiposCitas`) la forma es la de la doc: `[{ ID, nombre, recomendacion, success }]`.

---

## Writes — verificados en vivo

### `cancelarCita` → 200

Request: `{ accion:"cancelarCita", idCita:"25", codigo_servicio, token }` — **solo `idCita`** (idPaciente opcional).

```json
{
  "success": true,
  "mensaje": "La cita ha sido cancelada correctamente. Gracias por usar nuestros servicios."
}
```

Envelope de éxito de write: `{ success:true, mensaje }`.

### `CrearCita` → 401 (esperado; ejemplo inconsistente)

Request del ejemplo: `tipo:"paciente"` **con** `parentescoPideCita:"17"`.

```json
{ "estado": "error", "mensaje": "El parentesco es obligatorio" }
```

**Resuelto por la doc:** `parentescoPideCita` es requerido — **`15` = el paciente agenda para sí mismo**, `17` = desconocido. El ejemplo emparejó mal `paciente` con `17`. El adapter default-ea `15` en autoagendamiento. Clave de hora canónica: `horaInicioCita` (el ejemplo trae el typo `horalnicioCita`).
**Pendiente:** confirmar el **201** de éxito de `CrearCita` con `parentesco=15` en vivo (el editor del Swagger complica editar el body; la doc es autoritativa).

---

## Pendiente por capturar

- [ ] **201 de `CrearCita`** con `parentesco=15` (forma de éxito y `idCita`).
- [ ] **Demográficos** (`himed`): son writes en otro host (`m.medsas.co`); sus formas se verifican en su propio sandbox / con key.
- [ ] **Tope de página** (R-6) y **URLs de producción** (las libera HiMed tras validar).

## Impacto en el código (ya aplicado)

- `himed-scheduling/errors.ts`: clasificación por body (401 auth vs validación; 200-con-error).
- `himed-scheduling/tools.ts`: curación por tool; `parentescoPideCita` default 15; `cancelarCita` solo `idCita`; `forma:"texto"`.
- Fechas/horas `DD-MM-YYYY` / `HH:mm:ss`.
