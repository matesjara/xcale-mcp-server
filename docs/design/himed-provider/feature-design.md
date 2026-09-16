# HiMed Provider — Feature Design

> **Feature**: Provider MCP de HiMed — expone las capacidades clínicas de HiMed (doctores, sedes, pacientes, citas) como tools consumibles por los agentes de xcale.
> **Priority**: P1 High
> **Owner**: Sara Sánchez (integración) · Mateo (release owner / decisiones comerciales y legales)
> **Status**: Draft
> **Target Release**: Por definir (fase 1 depende de Q2-pago; fase 2 depende de Q1-token)
> **Last Updated**: 2026-09-15

> Contexto y decisiones previas: ver [`grill-notes.md`](./grill-notes.md) (alineación de arquitectura).
> ADRs relacionados: `docs/adr/0004-provider-knowledge-vs-credential-custody.md`,
> `docs/adr/0009-canonical-provider-pattern.md`, `docs/adr/0010-credential-delivery-strategies.md`,
> `docs/adr/0016-multiple-connect-methods-per-provider.md`.

---

## 1. Problem Statement

### ¿Qué está pasando?

Las clínicas que operan sobre **HiMed** (software de historia clínica en la nube, Colombia) no tienen forma
de que un paciente agende, consulte o cancele una cita **conversando por WhatsApp** con un agente de xcale.
Hoy el agendamiento pasa por llamada, recepción o el portal de HiMed — con fricción, horario limitado y
carga manual sobre el personal.

### ¿A quién afecta?

- **Clínicas/consultorios clientes de xcale que usan HiMed** como su sistema clínico.
- **Sus pacientes**, que quieren agendar por el canal donde ya están (WhatsApp), 24/7.
- **El personal de recepción**, que hoy absorbe manualmente cada consulta de disponibilidad y agendamiento.

### ¿Costo de no hacerlo?

xcale no puede vender su propuesta de valor (agente que agenda) a clínicas que ya están casadas con HiMed;
se pierde un segmento de clientes en un vertical de salud donde ya operamos con el sibling Nevatal.

---

## 2. Goals & Success Metrics

### North Star

Un paciente de una clínica HiMed puede **agendar, consultar y cancelar** su cita por WhatsApp, con el agente
resolviendo disponibilidad y creando la cita directamente en HiMed, sin intervención humana.

### Metrics

| Type | Metric | Target | Cómo se mide |
|:--|:--|:--|:--|
| **Leading** | Clínicas HiMed conectadas | ≥ 1 piloto en el primer mes post-release | Conexiones activas en Rail A (provider `himed`) |
| **Leading** | Consultas de disponibilidad/doctores/sedes resueltas por el agente | > 90 % sin error | `tools/call` OK vs error en el MCP |
| **Lagging** | Citas agendadas por el agente vía WhatsApp | Objetivo por definir con producto | `create_appointment` exitosas |
| **Lagging** | Reducción de agendamiento manual en recepción | Objetivo por definir con producto | Comparativo con la clínica piloto |

> Métricas de negocio (lagging) son **tentativas** — las fija producto/Mateo.

---

## 3. Target Users

### Paciente de la clínica (usuario final por WhatsApp)

- **Context**: Quiere agendar/consultar/cancelar una cita desde su celular, a cualquier hora.
- **Motivation**: Resolver sin llamar ni esperar a recepción.
- **Pain Today**: Depende del horario de la clínica y de un humano disponible.
- **Expected Benefit**: Agenda en minutos, conversando.

### Clínica / consultorio (tenant de xcale, cliente de HiMed)

- **Context**: Ya lleva su operación clínica en HiMed; adopta xcale como capa de agente.
- **Motivation**: Automatizar agendamiento y descargar a recepción sin migrar de sistema.
- **Pain Today**: HiMed no habla con su canal de WhatsApp.
- **Expected Benefit**: Un agente que agenda sobre su HiMed existente.

---

## 4. User Stories

### Must Have (P0) — Fase 1

- **US-01**: Como clínica, quiero **conectar mi cuenta HiMed** a xcale pegando mi API Key, para habilitar al agente.
- **US-02**: Como agente, quiero **listar doctores y sedes** activos de la clínica, para orientar al paciente.
- **US-03**: Como agente, quiero **verificar/crear el paciente** en HiMed, porque agendar una cita exige que exista.

### Must Have (P0) — Fase 2

- **US-04**: Como agente, quiero **consultar disponibilidad** de un doctor/sede/fecha, para ofrecer horarios.
- **US-05**: Como agente, quiero **crear una cita** para un paciente existente.
- **US-06**: Como agente, quiero **consultar y cancelar** las citas de un paciente.

### Should Have (P1)

- **US-07**: Como clínica, quiero que si mi API Key deja de servir, el agente me pida **reconectar** en vez de fallar en silencio.

---

## 5. Feature Scope (MoSCoW)

### ✅ Must Have — Fase 1 (provider `himed`)

- [ ] Provider `himed` descubrible vía `server/discover` con su `authDescriptor` (`api_key`, `placement: 'body'`).
- [ ] Tools de lectura: `list_doctors`, `list_locations`.
- [ ] Tools de escritura de paciente: `create_patient` (crea o consulta existencia), `update_patient`, `change_patient_document`.
- [ ] Mapeo de errores de HiMed → `ProviderErrorCode` (401 → `PROVIDER_AUTH_EXPIRED`).
- [ ] Curación de campos (allow-list) por tool sobre datos PHI (ver Q4).
- [ ] Round-trip probado contra el sandbox de HiMed (discover → list → call + 401 forzado).

### ✅ Must Have — Fase 2 (provider `himed-scheduling`)

- [ ] Provider `himed-scheduling` para el módulo de autoagendamiento (host `socket.medsas.co`).
- [ ] Tools: `patient_exists`, `list_specialties`, `list_professionals`, `list_modalities`, `list_appointment_types`, `get_availability`, `create_appointment`, `list_patient_appointments`, `cancel_appointment`.
- [ ] Esquema de auth de citas resuelto según Q1 (token SHA-256).

### 🟡 Should Have

- [ ] Recordatorios de cita (dependen de que **no** haya webhooks → polling de `list_patient_appointments`; ver Q5).

### 🔵 Could Have

- [ ] Curación/exposición de tools adicionales de listados (modalidades, tipos de cita) si el flujo conversacional lo pide.

### ⛔ Won't Have — Explícitamente fuera de alcance

- **Módulo API Contable (Siigo/Alegra).** HiMed empuja las facturas **directo** a Siigo/Alegra, configurado dentro de HiMed Web; xcale no está en esa ruta. No se construye nada, y no dispara el gate financiero de ADR-0010.
- **Escritura de disponibilidad/agenda del profesional.** Se configura solo en HiMed Web (la API es unilateral).
- **Un único provider `himed`.** Descartado: los dos backends de HiMed usan campos y esquemas de auth distintos que no caben en un `authDescriptor` (ver AD-2 y grill §D2).

---

## 6. UX & Interaction Design

> Un provider MCP no tiene pantallas propias: su "UX" son (a) el **flujo de conexión** del tenant y
> (b) el **flujo conversacional** por WhatsApp donde el agente usa las tools. Se describe en prosa.

### 6.1 Flujo de conexión (clínica)

La clínica entra a la sección de integraciones de xcale, elige **HiMed** (descubierto del catálogo del MCP
vía `server/discover`) y **pega su API Key** (entregada por HiMed tras el pago). Rail A verifica y **guarda
la credencial cifrada**. Fase 2 agrega una segunda conexión, **HiMed Citas** (`himed-scheduling`), con sus
propias credenciales (`codigo_servicio` + token). Estado de éxito: la integración aparece "Conectada".
Estado de error: credencial inválida → mensaje claro, sin exponer la key.

### 6.2 Flujo conversacional — agendar una cita (fases 1+2)

Un paciente escribe por WhatsApp: *"Quiero cita con la doctora García en la sede norte esta semana."* El agente:

1. `list_locations` / `list_doctors` para resolver sede y doctor (fase 1).
2. `create_patient` (o `patient_exists`) para asegurar que el paciente exista (fase 1 crea; fase 2 verifica).
3. `get_availability` para ofrecer horarios (fase 2).
4. Al confirmar el paciente, `create_appointment` (fase 2).
5. El agente confirma la cita creada.

**Estado de error:** si HiMed devuelve 401/403, el agente **no falla en silencio**: recibe `PROVIDER_AUTH_EXPIRED`
y le pide a la clínica reconectar. Errores de negocio (campo inválido, paciente inexistente) → mensaje tipado.

### 6.3 Consultar / cancelar (fase 2)

*"¿Qué citas tengo?"* → `list_patient_appointments`. *"Cancela la del viernes"* → `cancel_appointment`.

### 6.4 Notificaciones & Feedback

HiMed **no tiene webhooks** (según doc; confirmar con HiMed, Q5). Cualquier recordatorio proactivo de cita
requeriría **polling** de `list_patient_appointments` — evaluar costo antes de comprometerlo (Should Have).

---

## 7. Data Model Sketch

> El provider MCP es **stateless de credencial y de datos**: no persiste nada. La única persistencia es la
> **Connection** en Rail A (xcale-backend). Los objetos de dominio se devuelven con **fidelidad** al proveedor,
> solo curando campos (allow-list).

### Entidades

#### Connection (Rail A — xcale-backend, no en este repo)

| Field | Type | Description |
|:--|:--|:--|
| `userId` | string | Tenant dueño de la conexión |
| `provider` | enum: `himed`, `himed-scheduling` | Cuál de los dos providers |
| credencial | encrypted | `api_key` (himed) / `codigo_servicio`+`token` (himed-scheduling) — cifrada en reposo |
| `status` | enum: `CONNECTED`, `AUTH_FAILURE`, … | Ciclo de vida de la conexión |

#### Objetos de dominio devueltos (curados, allow-list — ver Q4)

| Entidad | Campos expuestos (propuesta) | Campos descartados |
|:--|:--|:--|
| Doctor | id, nombre, especialidad | teléfono, email, dirección, fecha_nacimiento |
| Sede | id_sede, sede, ciudad | teléfono, celular, email |
| Paciente | id_paciente, nombre, tipo_documento | dirección, email, fecha_nacimiento completa |
| Cita | idCita, fecha, hora, estado, doctor, sede | — |

### Relaciones

```
Tenant (xcale) ──tiene──▶ Connection(himed)          ──habilita──▶ tools himed
Tenant (xcale) ──tiene──▶ Connection(himed-scheduling) ──habilita──▶ tools himed-scheduling
Cita ──referencia──▶ Paciente + Doctor + Sede
```

---

## 8. Architectural Decisions

| # | Decisión | Elección | Justificación |
|:--|:--|:--|:--|
| AD-1 | Dónde vive la integración | **Provider MCP en `xcale-mcp-server`** (opción B) | Dirección estratégica: nativas se congelan, lo nuevo va al MCP (ADR-0004). Se descarta la toolbox nativa (opción A) pese a ser más barata. Ver grill §D1. |
| AD-2 | Uno vs dos providers | **Dos**: `himed` + `himed-scheduling` | `auth` es singular por provider (ADR-0016) y los dos backends usan campos/esquemas distintos (`api_key` en body vs `token` SHA-256). No caben en un `authDescriptor`. |
| AD-3 | Auth de `himed` | `authDescriptor` `api_key`, `credentialDelivery: 'forwarded'`, `fields: [{ key: 'api_key', placement: 'body' }]` | HiMed manda la credencial dentro del body del POST. Requiere **nuevo `placement: 'body'` en el materializer** → ADR de core (ver R-1). |
| AD-4 | Auth de `himed-scheduling` | **Pendiente de Q1** | Si el token SHA-256 es estático → `token` en body + `codigo_servicio` como metadata. Si se firma por request → auth imperativa → ADR condicional. |
| AD-5 | Custodia de credenciales | **Rail A** (xcale-backend) | Conocimiento en el server, custodia en Rail A (ADR-0004). El server descarta la credencial por llamada (Credential-in-Transit-Only). |
| AD-6 | Contexto (`contextSchema`) | **No se declara** | Una conexión abarca N sedes, pero `idSede` viaja como argumento explícito de cada tool (Explicit Context, ADR-0009). |
| AD-7 | Curación de datos | **Allow-list por tool** (Fidelity over Unification) | Minimiza PHI en el contexto del LLM. Campos concretos en el api-contract. Ver Q4. |
| AD-8 | Módulo contable | **Fuera de alcance** | HiMed→Siigo directo; xcale no participa. |

---

## 9. Risks & Open Questions

### Riesgos

| # | Riesgo | Prob. | Impacto | Mitigación |
|:--|:--|:--|:--|:--|
| R-1 | El body-placement toca `src/core` (materializer) → viola el golden rule de `add-provider` | Alta | Media | ADR excepcional + cambio acotado (`placement: 'body'`) con tests. |
| R-2 | La doc de HiMed (API legacy PHP) no coincide con el comportamiento real | Media | Media | Verificar contra el sandbox antes de cerrar el api-contract (requiere key, Q2). |
| R-3 | Datos de salud (PHI) hacia un LLM sin base legal/consentimiento | Media | **Alta** | Curación allow-list + decisión legal de Mateo antes de producción (Q4-legal). |
| R-4 | Auth de citas resulta ser firma imperativa (más trabajo del previsto) | Media | Media | ADR condicional; fase 2 se rediseña según Q1. Fase 1 no depende de esto. |
| R-5 | Sin webhooks, los recordatorios exigen polling (costo) | Media | Baja | Confirmar Q5; tratar recordatorios como Should Have, no MVP. |

### Preguntas abiertas

| # | Pregunta | Necesaria para | Owner | Resolución |
|:--|:--|:--|:--|:--|
| Q-1 | ¿Cómo se genera el `token` SHA-256 de autoagendamiento? | Fase 2 (AD-4) | HiMed | Pending |
| Q-2 | ¿Quién paga el API Key y cuánto (COP)? | Construir/probar | Mateo | Pending |
| Q-4 | Curación PHI: campos por tool + base legal para enviar dato sensible a un LLM | Fase 1 (impl.) / producción (legal) | Producto + Mateo/legal | Pending — posible solución: allow-list |
| Q-5 | ¿`socket.medsas.co` es solo REST o hay canal de notificaciones/tiempo real? | Recordatorios | HiMed | Pending |

---

## 10. Phasing & Roadmap

| Fase | Alcance | Entregables | Dependencias | Esfuerzo |
|:--|:--|:--|:--|:--|
| **Fase 1** | Provider `himed` (doctores, sedes, crear/modificar paciente) | Adapter `himed` + ADR body-placement + curación allow-list + round-trip sandbox | Q2 (key) para probar; ADR de core | L |
| **Fase 2** | Provider `himed-scheduling` (citas) | Adapter `himed-scheduling` + esquema de auth resuelto | Q1 (token); fase 1 | L (XL si auth imperativa) |
| **Fase 3** | Recordatorios proactivos | Polling de citas | Q5; fases 1–2 | M |

---

## 11. Agentic Context

### Módulos relacionados

| Módulo | Relación | Archivos clave |
|:--|:--|:--|
| Providers MCP | Este feature agrega dos providers | `src/providers/himed/`, `src/providers/himed-scheduling/`, `src/providers/index.ts` |
| Core auth (materializer) | Se extiende con `placement: 'body'` (ADR) | `src/core/auth/authentication-materializer.ts` |
| Rail A (xcale-backend) | Custodia credenciales, corre connect/reconnect | consumidor, fuera de este repo |
| Referencia de patrón | Provider colombiano read-first ya probado | `src/providers/siigo/`, `docs/design/siigo-read-only-provider/` |

### Puntos de entrada en el código

- **Provider**: `src/providers/{slug}/` — `manifest.ts`, `auth.ts`, `client.ts`, `tools/`, `errors.ts`, `provider.ts`, `__fixtures__/`, `__tests__/`.
- **Registro**: una línea en `src/providers/index.ts` (regla de oro: no tocar `src/core|protocol|auth` salvo el ADR de body-placement).
- **Skill de referencia**: `add-provider`.

### Convenciones a seguir

- Tools con `defineTool` (zod = single source of truth), namespaced `mcp_himed_*` / `mcp_himed_scheduling_*`; subset curado.
- Errores: nunca interpolar el `body` del proveedor; 401/403 → `PROVIDER_AUTH_EXPIRED`; resto → error tipado sobre `mapHttpStatusToErrorCode`.
- `SecretString`: `.reveal()` solo en el egress (materializer); nunca loguear la credencial.
- Fidelity over Unification: `data` conserva la semántica del proveedor; solo se cura por allow-list.

### Próximos pasos tras aprobación

1. Cerrar Q1 (HiMed) y Q2 (Mateo); levantar Q4-legal.
2. Escribir el **ADR de body-placement** y `/api-contract-authoring` para fase 1 (campos concretos por tool → cierra Q4-curación).
3. Implementar fase 1 con el skill `add-provider` + fixtures; probar round-trip contra sandbox.
