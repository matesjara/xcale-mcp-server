# Dentalink Provider (v1) — Feature Design

> **Feature**: Onboard Dentalink as an MCP provider (`api_key`, `Authorization: Token <token>`, `forwarded`), read + additive reserve path, with curated `mcp_dentalink_*` tools (structure, agenda, patient, booking), connected to xcale-backend via Rail A.
> **Priority**: P1 High
> **Owner**: Sara 
> **Status**: Draft — shaped from `/grillr` (2026-09-24, see [`grill-log.md`](./grill-log.md)); **pending live verification against the real API** (§7)
> **Target Release**: v1 — read + reserve slice
> **Last Updated**: 2026-09-24

---

> **Architectural guardrail (binding).** This design instantiates decisions fixed in the grill. The
> **only** intended concession to the core (`src/core`) is a generic `Authorization: Token <secret>`
> scheme prefix on `api_key` header placement (§3.1) — Dentalink uses `Token `, and the materializer
> today emits only `Bearer`, raw, or `Basic`. This is the WooCommerce/`basic` precedent: a **generic**
> control (every future `Authorization: <Scheme> <token>` provider needs it), justified in its own ADR.
> If implementation surfaces a need for anything WooCommerce-shaped beyond that — multi-secret, a
> per-provider branch in the core — **stop and reopen the ADR**; do not absorb architecture into this
> feature.
>
> **Method principle behind reserve-first (not read-only).** WooCommerce validated the circuit on
> reads before writes. Dentalink v1 deliberately includes the **additive** writes (`create_patient`,
> `create_appointment`) because a dental agent that cannot book is a glorified FAQ — the value is
> closing the appointment (grill PD-1). The line held is **irreversibility**: additive writes are in
> v1; **destructive** mutations on an existing agenda (cancel / reschedule) wait for v2.

---

## 1. Problem Statement

### What's happening?

A dental clinic that runs on **Dentalink** (HealthAtom) keeps its whole operating truth there:
branches (`sucursales`), dentists and their specialties, treatments and the service catalog, the
agenda with its free time-blocks, and patient records. Today an xcale agent connected to that tenant
**sees none of it**, so the conversation that matters most — a patient who writes on WhatsApp *"do you
have an opening for a cleaning this week?"* — dies in narration: the agent can talk, but it cannot read
real availability or **close the appointment**.

Dentalink publishes a REST API authenticated with a static token — a LatAm vertical API that Composio
does not cover, which is precisely this server's reason to exist. Dentalink becomes the
**healthcare-vertical** sibling of Toteat (POS) and Cloudbeds (hospitality), and the first dental
provider.

### Who's affected?

- **The patient** (WhatsApp inbound): wants to know what services exist, in which branch, with which
  professional, and at what time — and wants to **be booked right there**, off-hours included.
- **The clinic** (owner / reception): today books every appointment by hand and answers availability
  from memory or the panel. The cost is reception time and lost off-hours bookings.
- **The agent**, which today has no capability over Dentalink.

### What's the cost of inaction?

Without this, "dental clinic" is not a tenant type xcale serves end-to-end. The agent stays an
informational chatbot instead of a 24/7 reception that books.

---

## 2. Goals & Success Metrics

### North Star

A clinic connects its Dentalink token once and, from then on, its patient-facing agent can go from
"I want an appointment" to **booked in Dentalink**, over WhatsApp, with real availability and no double
booking or PII leak.

### Metrics

| Type | Metric | Target | How Measured |
|:--|:--|:--|:--|
| **Leading** | End-to-end round trip proven against a real/test clinic | `discover` + `tools/list` + `tools/call` + forced auth-failure path green | Provider conformance suite |
| **Leading** | A real clinic connected without support | 1 dogfooding clinic connected | Rail A connection status |
| **Lagging** | Booking flows that reach "choose block" and end in a created appointment | > 70% | `create_appointment` `success:true` over flow starts (measured consumer-side) |
| **Lagging** | Double bookings confirmed silently / PII leaks to the patient channel | **0** | typed `slot_taken` on every conflict; no clinical-history tool in the patient basket |

---

## 3. Target Users

### Patient (buyer over WhatsApp)

- **Context**: writes to the clinic's line any time, often off-hours.
- **Motivation**: get an appointment fast, for a concrete service (cleaning, valuation, general
  consult), in their branch, with clear availability.
- **Pain Today**: waits for reception; hears times from memory; no immediate confirmation.
- **Expected Benefit**: checks real availability and is booked in the same conversation.

### Clinic (owner / reception)

- **Context**: manages the agenda inside the Dentalink panel; handles WhatsApp in parallel.
- **Motivation**: offload repetitive booking; stop losing off-hours appointments.
- **Pain Today**: every appointment loaded by hand; availability answered manually.
- **Expected Benefit**: the agent books against the same Dentalink agenda, without duplicating records
  or clashing slots. Staff keep using the Dentalink panel / the xcale Inbox for contact, record, and
  history — **no staff WhatsApp agent in v1**.

---

## 4. User Stories

### Must Have (P0) — v1

- **US-01**: As the clinic, I want to connect Dentalink by pasting a single token once, and have the
  system verify it works before marking it connected.
- **US-02**: As a patient, I want to ask what services (appointment reasons) are available, so I know
  what I can book.
- **US-03**: As a patient, I want to pick a branch and, if it applies, a specialty or professional.
- **US-04**: As a patient, I want to see real free time-blocks and choose one.
- **US-05**: As a new patient, I want my basic record created so I can be booked.
- **US-06**: As a returning patient, I want to be recognized by my document and **not** get a duplicate
  record.
- **US-07**: As a patient, I want to be booked and get the minimal operational confirmation
  ("Booked Tuesday 10:00 with Dr. Pérez, Centro branch").

### Should Have (P1) — v2

- **US-08**: As a patient, I want to look up my own appointment ("what time was my appointment?").
- **US-09**: As a patient, I want to **reschedule** or **cancel** my appointment.

### Could Have (P2) — v2+

- **US-10**: As the clinic, I want appointments to flow into xcale's CRM as events for reminders and
  campaigns.

---

## 5. Feature Scope (MoSCoW)

### ✅ Must Have — v1 (Fase 1, read + reserve)

- [ ] `dentalink` provider in the MCP (`src/providers/dentalink/`) with the v1 tools:
  - Structure (customer): `list_branches`, `list_specialties`, `list_professionals`, `list_treatments`, `list_services`
  - Agenda (customer): `list_available_slots`
  - Patient: `find_patient` (by document), `create_patient`
  - Booking: `create_appointment`
- [ ] `Authorization: Token <secret>` scheme prefix on `api_key` header placement in the core
  materializer (own ADR — see the guardrail).
- [ ] `authDescriptor` declaring `api_key` (header) + a `contextSchema` carrying `id_sucursal` and any
  other non-secret routing datum as call context.
- [ ] A declared `connectionProbe` (`list_branches`) so the backend validates the pasted token
  generically (ADR-0045).
- [ ] Error mapping: a **permission** failure → a distinct code (never `PROVIDER_AUTH_EXPIRED`); a
  booking conflict → typed `slot_taken`; `429` → `PROVIDER_RATE_LIMITED`.
- [ ] Rail A connect (backend): generic descriptor-driven credential registration (no per-provider
  backend code — ADR-0045); one `MCPToolboxDefinition` entry + the `dentalink.error.invalid_credentials`
  i18n string.

### 🟡 Should Have — Fase 2

- [ ] Read own appointments (`get_patient_appointments`).
- [ ] Destructive mutations: `cancel_appointment`, `reschedule_appointment`.

### 🔵 Could Have — Fase 3

- [ ] Advanced modules: clinical history, budgets (`presupuestos`), collections (`cobranzas`).
- [ ] CRM ingestion: appointments → CRM Events; link `id_paciente` ↔ CRM Contact (own grill +
  feature-design in `xcale-backend`).

### ⛔ Won't Have — Explicit Out of Scope

- **Any clinical-history / antecedentes / medical-record tool in the patient-facing basket** — it is
  PII; exposing it to the patient channel leaks to impostors ("I'm Juan, ID 123"). Staff read it in
  the Dentalink panel / xcale Inbox (authenticated by role). Removed at the root in v1.
- **A staff WhatsApp agent** (reception/doctor) — no need in v1; staff have a secure authenticated
  surface already.
- **Destructive mutations** (cancel / reschedule) — they touch the real operating agenda; higher blast
  radius, rare in v1. → Fase 2.
- **Consumer-side concerns living in the adapter**: patient search-before-create flow, retry
  idempotency, audience curation, rate-limit budgeting, caching, CRM. The adapter provides primitives
  and typed codes; the **consumer decides** (see §5 boundary table below and `xcale-backend`).
- **Mirroring / indexing** Dentalink data in our DB — no v1 use case.

**Consumer-boundary decisions (from the grill, formalized later in `xcale-backend/docs/design/dentalink-integration/`):**

| Consumer decision | Where enforced |
|:--|:--|
| v1 = read + additive reserve path (`find` → `create_patient` if new → `create_appointment`) | backend flow + basket curation |
| Patient-facing agent only; no PII tool in the patient basket | backend basket curation |
| Patient identity/dedup key = **document** (cédula/RUT); phone secondary | backend flow |
| Fail-loud: on `slot_taken`, never retry blindly — re-offer blocks | backend agent conduct (adapter gives the typed code) |
| Idempotency: GET-by-document before POST; reuse existing `id` on duplicate | backend flow (adapter gives `find_patient` + conflict code) |
| Connect copy: paid API add-on + admin-generated token with read **and** write permissions | backend connect descriptor |

---

## 6. UX & Interaction Design

> No complex new screens: the UX is (a) the **connect** flow in the dashboard and (b) the agent's
> **conversational behavior**. Both are consumer-side; described here so tool descriptions and error
> copy are written correctly.

### 6.1 Connect flow (dashboard, clinic owner)

**Entry Point**: in the integrations catalog the owner sees "Dentalink" (discovered from the MCP
catalog, category `healthcare`) and clicks **Connect**.

**Form Structure**: the backend, via its connect-descriptor, requests a **single secret field** — the
Dentalink **API Token**. The base URL is fixed (`https://api.dentalink.healthatom.com/api/v1/`), not
asked. The description guides the owner: contract the paid API add-on with Dentalink, then, as
**Administrator**, generate a token in *Administrador → Configuración API → Agregar cliente → Ver
Token → Generar*, with **read** (branches, agenda, treatments, patients) **and write**
(appointments, patients) permissions.

**Validation (`connectionProbe`)**: on submit, the token runs a cheap read (`list_branches`). If it
returns the branches, the connection is `connected` — **green means verified, not assumed**. On
failure nothing is stored (fail-closed); the error distinguishes invalid/no-read-permission from rate
limit ("wait a minute", never "invalid credentials" — ADR-0045 lesson). Write scope is **not** probed
(a test booking dirties the agenda).

**Submit**: on success `accountKey` = the clinic account, and the agent sees the tools. The owner never
re-enters the token.

**Error Handling**: revoked/invalid token → reconnect message; the raw provider message and the token
are never leaked.

### 6.2 Conversational behavior (patient over WhatsApp)

The patient asks for an appointment; the agent identifies the **service/reason** (`list_services`) and,
if applicable, the **specialty** (`list_specialties`). It resolves the **branch** (`list_branches` →
`id_sucursal`) and reads **free blocks** (`list_available_slots`) to offer concrete options. It asks
for the patient's **document**, runs `find_patient` (reuse) or `create_patient` (new), then
`create_appointment`. Minimal operational confirmation only — **never** antecedentes or clinical PII.

### 6.3 Key states

| Interaction | Trigger | Behavior |
|:--|:--|:--|
| Successful connect | Valid token, probe passes | `connected`; tools available to the agent |
| Slot taken between read and book | Provider conflict on `create_appointment` | typed `slot_taken` → agent re-offers blocks, never retries blindly |
| Patient already exists | duplicate on `create_patient` | adapter surfaces the conflict; consumer reuses existing `id_paciente` |
| Token without write permission | 403 on first `create_appointment` | distinct code (`missing_scope`/`PROVIDER_FORBIDDEN`), loud — not `PROVIDER_AUTH_EXPIRED` |
| Revoked token | 401/403 on a call | Rail A marks the connection; prompts reconnect |

### 6.4 Notifications & Feedback

Reconnect-required is surfaced by Rail A's generic mechanism. No feature-specific notifications in v1
(appointment reminders need CRM ingestion — Fase 3).

---

## 7. Data Model Sketch

> No new domain entities. Reuses Rail A's `Connection` (Credential Connection) and the MCP provider
> model. Everything else (branches, patients, appointments) lives in Dentalink and is read/written
> per tool — passthrough, no mirror.

### Provider (MCP) — `authDescriptor` (shape)

| Field | Type | Description |
|:--|:--|:--|
| `type` | `'api_key'` | header placement, `Authorization: Token <secret>` (needs the scheme-prefix core change) |
| `credentialDelivery` | `'forwarded'` | token travels per call and is discarded; standard-risk (not financial) |
| `contextSchema` | JSON Schema | publishes `id_sucursal` (and any routing datum) as call context |
| `connectionProbe` | `{ tool: 'list_branches' }` | cheap read the consumer runs to validate the credential |

### Connection (Rail A) — relevant fields

| Field | Type | Description |
|:--|:--|:--|
| `provider` | `'dentalink'` | provider slug |
| `accessToken` | string (encrypted at rest) | the API token; forwarded per call, revealed only at egress |
| `accountKey` | string | the clinic account identity (single-account per token) |
| `refreshToken` / `expiresAt` | absent | Static credential — no refresh; expiry detected reactively |

### Relationships

```
Clinic (1 token) ──has──▶ Connection (provider='dentalink', accountKey = clinic account)
Clinic          ──has many──▶ Branch (id_sucursal)   [data within the account, NOT accountKey]
Connection      ──resolves to──▶ ResolvedCredential (secret = token, forwarded)
MCP provider    ──sends──▶ Authorization: Token <token> ; id_sucursal as context/argument
```

### State (connection)

```
disconnected ──connect (probe: list_branches)──▶ connected
connected ──401/403 on a call──▶ auth_failed ──reconnect──▶ connected
```

---

## 8. Architectural Decisions

| # | Decision | Choice | Rationale |
|:--|:--|:--|:--|
| AD-1 | Provider pattern | Thin adapter via canonical helpers (`defineTool`/`createProvider`) | `add-provider` recipe; no business logic, consumer-agnostic |
| AD-2 | Auth scheme | `api_key` header, `Authorization: Token <secret>` | Dentalink's documented scheme; static token, no OAuth/refresh |
| AD-3 | Core concession | add a generic **scheme prefix** to `api_key` header placement (own ADR) | materializer emits only `Bearer`/raw/`Basic` today; `Token ` is generic to any `Authorization: <Scheme> <token>` provider (WooCommerce/`basic` precedent) |
| AD-4 | Credential delivery | `forwarded` | standard-risk, like Toteat/WooCommerce; not financial |
| AD-5 | Account identity | `accountKey` = clinic account; `id_sucursal` is context/argument | one token sees all branches; wrong `accountKey` is a cross-tenant answer (ADR-0045 §3) |
| AD-6 | Backend connect | generic descriptor-driven credential registration (ADR-0045) | no per-provider backend code; `mcp-bootstrap` derives `connectFields` from the descriptor |
| AD-7 | Connection probe | `list_branches` (read); write scope **not** probed | fail-closed connect; a test booking would dirty the real agenda |
| AD-8 | Error mapping | permission ≠ auth-expired; conflict → `slot_taken`; `429` → rate-limited | one disabled permission must not kill a healthy connection; consumer decides re-auth |
| AD-9 | Write posture | additive writes (`create_*`) in v1; destructive (cancel/reschedule) in v2 | minimize irreversibility while still delivering booking (grill PD-1) |

---

## 8b. Product Decisions (from the grill)

| # | Decision | Rationale | Door | Within charter |
|:--|:--|:--|:--|:--|
| PD-1 | v1 cuts by **risk**, not read-vs-write: includes the additive reserve path; cancel/reschedule → v2 | read-only is a FAQ; "all at once" front-loads destructive mutations. Reserve ≈ 80% of value at ≈ 40% of risk. Success: >70% of block-choices end booked. Revisit if reschedule/cancel demand spikes early | two-way | yes |
| PD-2 | Patient-facing agent only; no staff WhatsApp agent in v1 | removes PII surface and conversational auth complexity; staff already have a secure surface. Revisit if a clinic asks to operate the agenda from the staff side | two-way | yes |
| PD-3 | Patient confirmation = minimal operational data; never clinical PII | an unverified WhatsApp channel must not return PII | one-way (security) | yes |

---

## 9. Risks & Open Questions

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|:--|:--|:--|:--|:--|
| R-1 | Token minted **without** write permission → connects but cannot book | Med | High | connect-form permission copy + a loud distinct code on first booking (AD-7/AD-8) |
| R-2 | Stale availability between read and book → double booking | Med | High | typed `slot_taken`, consumer never retries blindly (AD-8) |
| R-3 | Duplicate patient record by RUT/cédula | Med | Med | adapter surfaces the conflict; consumer does GET-by-document before POST and reuses the id (AD-6/AD-8) |
| R-4 | "Not authorized" ambiguous between dead token and disabled permission (Toteat lesson) | Med | Med | probe proves real read scope; distinct error codes; never auto-declare the credential dead |
| R-5 | Undocumented rate limits | Med | Med | `429` → typed `PROVIDER_RATE_LIMITED`; graceful back-off; the probe costs 1 call per connect attempt |
| R-6 | Appointment timezone mishandled → wrong hour | Med | High | adapter returns the provider's shape verbatim; consumer confirms in the clinic's timezone (fixed in api-contract) |
| R-7 | Token in the `Authorization` header leaks via a transport error path | Low | High | never interpolate credential/URL into logs, errors, or tool results; proven by a test |

### Open Questions (resolved at api-contract time, against the live API)

| # | Question | Needed By | Owner | Resolution |
|:--|:--|:--|:--|:--|
| Q-1 | Does the auth materializer need the `Token ` prefix, or does Dentalink accept an alternative placement? | Implementation | verify vs API | Pending (drives AD-3 / the ADR) |
| Q-2 | Are `list_treatments` (`prestaciones`) and `list_services` (reasons) the same Dentalink entity or two? | API contract | verify vs API | Pending |
| Q-3 | Is booking keyed by professional, by specialty, or both? What are `list_available_slots` inputs? | API contract | verify vs API | Pending |
| Q-4 | How does Dentalink express the timezone of slots/appointments? | API contract | verify vs API | Pending (see R-6) |
| Q-5 | Minimum required fields for `create_patient`? | API contract | verify vs API | Pending |
| Q-6 | How is "valid token, missing permission" distinguishable from "invalid token"? Clean 4xx or envelope? | API contract | verify vs API | Pending (see R-1/R-4) |

---

## 10. Phasing & Roadmap

| Phase | Scope Summary | Key Deliverables | Dependencies | Est. Effort |
|:--|:--|:--|:--|:--|
| **v1 (Fase 1)** | Read + additive reserve path, patient-facing | Dentalink provider (9 tools) + `Token ` scheme prefix (MCP core + ADR) + Rail A connect (generic) + backend toolbox entry + i18n | ADR for the auth prefix; **live API verification** (§7) | L |
| **Fase 2** | Mutations on the existing agenda | `get_patient_appointments`, `cancel_appointment`, `reschedule_appointment` | v1 in production and proven | M |
| **Fase 3** | Advanced modules + CRM | clinical history, budgets, collections; CRM Event ingestion + `id_paciente` ↔ CRM Contact | v2; own grill + feature-design in `xcale-backend` | L/XL |

---

## 11. Agentic Context

### Related Modules

| Module | Relationship | Key Files |
|:--|:--|:--|
| MCP providers | New provider, sibling of Toteat/Siigo/WooCommerce | `xcale-mcp-server/src/providers/dentalink/` |
| MCP core auth | Gains a generic `Authorization: <Scheme>` prefix on `api_key` header (additive, ADR) | `xcale-mcp-server/src/core/auth/authentication-materializer.ts`, `src/core/provider-port.ts` |
| Rail A (connections) | Generic descriptor-driven credential connect + forwarding (no per-provider code) | `xcale-backend/src/modules/connections/` (`credential-registry.ts`), `xcale-backend/src/modules/mcp/mcp-bootstrap.ts` |
| Backend catalog | One `MCPToolboxDefinition` data entry | `xcale-backend/src/modules/mcp/toolboxes.ts` |

### Codebase Entry Points — what gets created / touched

**MCP repo (`xcale-mcp-server`) — the bulk of the work:**

- **Created**: `src/providers/dentalink/` — `manifest.ts`, `auth.ts`, `client.ts`, `context.ts`,
  `tools.ts`, `errors.ts`, `provider.ts`, `index.ts`, plus `__fixtures__/` and `__tests__/`.
- **Modified**: `src/providers/index.ts` — **one line** (import + add `dentalinkProvider` to
  `PROVIDERS`).
- **Modified (core, ADR-gated)**: `src/core/auth/authentication-materializer.ts` (+ the descriptor
  type in `src/core/provider-port.ts`) — add the optional scheme prefix so `api_key` header can emit
  `Authorization: Token <secret>`. Only if Dentalink requires the `Token ` prefix (Q-1).
- **Config**: `DENTALINK_BASE_URL` in Doppler `xcale-mcp-server` (`dev`/`prd`); no OAuth client
  secrets (credential provider). Test-clinic values for verification.

**Backend repo (`xcale-backend`) — minimal, phase 1 wiring:**

- **Modified**: `src/modules/mcp/toolboxes.ts` — **one data entry** (`MCPToolboxDefinition`: id
  `dentalink`, displayName, description, icon, `category: 'healthcare'`, features, `mcpServerUrl`).
- **Modified**: i18n — add `dentalink.error.invalid_credentials` to `en.json` + `es.json` (the
  credential-rejected message; Toteat's names the exact screen).
- **No new endpoints, no new module, no per-provider credential code** — `mcp-bootstrap.ts` registers
  the credential provider generically from the discovered `authDescriptor` (ADR-0045). The Generic
  Connect Surface serves the connect form from the derived descriptor.

**Does phase 1 connect to xcale-backend?** Yes. The provider is inert without a consumer: the backend
is what stores the Connection (Rail A), renders the connect form, runs the `connectionProbe`, and
exposes the tools to the agent. Phase 1 = the MCP provider **plus** the two-line backend wiring above.
The order of work is **MCP first** (provider + the auth-prefix ADR), **backend second** (the toolbox
entry + i18n).

### Conventions to Follow

- Thin adapter: no business logic, no consumer concepts (Consumer-Agnostic).
- Credential via `SecretString`; `.reveal()` only at egress; never persist/log the token or the URL.
- Typed errors; permission ≠ `PROVIDER_AUTH_EXPIRED`; conflict → `slot_taken`; never interpolate
  `res.body`/URL into messages.
- Tools namespaced `mcp_dentalink_{verb}`, zod input as the single source of truth.

### Next Steps After Approval

1. **Verify against the live API** (resolves Q-1…Q-6) — ideally a real/test clinic token; do not
   exercise the write path against a real agenda without explicit sign-off.
2. **ADR** for the `api_key` scheme prefix (if Q-1 confirms the `Token ` need).
3. **API Contract** → `/api-contract-authoring` → `docs/design/dentalink-provider/api-contract.md`.
4. **Implementation** → MCP first (provider + prefix), backend second (toolbox entry + i18n).
