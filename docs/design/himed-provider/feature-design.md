# HiMed Provider — Feature Design

> **Feature**: Provider MCP de HiMed — expone las capacidades clínicas de HiMed (pacientes y citas) como tools consumibles por los agentes de xcale.
> **Priority**: P1 High
> **Owner**: Sara Estrada (integración) · Mateo (release owner / decisiones comerciales y legales)
> **Status**: Draft
> **Target Release**: Por definir. Provider (mcp-server) puede arrancar ya (sandbox sin key); backend gated a que `feat/saludtools-connect` mergee a `dev` y a la decisión de Ley 1581 (#1055).
> **Cliente piloto**: Clínica Senzzes IPS (Senzzes S.A.S.), NIT 900.991.925-3.
> **Last Updated**: 2026-09-24

> Contexto y decisiones: ver [`grill-notes.md`](./grill-notes.md). Épica de backend: `matesjara/xcale-backend#1053`.
> Ley 1581 (compartida con SaludTools y #1039): `matesjara/xcale-backend#1055`.
> ADRs: `0004-provider-knowledge-vs-credential-custody`, `0009-canonical-provider-pattern`,
> `0010-credential-delivery-strategies`, `0016-multiple-connect-methods-per-provider`.

---

## 1. Problem Statement

### ¿Qué está pasando?

Las clínicas que operan sobre **HiMed** (historia clínica en la nube, Colombia) no tienen forma de que un
paciente agende, consulte o cancele una cita **por WhatsApp** con un agente de xcale. Hoy el agendamiento pasa
por llamada, recepción o el portal de HiMed — con fricción, horario limitado y carga manual sobre el personal.

### ¿A quién afecta?

- **Clínicas clientes de xcale que usan HiMed** como su sistema clínico (la piloto es Clínica Senzzes IPS).
- **Sus pacientes**, que quieren agendar por el canal donde ya están (WhatsApp), 24/7.
- **Recepción**, que hoy absorbe manualmente cada consulta de disponibilidad y agendamiento.

### ¿Costo de no hacerlo?

xcale no puede vender su propuesta (agente que agenda) a clínicas casadas con HiMed; se pierde un segmento en
un vertical de salud donde ya operamos con el sibling Nevatal y estamos entrando con SaludTools.

---

## 2. Goals & Success Metrics

### North Star

Un paciente de una clínica HiMed **agenda, consulta y cancela** su cita por WhatsApp; el agente resuelve
disponibilidad y crea la cita directamente en HiMed, sin intervención humana.

### Metrics

| Type | Metric | Target | Cómo se mide |
|:--|:--|:--|:--|
| **Leading** | Clínicas HiMed conectadas | ≥ 1 piloto (Senzzes) post-release | Conexiones activas en Rail A |
| **Leading** | Consultas (sedes/profesionales/disponibilidad) resueltas por el agente | > 90 % sin error | `tools/call` OK vs error |
| **Lagging** | Citas agendadas por el agente vía WhatsApp | Por definir con producto | `create_appointment` exitosas |
| **Lagging** | Reducción de agendamiento manual en recepción | Por definir con producto | Comparativo con la piloto |

> Las métricas lagging son **tentativas** — las fija producto/Mateo.

---

## 3. Target Users

### Paciente de la clínica (usuario final por WhatsApp)

- **Context**: Quiere agendar/consultar/cancelar desde su celular, a cualquier hora.
- **Motivation**: Resolver sin llamar ni esperar a recepción.
- **Pain Today**: Depende del horario de la clínica y de un humano disponible.
- **Expected Benefit**: Agenda en minutos, conversando.

### Clínica / consultorio (tenant de xcale, cliente de HiMed)

- **Context**: Ya lleva su operación clínica en HiMed; adopta xcale como capa de agente.
- **Motivation**: Automatizar agendamiento sin migrar de sistema.
- **Pain Today**: HiMed no habla con su canal de WhatsApp.
- **Expected Benefit**: Un agente que agenda sobre su HiMed existente.

---

## 4. User Stories

### Must Have (P0)

- **US-01**: Como clínica, quiero **conectar mi cuenta HiMed** a xcale con mis credenciales, para habilitar al agente.
- **US-02**: Como agente, quiero **verificar/crear el paciente** en HiMed, porque agendar exige que exista.
- **US-03**: Como agente, quiero **listar sedes, especialidades y profesionales** de la clínica, para orientar al paciente.
- **US-04**: Como agente, quiero **consultar disponibilidad** de un profesional/sede/fecha, para ofrecer horarios.
- **US-05**: Como agente, quiero **crear una cita** para un paciente existente.
- **US-06**: Como agente, quiero **consultar y cancelar** las citas de un paciente.

### Should Have (P1)

- **US-07**: Como clínica, quiero que si mi credencial deja de servir, el agente me pida **reconectar** en vez de fallar en silencio.

---

## 5. Feature Scope (MoSCoW)

> **Alcance afinado (2026-09-24):** solo **Autoagendamiento + Demográficos**. Los módulos standalone
> **Doctores** y **Sedes** quedan **fuera** — Autoagendamiento ya expone `listarSedes` y `listarUsuarios`
> (profesionales, con `idUsuario` = documento del médico), así que son redundantes para el flujo de agendamiento.

### ✅ Must Have — Provider `himed` (Demográficos, `api_key` en body)

- [ ] Provider `himed` descubrible vía `server/discover` con `authDescriptor` `api_key`, `placement: 'body'`.
- [ ] Tools de paciente: `create_patient` (crea o consulta existencia), `update_patient`, `change_patient_document`.
- [ ] Manejo del **create-envelope** (el id puede venir en envelope, no en el body → no tratarlo como lectura, o un reintento duplica el paciente).

### ✅ Must Have — Provider `himed-scheduling` (Autoagendamiento, `token`+`codigo_servicio` en body)

- [ ] Provider `himed-scheduling` (host `socket.medsas.co`, endpoint único por `accion`).
- [ ] Tools: `patient_exists`, `list_locations`, `list_specialties`, `list_professionals`, `list_modalities`, `list_appointment_types`, `get_availability`, `create_appointment`, `list_patient_appointments`, `cancel_appointment`.

### ✅ Must Have — transversal

- [ ] Mapeo de errores HiMed → `ProviderErrorCode` (401 → `PROVIDER_AUTH_EXPIRED`; 406/417/404/207 → error tipado).
- [ ] Curación de campos (allow-list) por tool sobre PHI (ver Q4/#1055).
- [ ] **No publicar tools destructivas** en `tools/list` (la key puede ser admin — ver AD-9).
- [ ] Round-trip probado contra el sandbox (una llamada real por forma; el sandbox corre **sin credenciales**).

### 🟡 Should Have

- [ ] Recordatorios de cita → **polling** de `list_patient_appointments` (no hay webhooks; ver Q5/§AD-8). Evaluar costo.

### ⛔ Won't Have — Explícitamente fuera de alcance

- **Módulos standalone Doctores y Sedes** — redundantes con Autoagendamiento (ver §5 nota).
- **Módulo API Contable (Siigo/Alegra)** — HiMed empuja las facturas **directo** a Siigo/Alegra dentro de HiMed Web; xcale no está en esa ruta. No dispara el gate financiero de ADR-0010.
- **Escritura de disponibilidad/agenda del profesional** — se configura solo en HiMed Web (la API es unilateral).
- **Un único provider `himed`** — descartado: los dos backends usan campos/esquemas de auth distintos (ver AD-2).

---

## 6. UX & Interaction Design

> Un provider MCP no tiene pantallas: su "UX" son (a) el **flujo de conexión** del tenant y (b) el **flujo
> conversacional** por WhatsApp donde el agente usa las tools.

### 6.1 Flujo de conexión (clínica)

La clínica elige **HiMed** en integraciones de xcale (descubierto del catálogo del MCP) y aporta sus
credenciales: el `api_key` de Demográficos y el `codigo_servicio`+`token` de Autoagendamiento (ambos emitidos
por HiMed). Rail A **verifica y guarda cifrado**. Éxito: "Conectada". Error: credencial inválida → mensaje
claro, sin exponer la credencial.

### 6.2 Flujo conversacional — agendar una cita

Paciente: *"Quiero cita con la doctora García en la sede norte esta semana."* El agente:

1. `patient_exists` para validar el paciente; si no existe, `create_patient` (Demográficos).
2. `list_locations` → `list_specialties` → `list_professionals` para resolver sede/especialidad/profesional.
3. `get_availability` para ofrecer horarios.
4. `create_appointment` al confirmar.
5. El agente confirma la cita creada.

**Error:** un 401/403 de HiMed → `PROVIDER_AUTH_EXPIRED` → el agente pide reconectar (no falla en silencio).
Errores de negocio (campo inválido, paciente inexistente) → mensaje tipado.

### 6.3 Consultar / cancelar

*"¿Qué citas tengo?"* → `list_patient_appointments`. *"Cancela la del viernes"* → `cancel_appointment`.

### 6.4 Notificaciones & Feedback

HiMed **no tiene webhooks** (modelo pull, confirmado por doc). Recordatorios proactivos ⇒ **polling** de
`list_patient_appointments` (Should Have; evaluar costo).

---

## 7. Data Model Sketch

> El provider MCP es **stateless** de credencial y de datos: no persiste nada. La única persistencia es la
> **Connection** en Rail A. Los objetos se devuelven con **fidelidad** al proveedor, curando campos (allow-list).

### Connection (Rail A — xcale-backend, no en este repo)

| Field | Type | Description |
|:--|:--|:--|
| `userId` | string | Tenant dueño de la conexión |
| `provider` | enum: `himed`, `himed-scheduling` | Cuál de los dos providers |
| credencial | encrypted | `api_key` (himed) · `codigo_servicio`+`token` (himed-scheduling) — cifrada en reposo |
| `status` | enum: `CONNECTED`, `AUTH_FAILURE`, … | Ciclo de vida |

### Objetos devueltos (curados, allow-list — ver Q4/#1055)

| Entidad | Campos expuestos (propuesta) | Descartados |
|:--|:--|:--|
| Sede | idSede, sede, ciudad | teléfono, celular |
| Profesional | idUsuario, nombre, especialidad | — |
| Paciente | idPaciente, nombre, idEntidad | dirección, email, fecha_nacimiento completa |
| Cita | idCita, fecha, hora, estado | — |

---

## 8. Architectural Decisions

| # | Decisión | Elección | Justificación |
|:--|:--|:--|:--|
| AD-1 | Dónde vive | **Provider MCP en `xcale-mcp-server`** (opción B) | Dirección estratégica: nativas se congelan, lo nuevo va al MCP (ADR-0004). Opción A (toolbox nativa) descartada pese a ser más barata. |
| AD-2 | Uno vs dos providers | **Dos**: `himed` (Demográficos) + `himed-scheduling` (Autoagendamiento) | `auth` es singular por provider (ADR-0016) y los dos backends usan campos/esquemas distintos. |
| AD-3 | Auth de `himed` | `api_key`, `forwarded`, `fields: [{ key: 'api_key', placement: 'body' }]` | Demográficos manda la credencial en el body → requiere **`placement: 'body'` en el materializer** → ADR de core (R-1). |
| AD-4 | Auth de `himed-scheduling` | **`token` (secreto en body) + `codigo_servicio` (metadata)** — ambos estáticos | Q1 resuelta: HiMed **genera** ambos (no se calculan por request) → **no hay auth imperativa, no hay ADR condicional**. Pendiente confirmar que `codigo_servicio` es seguro como metadata no-secreta. |
| AD-5 | Custodia de credenciales | **Rail A** (xcale-backend) | Conocimiento en el server, custodia en Rail A (ADR-0004); el server descarta la credencial por llamada. |
| AD-6 | Contexto (`contextSchema`) | **No se declara** | Una conexión abarca N sedes; `idSede` viaja como argumento explícito (Explicit Context, ADR-0009). Igual que SaludTools. |
| AD-7 | Curación de datos | **Allow-list por tool** (Fidelity over Unification) | Minimiza PHI en el contexto del LLM. Campos concretos en el api-contract. |
| AD-8 | Notificaciones | **Polling** (no webhooks) | Modelo unilateral/pull de HiMed. |
| AD-9 | Tools destructivas | **No exponerlas en `tools/list`** | La key de HiMed puede ser **admin** (aprendizaje SaludTools): lo único que evita que el agente borre una historia clínica es que el catálogo no publique la tool destructiva. |

---

## 9. Risks & Open Questions

### Riesgos

| # | Riesgo | Prob. | Impacto | Mitigación |
|:--|:--|:--|:--|:--|
| R-1 | El body-placement toca `src/core` (materializer) → viola el golden rule | Alta | Media | ADR excepcional + cambio acotado (`placement: 'body'`) con tests. |
| R-2 | La doc de HiMed (legacy PHP) no coincide con producción | **Alta** | Media | **No confiar en el portal** (SaludTools tenía ~10 contradicciones). Una llamada real por forma, temprano — el sandbox corre sin key. |
| R-3 | PHI hacia un LLM sin base legal/consentimiento | Media | **Alta** | Allow-list + **decisión Ley 1581 (#1055)** de Mateo antes de producción (Senzzes arranca en noviembre). |
| R-4 | La key es **admin** (todo-poderosa) → el agente podría borrar una historia clínica | Media | **Alta** | AD-9: no publicar tools destructivas; confirmar el scope de la key con HiMed. |
| R-5 | `create_patient` devuelve el id en envelope → tratarlo como lectura duplica el paciente | Media | Media | Manejar el envelope explícitamente; test de no-duplicación. |
| R-6 | Tope de página no documentado (SaludTools rechazaba > 20; el gateway default 25) | Media | Baja | Confirmar el ceiling de HiMed temprano y clamplear. |

### Preguntas abiertas

| # | Pregunta | Owner | Estado |
|:--|:--|:--|:--|
| Q-1 | ¿Cómo se genera el `token` SHA-256? | HiMed | ✅ **Resuelta** (doc): estático, lo genera HiMed → sin auth imperativa. Confirmar en activación. |
| Q-2 | ¿Quién paga el API Key? | Mateo | ✅ **Resuelta**: paga la clínica cliente; xcale es solo integrador. |
| Q-3 | ¿Fase 1 incluye crear paciente? | Producto | ✅ **Resuelta**: sí. |
| Q-4 | Ley 1581 / consentimiento PHI a un LLM | Mateo / legal | ↪️ **Backend #1055** (gatea 3 integraciones; antes de noviembre). |
| Q-5 | ¿Webhooks? | HiMed | ✅ **Resuelta**: no → polling. |
| Q-7 | ¿Qué módulos habilita HiMed para Senzzes (solo Autoagendamiento, o también Demográficos)? | HiMed | ⏳ Pendiente (en el correo de credenciales). |

---

## 10. Phasing & Roadmap

> Reencuadrado por **tracks/repos**, no por provider. El track provider avanza ya; el backend está gated.

| Fase | Track (repo) | Alcance | Dependencias | Esfuerzo |
|:--|:--|:--|:--|:--|
| **Fase 1** | Provider (`xcale-mcp-server`) | Adapters `himed` + `himed-scheduling` + ADR body-placement + curación + verificación en sandbox | Sandbox sin key → **puede arrancar ya** | L |
| **Fase 2** | Backend (`xcale-backend`) | Registrar scope `(health, himed)` + conexiones Rail A + curación PHI + wiring del agente | **Gated:** merge de `feat/saludtools-connect` a `dev`; decisión #1055 | L |
| **Fase 3** | Backend | Recordatorios proactivos (polling) | Fases 1–2 | M |

---

## 11. Agentic Context

### Módulos y trabajo relacionado

| Qué | Relación | Dónde |
|:--|:--|:--|
| Providers MCP | Este feature agrega dos | `src/providers/himed/`, `src/providers/himed-scheduling/`, `src/providers/index.ts` |
| Core auth (materializer) | Se extiende con `placement: 'body'` (ADR) | `src/core/auth/authentication-materializer.ts` |
| Épica backend | Integración de salud HiMed | `matesjara/xcale-backend#1053` |
| Ley 1581 (compartida) | Consentimiento PHI | `matesjara/xcale-backend#1055` |
| Vertical `health` | Se reusa; HiMed se registra como par `(health, himed)` | `feat/saludtools-connect` → `register-vertical-scopes.ts` (⚠️ sin registrar, el provider queda inerte) |
| Provider hermano | Mismo patrón, un paso adelante | `docs/design/saludtools-provider/`, backend `feat/saludtools-connect` |
| Rail A | Custodia credenciales, connect/reconnect | consumidor, fuera de este repo |

### Convenciones

- Tools con `defineTool` (zod = single source of truth), namespaced `mcp_himed_*` / `mcp_himed_scheduling_*`; subset curado, **sin tools destructivas**.
- Errores: nunca interpolar el `body`; 401/403 → `PROVIDER_AUTH_EXPIRED`; resto → tipado sobre `mapHttpStatusToErrorCode`.
- `SecretString`: `.reveal()` solo en el egress (materializer); nunca loguear la credencial.
- Fidelity over Unification: `data` conserva la semántica del proveedor; solo se cura por allow-list.

### Próximos pasos

1. **Provider (ya):** `/api-contract-authoring` de fase 1 (campos por tool → cierra la curación) + ADR body-placement + scaffold `add-provider` + verificación en sandbox.
2. **Backend (gated):** tras merge de saludtools, ramificar desde `dev`, registrar `(health, himed)`, Rail A, PHI.
3. **Comercial/legal:** credenciales de Senzzes (correo a HiMed) + decisión Ley 1581 (#1055) antes de noviembre.
