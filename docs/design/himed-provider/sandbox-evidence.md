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

## Directorio en `m.medsas.co` (provider `himed`) — verificados en vivo (2026-09-25)

Reads del Swagger, `api_key` en el body (host `m.medsas.co`, status HTTP reales).

### `consultarUsuarios.php` (Doctores) → 200

Request: `{ api_key, tipo_user?, id_especialidad?, id_usuario? }`

```json
{
  "estado": "success",
  "mensaje": "Búsqueda de usuario(s) realizada con éxito",
  "usuarios": [
    {
      "id_usuario": "12333",
      "tipo_documento": "CC",
      "tipo_user": "2",
      "rol": "Médico Especialista",
      "nombres": "Médico pruebas",
      "apellidos": "del Río",
      "celular": "...",
      "telefono_uno": "...",
      "email": "xxx@xxx.com",
      "direccion": "El Poblado",
      "fecha_nacimiento": "1992-06-09",
      "pais": "057",
      "departamento": "05",
      "municipio": "001",
      "id_especialidad": "232"
    }
  ]
}
```

Envelope `{ estado, mensaje, usuarios:[…] }`. **Mucho PHI** → curado a `{ idUsuario, nombres, apellidos, rol, idEspecialidad }`.

### `consultarSedes.php` (Sedes) → 200

Request: `{ api_key, pais?, departamento?, ciudad? }`

```json
{
  "estado": "success",
  "mensaje": "Búsqueda de sede(s) realizada con éxito.",
  "info_sede": [
    {
      "id_sede": "1",
      "sede": "Medellín",
      "codigo_prestador": "0502515201",
      "direccion": "Calle 10# 12-28 consultorio 1010",
      "telefono": "5405960",
      "celular": "3209872211",
      "email": "medellin@himed.com",
      "pais": "057",
      "departamento": "05",
      "municipio": "001"
    }
  ]
}
```

Envelope `{ estado, mensaje, info_sede:[…] }`. Curado a `{ idSede, sede, direccion, telefono, municipio }`.

## Pendiente por capturar

- [ ] **201 de `CrearCita`** con `parentesco=15` (forma de éxito y `idCita`) — el editor del Swagger complica editar el body.
- [ ] **Demográficos writes** (`crearPaciente`/`modificarPaciente`/`modificarIdTipoIdPaciente`): no ejecutados (writes). Los reads de Doctores/Sedes ya quedaron verificados arriba.
- [ ] **Tope de página** (R-6) y **URLs de producción** (las libera HiMed tras validar).

## Impacto en el código (ya aplicado)

- `himed-scheduling/errors.ts`: clasificación por body (401 auth vs validación; 200-con-error).
- `himed-scheduling/tools.ts`: curación por tool; `parentescoPideCita` default 15; `cancelarCita` solo `idCita`; `forma:"texto"`.
- Fechas/horas `DD-MM-YYYY` / `HH:mm:ss`.
