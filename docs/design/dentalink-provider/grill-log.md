# Dentalink Provider — Grill Log

> Diario de la sesión de `/grill` previa al feature-design (working journal — excepción de idioma
> sancionada del repo, CLAUDE.md › Language). Registra el recorrido de decisiones, no es contrato.
> **Fecha**: 2026-09-24 · **Con**: Sara · **Resultado**: [`feature-design.md`](./feature-design.md)

---

## Contexto de arranque

Integrar Dentalink (software de gestión odontológica, HealthAtom). Docs:
<https://api.dentalink.healthatom.com/docs/> · setup:
<https://ayuda.softwaredentalink.com/es/articles/9493507-integracion-api>.

**Reconocimiento previo (leído del código, no asumido):**

- Auth de Dentalink = token estático `Authorization: Token <token>`, base URL
  `https://api.dentalink.healthatom.com/api/v1/`, HTTPS obligatorio, permisos granulares por token.
  Es un **paid add-on**; el Administrador genera el token en *Configuración API*.
- En el lenguaje de xcale eso es una **Credential Connection** (shape Static, sin refresh).
- Precedentes: Toteat/Siigo/Cloudbeds/WooCommerce ya viven como MCP providers.

---

## Preguntas y decisiones

### Q1 — ¿Native o MCP?

Bifurcación que definía el 90% del trabajo. Recomendación: MCP (molde Toteat/ADR-0045), salvo que
hiciera falta poseer/indexar o componer sobre la data.

**Decisión de Mateo:** todas las **nuevas integraciones van por MCP** (`xcale-mcp-server`), ya no
nativas en el backend; el backend se comunica por Rail A. → **Dentalink = MCP credential provider.**

> Bandera (loud, not blocking): esto supera la regla de decisión de ADR-0004 (que trata native como la
> excepción justificada). Se ofreció un `/adr`; Mateo decidió **no** levantarlo. Queda registrado en el
> feature-design (AD-1).

### Q2 — Identidad de la Connection: ¿una clínica o una sede?

Recomendación: un token = una clínica = una Connection; `id_sucursal` como parámetro, no `accountKey`.

**Confirmado por Mateo:** autenticación global — un solo token pertenece a la cuenta/organización
principal; ve todas las sedes; cada sede tiene un `id_sucursal` que se envía como parámetro. No hay
token por sede. → `accountKey` = la cuenta de la clínica.

### Q3 — Fasing: ¿v1 solo lectura, o todo de una?

Recomendación: cortar por **riesgo**, no por lectura-vs-escritura. v1 = lectura + camino de reserva
aditivo; v2 = mutaciones destructivas.

**Decisión de Mateo (PD-1):** producto exige agendar de punta a punta → v1 incluye la reserva.

- **v1**: toda la lectura (sucursales, profesionales, prestaciones, disponibilidad) + camino completo
  de reserva (buscar → crear si no existe → agendar) + mapeo de errores/conflictos.
- **v2**: cancelar y reagendar (mutar citas existentes) + historia clínica, presupuestos, cobranzas.

### Q3-bis — Escritura fail-loud (doble reserva + fichas duplicadas)

Recomendación: "return the fact instead of acting".

**Confirmado por Mateo:**

1. **Colisión**: si el slot se ocupa entre consulta y reserva, la tool atrapa el conflicto y retorna
   `{ success: false, reason: 'slot_taken', message: … }`. **Nunca** reintenta otro horario a ciegas;
   el agente re-ofrece bloques.
2. **Fichas**: `GET /pacientes?q={documento}` antes de `POST`. Si existe, se reutiliza `id_paciente`.
   Si el `POST` choca por duplicado (RUT/cédula), se captura el `id` existente y se sigue —
   idempotente.

> Ajuste del griller aceptado: la **clave de dedup/match es el documento (cédula/RUT)**, no el
> teléfono. En salud, matchear por teléfono compartido cuelga la cita en la ficha equivocada. Teléfono
> = búsqueda secundaria.
>
> Frontera provider/consumer (aclarada al mover al repo MCP): la idempotencia y el flujo
> GET-antes-de-POST son **consumer-side**; el provider solo expone `find_patient` + el código tipado
> de conflicto.

### Q4 — ¿Una audiencia o dos? (y quién puede leer PII)

Observación: el alcance mezclaba tools cara-al-paciente y cara-al-staff (lista diaria de citas,
antecedentes). Leer antecedentes es PII clínica — riesgo de fuga a un impostor por WhatsApp.

**Decisión de Mateo (PD-2/PD-3):**

- El agente de Xcale es **100% cara al paciente**.
- **Ninguna** tool de antecedentes/historial/PII en v1.
- El staff (doctor/recepción) ve contacto, cita y ficha en el **panel de Dentalink** o en el **Inbox
  de Xcale** (autenticado por rol) — **no** se construye agente de staff por WhatsApp en v1.
- Al paciente solo se le confirma lo mínimo operativo ("Quedaste agendado el martes 10:00…").

### Q5 — Prueba al conectar + permisos del token

ADR-0045 hace el `connectionProbe` obligatorio (fail-closed). Trampa Toteat: token válido sin permiso
de ruta = idéntico a token muerto. Dentalink tiene permisos granulares → nos va a pasar. No se puede
probar una escritura al conectar (ensuciaría la agenda).

**Confirmado por Mateo (recomendación aceptada):**

- **Probe = lectura barata (listar sedes).** Prueba token + alcance de lectura.
- **La escritura no se prueba al conectar**; se cubre con (a) instrucción de permisos al cliente al
  generar el token (lectura: sucursales, agenda, prestaciones, pacientes + escritura: citas,
  pacientes) y (b) error **loud** (`missing_scope`) en el primer agendamiento.
- Micro-decisión: "ver mi cita" (leer citas propias del paciente) → **v2**, junto con
  cancelar/reagendar.

---

## Hallazgos de código relevantes (verificados)

- El backend registra el credential provider **genéricamente** desde el `authDescriptor` descubierto
  (`mcp-bootstrap.ts`, ADR-0045) — no hay código por-provider en el backend.
- El materializer del MCP (`src/core/auth/authentication-materializer.ts`) para `api_key` header pone
  el secreto **crudo** (`headers[key] = secret`), sin prefijo; solo emite `Bearer`/raw/`Basic`.
  Dentalink necesita `Authorization: Token <token>` → **falta un prefijo de esquema genérico**, un
  cambio en `src/core` con ADR propio (precedente WooCommerce/`basic`). Ver feature-design AD-3 / Q-1.

---

## CONTEXT.md

No surgieron términos nuevos que agregar al glosario: todo montó sobre canónicos existentes
(MCP Provider, Credential Connection, accountKey, connectionProbe). Disciplina de glosario — sin ruido.

## Estado al cierre

- **Resuelto**: sourcing (MCP), identidad (un token = clínica), fasing (v1 reserva / v2 mutaciones),
  fail-loud + idempotencia, dedup por documento, audiencia (100% paciente, sin PII), probe de lectura +
  permisos por instrucción.
- **Abierto (verificar en vivo antes del api-contract)**: Q-1…Q-6 del feature-design — prefijo de
  auth, prestaciones-vs-servicios, agendar por profesional/especialidad, zona horaria, campos mínimos
  de paciente, señal de "sin permiso" vs "token inválido".
- **Bloqueante top**: no hay token real corrido contra la API. Conseguir uno (test/sandbox) antes de
  `/api-contract-authoring`.
