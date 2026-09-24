# Dentalink Provider (v1) — API Contract

> **Companion of**: [feature-design.md](feature-design.md) · [grill-log.md](grill-log.md)
> **Module**: `dentalink` provider (xcale-mcp-server) + Rail A connect (xcale-backend, generic)
> **Status**: Draft — **pending live verification** (no token run yet)
> **Last Updated**: 2026-09-24

---

> ### ⚠️ Evidence status (binding)
> **Nothing below has been observed against the real Dentalink API — no token has been run yet.** The
> endpoints, paths, filter syntax and date formats are **doc-derived** (vendor docs +
> `/grill`); the error shapes, the required create-fields, the timezone, and the `accountKey` identity
> are **unknown**. Every unverified value is marked `⏳` and must be confirmed against a real/test clinic
> before the implementation is frozen — see §8. Toteat taught us the pinned spec can be wrong (its `400`
> did not exist); we assume nothing about Dentalink's error behavior until we see it. This contract is a
> **verification plan with a shape**, not a frozen surface.

**Vendor docs**: <https://api.dentalink.healthatom.com/docs/> · base URL
`https://api.dentalink.healthatom.com/api/v1/` (HTTPS mandatory).

---

## 1. Provider Contract (MCP)

### 1.1 Identity and auth (`server/discover`)

```ts
// src/providers/dentalink/auth.ts
export const dentalinkAuth: ProviderAuthDescriptor = {
  type: 'api_key',
  credentialDelivery: 'forwarded',
  fields: [
    // NEW: optional `scheme` prefix on api_key header placement — ADR api-key-header-scheme-prefix.
    // Emits `Authorization: Token <token>` (see §3).
    { key: 'Authorization', label: 'API Token', placement: 'header', scheme: 'Token' },
  ],
};
```

```ts
// src/providers/dentalink/manifest.ts (shape)
{
  slug: 'dentalink',
  displayName: 'Dentalink',
  category: 'healthcare',
  schemaVersion: 1,
  providerVersion: 1,
  // No connect-time context: one token = the whole clinic; id_sucursal is a per-call tool argument,
  // NOT connection context. So there is no metadataSchema in v1.
  connectionProbe: { tool: 'mcp_dentalink_list_branches' }, // cheap read; ADR-0045 fail-closed connect
}
```

- **Credential**: a single `SecretString` = the API token, `forwarded` per call. The core materializer
  emits `Authorization: Token <token>` (the scheme-prefix change, §3).
- **Context**: none at connect. `id_sucursal` and other selectors travel as **tool arguments** per call.
- **`accountKey`**: single account per token ⇒ defaults to the slug (`dentalink`). ⏳ If a tenant must
  connect **two separate clinics**, derive a stable clinic id from the probe response instead — pending
  verification that `GET /sucursales` (or the token) exposes one.

### 1.2 Tools (v1 — read + additive reserve)

Namespaced `mcp_dentalink_{verb}`. The zod `input` is the single source of truth (JSON Schema is
generated). No tool takes the credential as an argument.

| Tool | Dentalink endpoint | Input (zod) | Notes |
|:--|:--|:--|:--|
| `mcp_dentalink_list_branches` | `GET /sucursales` | `{}` | active branches; **also the `connectionProbe`** |
| `mcp_dentalink_list_specialties` | `GET /especialidades` | `{}` | specialties |
| `mcp_dentalink_list_professionals` | `GET /dentistas` | `{ idSucursal?, idEspecialidad? }` | dentists; scoped via `q` (`id_sucursal`/`id_especialidad` — ⏳ confirm these columns are filterable) |
| `mcp_dentalink_list_treatments` | `GET /prestaciones` | `{}` | billing catalog (prestaciones) |
| `mcp_dentalink_list_services` | `GET /motivosAtencionEspecialidad` (all) **or** `GET /especialidades/{id}/motivos` (per specialty) | `{ idEspecialidad? }` | appointment reasons (what the patient picks); distinct from `prestaciones`. Both endpoints are doc-derived — ⏳ verify live |
| `mcp_dentalink_list_available_slots` | `GET /agendas` | `{ idSucursal, duracion, fecha?, idDentista? }` | free time-blocks; `idDentista` omitted ⇒ online-enabled dentists |
| `mcp_dentalink_find_patient` | `GET /pacientes?q=…` | `{ documento }` | lookup by document (builds the `q` filter, §1.3) |
| `mcp_dentalink_create_patient` | `POST /pacientes` | `{ …required ⏳ }` | basic record |
| `mcp_dentalink_create_appointment` | `POST /citas` | `{ …required ⏳ }` | book |

> **Consumer boundary (not adapter concerns):** the search-before-create flow, patient dedup by
> document, and never-retry-on-conflict are **consumer** decisions (feature-design §5). The adapter only
> exposes `find_patient` + `create_patient` + `create_appointment` and the typed conflict code.

> **Flow dependency (⏳):** booking needs a `duracion` (minutes). Confirm whether the reason
> (`motivosAtencionEspecialidad`) or the treatment (`prestaciones`) carries a default duration the agent
> reads before `list_available_slots` — otherwise the consumer must supply it.

### 1.3 Inputs (zod, shape)

```ts
// src/providers/dentalink/tools.ts (inputs) — all .strict()
const listBranchesInput      = z.object({}).strict();
const listSpecialtiesInput   = z.object({}).strict();
const listProfessionalsInput = z.object({
  idSucursal: z.string().optional(),
  idEspecialidad: z.string().optional(),
}).strict();
const listTreatmentsInput    = z.object({}).strict();
const listServicesInput      = z.object({ idEspecialidad: z.string().optional() }).strict();
const listAvailableSlotsInput = z.object({
  idSucursal: z.string().min(1),
  duracion: z.number().int().positive(),          // minutes (required by GET /agendas)
  fecha: z.string().optional(),                   // 'YYYY-MM-DD'; defaults to today
  idDentista: z.string().optional(),              // omit ⇒ online-enabled dentists
}).strict();
const findPatientInput = z.object({
  documento: z.string().min(1),                   // cédula/RUT — the dedup key (feature-design AD-6)
}).strict();
// ⏳ required fields unverified — confirm against POST /pacientes before freezing
const createPatientInput = z.object({
  nombre: z.string().min(1),
  apellidos: z.string().min(1),                   // ⏳
  documento: z.string().min(1),                   // ⏳ field name (rut?) + whether a tipo_documento is required
  celular: z.string().optional(),
  email: z.string().email().optional(),
  fechaNacimiento: z.string().optional(),         // ⏳ 'YYYY-MM-DD'
}).strict();
// ⏳ required fields unverified — confirm against POST /citas before freezing
const createAppointmentInput = z.object({
  idPaciente: z.string().min(1),
  idDentista: z.string().min(1),
  idSucursal: z.string().min(1),
  fecha: z.string().min(1),                       // 'YYYY-MM-DD'
  horaInicio: z.string().min(1),                  // 'HH:MM'
  duracion: z.number().int().positive(),          // ⏳ or derived hora_fin?
  idMotivo: z.string().optional(),                // ⏳ reason vs treatment linkage
  idTratamiento: z.string().optional(),           // ⏳
  comentarios: z.string().optional(),
}).strict();
```

**`q` filter (confirmed from docs):** Dentalink filters go in the `q` query param as JSON —
`q={"columna":{"operador":"valor"}}`, operators `eq`/`lk`/`neq`/`gt`/`gte`/`lt`/`lte`. `find_patient`
builds it from `documento`, e.g. `?q={"rut":{"eq":"11111111-1"}}` (⏳ confirm the real column name —
`rut` vs `documento` vs `numero_documento`).

### 1.4 Result shapes (curated — the raw Dentalink object is not dumped)

```ts
// ⏳ ALL field names below are doc-inferred; confirm against real responses before freezing.
interface DentalinkBranch      { id: string; nombre: string; habilitada?: boolean }
interface DentalinkSpecialty   { id: string; nombre: string }
interface DentalinkProfessional{ id: string; nombre: string; idEspecialidad?: string }
interface DentalinkTreatment   { id: string; nombre: string; duracion?: number }
interface DentalinkService     { id: string; nombre: string; idEspecialidad?: string; duracion?: number } // motivo
interface DentalinkSlot        { horaInicio: string; horaFin: string; idDentista: string; nombreDentista?: string } // 'HH:MM'
interface DentalinkPatient     { id: string; nombre: string; apellidos?: string; documento?: string; celular?: string; email?: string }
interface DentalinkAppointment { id: string; idPaciente: string; idDentista: string; idSucursal: string; fecha: string; horaInicio: string; estado?: string }
```

### 1.5 Dates & timezone (⏳)

Format `YYYY-MM-DD` (dates), `YYYY-MM-DD HH:MM:SS` / `HH:MM` (times) — **naive, no timezone declared**
in the docs. The adapter returns the provider's time strings **verbatim**; it never reinterprets or
localizes them. How the consumer confirms to the patient in the clinic's timezone is a consumer concern
(feature-design R-6). ⏳ Confirm whether the account/branch exposes a timezone.

---

## 2. Error Mapping (MCP) — ⏳ STRATEGY ONLY, UNVERIFIED

> The vendor docs specify **no** error codes, statuses, or payloads. This table is the **intended**
> mapping; the real HTTP/envelope behavior is the top verification item (§8). Do **not** implement
> `errors.ts` against this table — implement it against observed responses.

| Situation | Expected signal (⏳) | `ToolResult` | Code |
|:--|:--|:--|:--|
| Invalid / revoked token | 401 / 403 ⏳ | `kind: 'error'` | `PROVIDER_AUTH_EXPIRED` → reconnect in Rail A |
| **Valid token, missing permission** | 403 ⏳ (must be distinguishable from a dead token) | `kind: 'error'` | a **distinct** code (`PROVIDER_FORBIDDEN`), **never** `PROVIDER_AUTH_EXPIRED` — one disabled permission must not kill a healthy connection (ADR-0045 lesson) |
| Slot taken between read and book | conflict on `POST /citas` ⏳ | `kind: 'error'` | `PROVIDER_CONFLICT` (→ consumer maps to `slot_taken`, re-offers blocks, never retries blindly) |
| Patient already exists | conflict on `POST /pacientes` ⏳ | `kind: 'error'` | `PROVIDER_CONFLICT` (→ consumer reuses the existing `id_paciente`) |
| Nonexistent resource | 404 ⏳ | `kind: 'error'` | generic via `mapHttpStatusToErrorCode` |
| Rate limit / 5xx | 429 / 5xx ⏳ | `kind: 'error'` | `PROVIDER_RATE_LIMITED` / generic, not swallowed |

> Security rule (soul.md): error messages use **status/code**, never interpolate `res.body` or the URL.
> The token rides in the `Authorization` header (no query-string leak surface), but must never appear in
> logs, errors, or tool results — proven by a test.

---

## 3. Core scheme-prefix Materialization Contract (additive)

The only touch to the core, justified in ADR
[api-key-header-scheme-prefix](../../adr/api-key-header-scheme-prefix.md).

```ts
// src/core/provider-port.ts — additive: optional `scheme` on api_key header field
type ApiKeyField = {
  key: string;
  label: string;
  placement: 'header' | 'query';
  scheme?: string;               // ← NEW; header placement only. e.g. 'Token', 'Bearer', 'ApiKey'
};

// src/core/auth/authentication-materializer.ts — api_key header branch
if (field.placement === 'header') {
  headers[field.key] = field.scheme ? `${field.scheme} ${secret}` : secret; // ← prefix when declared
} else {
  url = appendQueryParam(url, field.key, secret);
}
```

- `scheme` absent ⇒ today's raw-secret behavior, **byte-unchanged**. Present ⇒ `<scheme> <secret>`.
- `bearer`/`basic`/`credential_exchange` branches **untouched**; `assertNever` still compile-forces
  every variant. A mutation test asserts that dropping the prefix turns a test red.

---

## 4. Backend — Rail A Connect Contract (generic, no per-provider code)

Per **ADR-0045**, an MCP provider whose discovered `authDescriptor` is credential-shaped registers a
Rail A credential provider **generically** — `mcp-bootstrap.ts` derives `connectFields` from the
descriptor (the declared secret field + any required `contextSchema` keys). **No `dentalink` file is
written in the backend.**

### 4.1 What the backend actually changes

| Change | File | Why |
|:--|:--|:--|
| One catalog data entry | `src/modules/mcp/toolboxes.ts` | the `MCPToolboxDefinition` (id `dentalink`, `category: 'healthcare'`, displayName, description, features, `mcpServerUrl`) |
| One i18n string | `src/infrastructure/i18n/locales/{en,es}.json` | `dentalink.error.invalid_credentials` (the credential-rejected message) |

### 4.2 Connect surface (Rail A generics — already exist)

Connect form derived from the descriptor = **a single secret field** (the API Token). Base URL is fixed
(lives in the MCP provider), not asked.

| Method | Route | Description |
|:--|:--|:--|
| `POST` | `/api/v1/connections/dentalink/connect-credential` | runs `connectionProbe` (`list_branches`), stores the token encrypted, or rejects (fail-closed) |
| `POST` | `/api/v1/connections/dentalink/reconnect` | re-enter the token after `PROVIDER_AUTH_EXPIRED` |
| `GET`  | `/api/v1/connections` | statuses (never returns the token) |

**Connect-form copy (consumer):** the clinic must have the paid API add-on and, as **Administrator**,
generate a token in *Administrador → Configuración API → Agregar cliente → Ver Token → Generar*, with
**read** (sucursales, agenda, prestaciones, pacientes) **and write** (citas, pacientes) permissions.

---

## 5. Mock Data (⏳ to confirm against a real clinic)

```jsonc
// tools/call → mcp_dentalink_list_branches (success) — the connectionProbe
{ "kind": "ok", "data": { "items": [ { "id": "1", "nombre": "Sede Centro", "habilitada": true } ] } }

// tools/call → mcp_dentalink_list_available_slots (success)
{ "kind": "ok", "data": { "items": [
  { "horaInicio": "10:00", "horaFin": "10:30", "idDentista": "7", "nombreDentista": "Dra. Pérez" }
] } }

// tools/call → mcp_dentalink_create_appointment (slot taken) — SHAPE PENDING (⏳ real conflict signal)
{ "kind": "error", "code": "PROVIDER_CONFLICT", "message": "slot no longer available" }

// tools/call → any tool with a revoked/invalid token — SHAPE PENDING (⏳ real 401 behavior)
{ "kind": "error", "code": "PROVIDER_AUTH_EXPIRED", "message": "provider auth failed" }
```

---

## 6. Agent Tool Specification

The 9 tools are discovered generically via the MCP catalog; the agent sees them with no special wiring,
namespaced `mcp_dentalink_*`. No tool returns a `ui` object in v1 (text conversational responses).
**No clinical-history / antecedentes tool exists** — patient-facing basket only (feature-design AD-7).

---

## 7. Roadmap (contract impact)

| Phase | Contract change |
|:--|:--|
| **v1** | This document (9 tools + scheme-prefix + generic connect) |
| **Fase 2** | Tools `get_patient_appointments`, `cancel_appointment`, `reschedule_appointment` (`POST /citas/changeDate`) → additive entries |
| **Fase 3** | Advanced modules (clinical history, budgets, collections) + CRM ingestion — the latter a **separate contract in `xcale-backend`** |

---

## 8. Verification plan (closes the Evidence status)

Against a real/test clinic with the API add-on and a token (do **not** exercise the write path against a
real agenda without explicit sign-off), **observe and fix** in this contract (removing every `⏳`):

1. **Auth**: confirm `Authorization: Token <token>` is the only accepted form (drives ADR / §3). If an
   alternative header/param works, §3 and the ADR may be avoidable.
2. **Error behavior (top risk)**: real HTTP status vs envelope — does Dentalink return clean 4xx, or
   `200 + {ok:false}` like Toteat? Is "valid token, missing permission" distinguishable from "invalid
   token"? What is the conflict signal on `POST /citas` and `POST /pacientes`?
3. **`create_patient`**: the exact required fields + names (`rut`? `documento`? `tipo_documento`?).
4. **`create_appointment`**: the exact required body (`hora_fin` vs `duracion`; `id_motivo` vs
   `id_tratamiento`; the appointment `estado` set).
5. **`find_patient`**: the real filterable column for the document in the `q` filter.
5b. **`list_professionals`**: whether `/dentistas` is `q`-filterable and by which columns
   (`id_sucursal`/`id_especialidad` are provisional); and **`list_services`**: whether the per-specialty
   read is the nested `/especialidades/{id}/motivos` or a filter on `/motivosAtencionEspecialidad`.
6. **`list_available_slots`**: real params/response of `GET /agendas`; where `duracion` comes from
   (reason/treatment).
7. **Timezone**: whether the account/branch declares one; how slot/appointment times are expressed.
8. **`accountKey`**: whether a stable clinic id exists (for multi-clinic-per-tenant) or slug default holds.
9. **Rate limits**: real limits (the probe costs 1 call per connect attempt).

> Store the evidence in a journal `docs/design/dentalink-provider/sandbox-evidence.md` (Spanish
> allowed), as Siigo/WooCommerce did, and reconcile any spec-vs-reality gaps there.
