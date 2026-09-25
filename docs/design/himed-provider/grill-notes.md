# HiMed — grill notes (pre feature-design)

- **Status:** alignment (grill). This PR ships the grill notes only; ADRs and the feature-design are follow-ups.
- **Date:** 2026-09-15
- **Code target repo:** `xcale-mcp-server` (MCP provider); credentials in `xcale-backend` (Rail A).
- **Source:** HiMed public documentation (`https://www.medsas.co/developer/` + the `apisandbox/docs` Swagger).

> Working document. Records resolved decisions and open questions from the grill; the feature-design is
> authorized once the blocking questions close.

---

## 1. Scope

Integrate HiMed (cloud clinical-records software, Colombia) so an xcale agent can query and schedule against
the customer's clinical system over WhatsApp. Clinical modules: doctors, locations (sedes), patients
(demographics), appointments (autoagendamiento). The **accounting module is out of scope**.

## 2. Recon findings (verified in code)

1. **Nevatal is NOT an MCP provider.** It lives as a native toolbox in `xcale-backend/src/modules/nevatal/`
   with a hand-rolled HTTP client (`nevatal/api.ts:35`); it does not appear in `xcale-mcp-server/src/providers/index.ts`.
2. **The MCP materializer cannot place the credential in the body.** `authentication-materializer.ts:39-43`
   supports only `header` or query-string for `api_key`. HiMed sends its `api_key` **inside the JSON body**.
3. **`auth` is singular per provider** (ADR-0016). One provider = one `authDescriptor` shared by all its
   tools; the materializer places **one** secret in **one** field (`fields[0]`).
4. **HiMed has two incompatible auth schemes:**
   - `m.medsas.co` (doctors, locations, demographics): secret in the **`api_key`** body field, plaintext.
   - `socket.medsas.co` (appointments): **`token`** field (SHA-256) + `codigo_servicio`, single RPC endpoint dispatched by `accion`.

## 3. Resolved decisions

- **D1 — Where it lives: MCP provider (option B).** Aligned with the strategic direction: existing native
  integrations are frozen, new work goes to the MCP server (`docs/adr/0004-provider-knowledge-vs-credential-custody.md`).
  We knowingly accept the cost of ≥1 core ADR that the native option would not incur.
- **D1-rejection — Option A (native toolbox modeled on Nevatal): rejected.** It would be cheaper (HiMed's
  awkward auth is trivial in a hand-rolled client, zero core ADRs), but it grows the backend per-provider —
  exactly what ADR-0004 aims to stop. Strategic consistency is prioritized over the one-off cost.
  _(This choice applies ADR-0004; it does not warrant its own ADR.)_
- **D2 — Two providers.** Not a preference: it is forced by (3)+(4). The modules use **different body fields**
  (`api_key` vs `token`) and different schemes → they cannot share one `authDescriptor`.
  - `himed` → doctors, locations, demographics (`api_key` in body, `credentialDelivery: 'forwarded'`).
  - `himed-scheduling` → appointments.
  - Accepted cost: two catalog entries / two connections for one vendor (matches that HiMed issues separate
    credentials for autoagendamiento).
- **D3 — Phases.** Phase 1: `himed` = read (doctors, locations) + **patient writes** (`create_patient`,
  `update_patient`, `change_patient_document`) — confirmed 2026-09-15. Creating an appointment (phase 2)
  requires the patient to already exist, so patient creation belongs in phase 1. Being PHI writes, they go
  with field curation (Q4). Phase 2: `himed-scheduling` (appointments).
- **D4 — Accounting out of scope.** HiMed pushes invoices directly to Siigo/Alegra, configured inside HiMed
  Web; xcale is not in that path. It does not trigger the ADR-0010 financial gate.

## 4. ADRs to create

| ADR                                             | Status         | Reason                                                                                                                                          |
| ----------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_key placement: 'body'` in the materializer | **Definite**   | Touches `src/core/auth/authentication-materializer.ts` → breaks the `add-provider` golden rule → requires an exceptional ADR. Enables phase 1.  |
| ~~Imperative/signed auth for appointments~~     | **NOT needed** | The docs confirm `token`/`codigo_servicio` are static values HiMed issues (not computed per request) — see Q1. No signed-auth variant required. |

The B-vs-A choice is **not an ADR** (it applies ADR-0004): documented here and in the feature-design.

### Why HiMed needs `placement: 'body'` (explanation)

**How the MCP places the credential today.** When a tool runs, a single core step
(`authentication-materializer.ts`) takes the secret and puts it on the request in **one of two ways**:

- in a **header** — e.g. `Authorization: Bearer <token>` or `X-Api-Key: <token>`, or
- in the URL **query-string** — e.g. `...?api_key=<token>`.

There is no third way. In particular, it **never** puts the secret inside the JSON body.

**How HiMed expects it.** HiMed expects the credential as **one more field inside the body** of the POST:

```json
POST .../consultarSedes.php
{ "api_key": "NJA6isD893nsa0Q72j", "pais": "CO", "departamento": "..." }
```

That is, the `api_key` travels _mixed with the business data_ in the JSON — not in a header or the URL.

**Why that forces an ADR.** The materializer is `src/core` code, **shared by all providers**. The
`add-provider` golden rule forbids a provider from touching `src/core` without an **exceptional ADR** —
precisely so the core does not get polluted provider by provider. HiMed forces teaching the materializer a
**third** way to place the credential (`placement: 'body'`), and that means touching the core.

**Why there is no shortcut inside the provider.** You cannot "put the api_key in the body" from the adapter's
`client.ts` bypassing the materializer: the secret's decryption (`.reveal()`) is confined to that single
controlled core point (the `SecretString` security control, CI-verified). So body-placement **must** live in
the materializer, not in the adapter.

**What the change is, concretely.** Add `'body'` as a valid `placement` value in the `authDescriptor` type,
and a branch in the materializer that inserts the secret into the JSON body before sending. Few lines, but
**structural** (it widens a shared contract) → hence the ADR.

## 5. Open questions

- **Q1 (technical) — RESOLVED per docs (2026-09-24):** how is the autoagendamiento SHA-256 `token` generated?

  _Answer:_ the docs state `codigo_servicio` and `token` are **"ambos generados por HiMed Solutions y cifrados
  con SHA-256"** — static values HiMed issues (the examples reuse the same `token` across every call). **Not**
  computed per request → **not** signed/imperative auth. (Resolved from the developer docs, not HiMed's email —
  the email only pointed us to the portal.)

  _Consequence:_ the imperative-auth ADR is **dropped**. `himed-scheduling` auth = static values in the body:
  model `token` as the body-placed secret and `codigo_servicio` as non-secret metadata (`X-Provider-Metadata`),
  pending a one-line confirm that `codigo_servicio` is safe as non-secret routing. Worth confirming static-ness
  at activation, but the design no longer blocks on it.

- **Q2 (commercial) — RESOLVED (2026-09-15, Mateo):** who pays for the HiMed API Key?

  _Decision:_ **each client clinic pays** for its own HiMed API Key. xcale is **only the integrator**.

  _Why:_ xcale does not resell HiMed access; the clinic holds the commercial relationship with HiMed. xcale
  builds the technical integration and custodies the clinic's key in Rail A.

  _Implication:_ onboarding a clinic includes the clinic obtaining its own key/sandbox access from HiMed
  (the sandbox still requires a paid key — the clinic's, not xcale's). HiMed support: `ayudamed@himedsolutions.com`,
  line `3009120001` op 2.

- **Q3 (product) — RESOLVED (2026-09-15):** does phase 1 include patient writes (create/update), or does it
  start read-only?

  _Decision:_ phase 1 **includes** creating/updating patients (`create_patient`, `update_patient`, `change_patient_document`).

  _Why:_ creating an appointment (phase 2) **requires the patient to already exist** in HiMed, so patient
  creation must land in phase 1 — starting read-only would strand phase 2 with a half-built dependency. Being
  PHI writes, these tools go with field curation (see Q4). See D3.

- **Q4 (security · PHI) — OPEN · tracked in backend as issue #1055 (Ley 1581):** results carry health data
  (names, document, phone, email, address, birth date) that enters the LLM context and the stored conversation.
  soul.md #1. Per JuanJo (epic #1053), the Ley 1581 consent question is now **backend issue #1055** and it
  **gates three integrations** (this one, #1039, SaludTools) — one answer covers all three, and it belongs in
  front of Mateo **before Senzzes starts (November)**. The provider-side mitigation below still stands; the
  legal/consent decision lives in #1055.

  _Possible solution (recommendation, not decided):_ **per-tool field projection (allow-list)** curated in the
  adapter — each tool returns only what its job needs and drops the rest; allow-list so a new sensitive HiMed
  field **does not leak by default**. Permitted by _Fidelity over Unification_ (ADR-0009). Examples:
  `list_doctors` → id, name, specialty; `list_locations` → id_sede, sede, city;
  `search_patient`/`patient_exists` → id_paciente, name, tipo_documento. The exact field set is defined in the api-contract.

  _What projection does NOT solve (still open):_
  - **Logs / storage:** even curated, it is still PHI in the LLM context and the stored conversation; ensure neither MCP nor backend logs raw results.
  - **Legal/consent (Mateo's call):** sending **sensitive** health data (Ley 1581, Colombian habeas data) to a US-based LLM has consent and data-residency implications. Not solved by code; may be a bigger blocker than `placement: 'body'`. Raise before sending PHI to production.

- **Q5 (product) — RESOLVED (decision):** does HiMed push events (webhooks / websockets / real-time), or must
  the client poll?

  _Decision:_ **we use polling** for appointment reminders (poll `citasPaciente`).

  _Why:_ HiMed's flow is **unilateral / pull-only** per its docs (FAQ: "unilateral flow") — it does not push
  to the client, so there is no push channel to subscribe to. The `socket.medsas.co` host and the
  `notificaciones` path are **misleading naming**, not a real-time channel.

  _Note:_ this is decided from the public docs. A direct confirmation with HiMed is **optional / low-stakes** —
  if we were wrong and a real-time channel existed, we would only miss an optimization, not be blocked (polling
  is the fallback either way). Polling cost is evaluated at Phase 3 (reminders are a Should Have, not MVP).

## 6. How the integration works (end-to-end)

Per-call flow (phase 1, provider `himed`):

1. A patient writes on WhatsApp; the agent decides to use an `mcp_himed_*` tool.
2. `xcale-backend` resolves the tenant's HiMed connection in **Rail A**, decrypts the `api_key`, and forwards
   it to the MCP server as `X-Provider-Token` (Hop A). The backend authenticates to the server with the Hop-B secret.
3. The **`himed` provider** runs the tool: its `client.ts` POSTs to the `.php` endpoint on `m.medsas.co`,
   injecting the `api_key` **in the body** (exactly what the body-placement ADR enables).
4. HiMed responds JSON; the provider normalizes to a `ToolResult` (standard envelope, `data` faithful to the
   provider). The server **discards** the credential — never persists it (Credential-in-Transit-Only).
5. A 401/403 from HiMed → the provider returns `PROVIDER_AUTH_EXPIRED` → the backend marks the connection
   (`markConnectionAuthFailure()`) and the agent prompts to reconnect.

The `api_key` custody lives **only** in Rail A; the server is credential-stateless.

## 7. Endpoints and proposed tools

### Provider `himed` — host `m.medsas.co`, `api_key` in body — **PHASE 1**

| Module    | Endpoint (POST)                              | Proposed MCP tool                                        | Type      |
| --------- | -------------------------------------------- | -------------------------------------------------------- | --------- |
| Doctors   | `Usuarios/consultarUsuarios.php`             | `mcp_himed_list_doctors`                                 | read      |
| Locations | `Sedes/consultarSedes.php`                   | `mcp_himed_list_locations`                               | read      |
| Patients  | `Demograficos/crearPaciente.php`             | `mcp_himed_create_patient` (creates or checks existence) | **write** |
| Patients  | `Demograficos/modificarPaciente.php`         | `mcp_himed_update_patient`                               | **write** |
| Patients  | `Demograficos/modificarIdTipoIdPaciente.php` | `mcp_himed_change_patient_document`                      | **write** |

### Provider `himed-scheduling` — host `socket.medsas.co`, RPC by `accion`, SHA-256 token — **PHASE 2**

A single endpoint (`envioConsumoAutoagendamiento`) dispatches by the `accion` field. In the MCP, each `accion`
is its own `defineTool` (curated); the `client.ts` maps it to the POST with its `accion`.

| accion                                                                                               | Proposed MCP tool           | Type      |
| ---------------------------------------------------------------------------------------------------- | --------------------------- | --------- |
| `existePaciente`                                                                                     | `patient_exists`            | read      |
| `listarSedes` / `listarEspecialidades` / `listarUsuarios` / `listarModalidades` / `listarTiposCitas` | `list_*`                    | read      |
| `consultarDisponibilidad`                                                                            | `get_availability`          | read      |
| `CrearCita`                                                                                          | `create_appointment`        | **write** |
| `citasPaciente`                                                                                      | `list_patient_appointments` | read      |
| `cancelarCita`                                                                                       | `cancel_appointment`        | **write** |

**Context (`contextSchema`): not needed.** One connection spans N locations, but `idSede` travels as an
**explicit argument** of each tool (the agent lists locations and passes `idSede`), not as ambient context
(Explicit Context, ADR-0009). Confirm in the feature-design.

## 8. Auth and errors

- **himed:** `authDescriptor = { type: 'api_key', credentialDelivery: 'forwarded', fields: [{ key: 'api_key', placement: 'body' }] }`.
  The `placement: 'body'` is what does not exist today in `authentication-materializer.ts` → ADR.
- **himed-scheduling:** depends on Q1. Static token → `token` in body (+ `codigo_servicio` as non-secret
  metadata via `X-Provider-Metadata`). Per-request signed token → imperative variant (conditional ADR).
- **Errors** (glossary: never interpolate the provider `body` into the message): 401 → `PROVIDER_AUTH_EXPIRED`;
  406/417/404/207 → typed input/business error. HiMed's codes are its own (201 = success), to be normalized in
  `errors.ts` on top of `mapHttpStatusToErrorCode`.

## 9. Sandbox and round-trip proof

`add-provider` DoD: `server/discover` lists the provider with its `authDescriptor`; `tools/list` returns the
tools; `tools/call` runs a tool against the HiMed sandbox with a real token; a forced 401 returns
`PROVIDER_AUTH_EXPIRED`. HiMed's sandbox requires the **paid** key (Q2). Reference for the proven pattern:
`docs/design/siigo-read-only-provider/` (Colombia, read-only first, sandbox evidence).

## 10. Catalogs / data structure

HiMed publishes a downloadable file with catalogs and reference tables (document types, codes, valid values).
Needed to map fields (`tipo_documento`, etc.) in phase 1; download it and version it as provider reference.

## 11. CONTEXT.md

No new glossary terms resolved in this session (the decisions are feature-level, not domain vocabulary).

## 12. Scope refinement (2026-09-24)

Request credentials / build for **Autoagendamiento + Demográficos only**. The standalone **Doctores** and
**Sedes** APIs are **dropped** — Autoagendamiento already exposes `listarSedes` and `listarUsuarios`
(professionals, with `idUsuario` = the professional's document), so they are redundant for the booking flow.
(JuanJo flags the Doctors API as an advantage over SaludTools for enumerating professionals; that advantage is
already captured by `listarUsuarios`, so no separate credential is needed unless we later want richer doctor data.)

## 13. Learnings from SaludTools (backend epic #1053, JuanJo — transferable to HiMed)

SaludTools is the sibling Colombian clinical integration, one step ahead of us. Transferable findings:

- **Health vertical axis is shared, already built.** A `health` axis is registered on `feat/saludtools-connect`;
  HiMed registers as another `(health, himed)` pair in `register-vertical-scopes.ts` — the registry keys on the
  pair, nothing else changes. **Failure mode to avoid:** a provider with **no registered vertical scope is
  connectable but completely inert** (turn resolves to `null` scope, tools silently unused, nothing throws). So
  the backend track MUST register `(health, himed)`. Do **not** fold clinics into `booking`.
- **Credential is likely admin-only.** SaludTools issues admin/superadmin keys with no read-only option — the
  key can do anything staff can. If HiMed is the same, the **only** guard against an agent deleting a record is
  the gateway **not publishing destructive tools** in `tools/list`. → curate destructive tools out; confirm the
  key's scope with HiMed early.
- **Do not trust the portal — verify one live call per shape.** SaludTools' docs contradicted production in ~10
  places (enum with 3 documented / 12 live, an undocumented page-size ceiling, a "not found" returned as success
  with empty body). Comparison table: `docs/design/saludtools-provider/grill-notes.md` §6.
- **Create may return its id in an envelope, not the body.** Projecting a create like a read turned a successful
  registration into an error — with the patient already created → a retry makes a **duplicate**. Handle for `create_patient`.
- **Page-size ceiling.** SaludTools refuses > 20 while the gateway defaults to 25 → every paginated call failed
  until clamped. Check HiMed's ceiling early.
- **Execution context:** SaludTools injects nothing (one key = a company with several sites; site travels as an
  explicit per-call arg). HiMed is the same shape → **no `contextSchema`**, `idSede` explicit (consistent with §7).
- **MCP route fit SaludTools cleanly** (`credential_exchange` + `reference`, no core changes, no ADR). HiMed
  differs: its `api_key`-in-body needs the body-placement core change (§4) — HiMed's auth is the uglier one.

## 14. Next step

- **Provider track (mcp-server), now:** build the `himed` provider (Autoagendamiento + Demográficos) — the
  sandbox runs **without credentials**, so shapes can be verified now. Write the body-placement ADR alongside.
- **Backend track (xcale-backend), gated:** register `(health, himed)`, PHI curation, Rail A wiring. **Base off
  `dev` once `feat/saludtools-connect` merges** (it is 25 commits ahead, unmerged — do not stack on it). Tracked
  under epic #1053; Q4/Ley in #1055.
