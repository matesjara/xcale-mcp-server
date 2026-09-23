# SaludTools — grill notes (pre feature-design)

- **Status:** phases 1–2 built and green, and **the round-trip proof passes against production**
  (`production-evidence.md`) for everything that touches no patient. Working notes — **no PR yet**. Mateo's instruction (2026-09-21): build the whole
  integration, then ship it as **one** PR with everything in it.
- **Date:** 2026-09-21
- **Code target repo:** `xcale-mcp-server` (MCP provider); credentials in `xcale-backend` (Rail A).
- **Source:** SaludTools public developer portal (`https://developer.saludtools.com/`) and its published
  Postman collection (`/assets/IntegracionSaludtools.postman_collection.json`), both read 2026-09-21 —
  **plus calls made against production the same day** with a live clinic ApiKey (§6).
- **Vendor:** CareCloud S.A.S. (Colombia). SaludTools is its cloud clinical-records and scheduling product.
- **Tracker:** epic [xcale-backend#1054](https://github.com/matesjara/xcale-backend/issues/1054), a sibling of
  the integrations board's #1053 (HiMed) and #1039 (Dentalink). The blocking decision is
  [#1055](https://github.com/matesjara/xcale-backend/issues/1055), which gates all three.

> Working document. Records what was verified in the vendor's wire documentation, the decisions that follow
> from it, and the questions that must close before each phase is authorized.
>
> **Evidence discipline.** §2 is _Documented_ — what the vendor's portal and collection say. §6 is
> _Observed_ — what production actually answered. **Where they disagree, §6 wins**, and they disagree
> about ten things, listed at the end of §6; five of the ten would have shipped as defects.
>
> §2 is left standing rather than corrected in place on purpose: the gap between the two columns is the
> most useful thing this document records about SaludTools, and flattening it would hide how little the
> portal can be trusted for the modules nobody has called yet (phases 3 and 4).
>
> What is still unproven: every read that returns a real patient, and every write. The key we hold is a
> production clinic's with `role_admin`, and Q6 is open, so neither was attempted.

---

## 1. Scope

Integrate SaludTools so a clinic's xcale agent can, over WhatsApp, recognize a patient, tell them what
appointments they have, and book, move or cancel one against the clinic's real agenda — and, beyond that,
so the **whole SaludTools API is covered**, because a half-covered provider is a provider whose gaps
nobody can see from the outside.

**The integration is complete when every `eventType` and every parametric catalog SaludTools publishes has
a home here** — either as an agent tool, or as a control-plane operation the consumer drives and the agent
never sees (D5). Completeness is the goal; it is reached in phases, and each phase ships on its own
evidence.

What "complete" covers, from the collection: `PATIENT`, `APPOINTMENT`, `MEDICINE`, clinic history, exam
prescriptions, exam results, paraclinics, disability certificates (_incapacidades_), patient documents,
gynaecological history, personal history, family history, and the ~33 parametric catalogs.

## 2. Recon findings (Documented 2026-09-21)

1. **Two endpoints carry the whole API.**
   - Auth: `POST {host}/integration/authenticate/apikey/v1/`, body `{"key": "...", "secret": "..."}`.
     `key` is the API user — the literal string `STAKOA` followed by 24 characters; `secret` is the secret
     half. Both are issued from inside the SaludTools UI and can be created at any time.
   - Everything else: `POST {host}/integration/sync/event/v1/`, `Authorization: Bearer <access_token>`,
     body `{"eventType": ..., "actionType": ..., "body": {...}}`. A single RPC endpoint dispatched by two
     enum fields — the same shape as HiMed's `accion` dispatch.
   - One exception in the collection: document **upload** posts to `/integration/sync/event/documents/v1/`.
     Every other document operation (search, download) goes through the ordinary event endpoint.
2. **The auth response is a JWT.** `{"access_token": "<JWT>"}` — **wrong, see Q2**: production also
   returns `expires_in`, `refresh_token`, `scope`, `token_type` and `jti`, and the token lives ~6 days.
3. **Hosts are global, not per-clinic.** Production `https://saludtools.carecloud.com.co/`, QA
   `https://saludtools.qa.carecloud.com.co/`, dev `https://saludtools.dev.carecloud.com.co/` (the last two
   from the collection's variables). A clinic is identified by its credential, not by a subdomain — so a
   single pinned `tokenEndpoint` works, exactly as Siigo's does.
4. **Every response is wrapped, and the status lives inside the 200.**

   ```json
   {
     "id": null,
     "code": 200,
     "message": "Se consulta la informacion de  id: 2593842",
     "eventId": "3eb8d63a93be49d096c51f39b35d7bfd",
     "body": {}
   }
   ```

   `code` is a field in the body of an HTTP 200. This is the Toteat shape — a provider whose HTTP status
   does not, on its own, tell you whether the call worked — and it is why this provider needs a real
   `errors.ts` (§5). `eventId` is a per-call correlation id and is worth keeping in logs.

5. **SEARCH returns a Spring `Page`.** `body.content[]` plus `pageable`, `totalPages`, `totalElements`,
   `numberOfElements`, `first`, `last`, `size`, `number`, `empty`. `page` and `size` are **required**;
   omitting them is a 412. This maps cleanly onto `definePaginatedList`.
6. **Appointments name people by document, never by internal id.** An appointment carries
   `patientDocumentType` + `patientDocumentNumber` and `doctorDocumentType` + `doctorDocumentNumber`, plus
   `startAppointment` / `endAppointment` (`yyyy-MM-dd HH:mm`), `modality`
   (documented as `CONVENTIONAL` / `TELEMEDICINE` / `DOMICILIARY` — **wrong, see Q2's table**: twelve
   values live, and no `DOMICILIARY`), `stateAppointment`, `notificationState`
   (`ATTEND` / `NOT_ATTEND` / `NOT_RESPOND`), `appointmentType` (a free-text string), `clinic` (a numeric
   id) and `comment`. The appointment's own `id` is returned and is what READ, UPDATE and DELETE take.
7. **`appointment SEARCH` is a real filter.** It accepts any combination of the appointment fields,
   including a `startAppointment` / `endAppointment` window, the doctor, the patient, the clinic and the
   state — with mandatory pagination. This is the single most useful read in the API.
8. **The patient record carries `habeasData`** — a boolean the clinic records for "the patient authorized
   being contacted". The provider's own answer to a question our product has to ask before it messages
   anybody. See D4.
9. **Parametric catalogs are plain authenticated GETs**, `GET {host}/integration/parametric/{name}/v1/`,
   returning `[{id, name}]` — **only sometimes**: `states` and `attentionModality` key on a string
   `value`, and a paged catalog returns a bare flattened page with no envelope `code` at all. Some are
   paged (`?page=0`), and one takes a filter (`atcconcentration/v1/?principleact=10`). Full list in §4.
10. **There is no doctor directory and no availability endpoint.** Nothing in the portal or the collection
    lists the clinic's doctors, their schedules, their working hours, or free slots. This is the finding
    that shapes the whole design — see D3.
11. **Webhooks exist, but only as a manual UI setup.** The clinic turns them on inside SaludTools
    (Configuración › Integraciones › WebHooks), per event — Paciente and Agendamiento, each with create,
    update and delete — choosing the HTTP method, the destination URL, and optional URL params and headers.
    **There is no API to register or list them, and the payload shape is not documented** (Q5).
12. **Documented HTTP codes:** 200, 400, 401 (invalid or absent token), 404, 405, 412 (Precondition Failed —
    this is what validation errors use), 500. The docs claim the auth endpoint answers **500** for an
    invalid key or secret — **wrong, it answers 412** — and they never mention **429**, which production
    emits under a modest burst (§6).
13. **Nothing about SaludTools exists in any xcale repo today** — greenfield; no slug, no toolbox entry, no
    leftovers.

## 3. Decisions

- **D1 — One provider, slug `saludtools`.** Unlike HiMed, which was forced into two providers by two
  incompatible credential placements, SaludTools has exactly one auth scheme over exactly one endpoint. One
  `authDescriptor`, one catalog entry, one connection per clinic credential.

- **D2 — `credential_exchange` with `credentialDelivery: 'reference'`.** Forced, not preferred. The durable
  `key` + `secret` mints a short-lived JWT — the shape ADR 0010 was written for — and the durable half must
  never reach the Execution Engine. It is also the strategy ADR 0003's hard gate demands for a high-risk
  provider, and patient data is high-risk by any reading. Rail A mints and caches; the server receives a
  nonce and resolves it just in time. **SaludTools becomes the second pinned `credential_exchange` provider
  in xcale-backend** — the case that file already says it is waiting for (§8).

- **D3 — We publish the agenda, never "availability".** SaludTools knows which appointments are booked. It
  does not know when the clinic is open, how long a consultation lasts, which doctors take new patients, or
  which of them work Saturdays. Computing free slots would mean inventing all four inside our adapter — an
  adapter that is supposed to be thin — and fixing a business rule that two clinics would answer
  differently and both be right. So:
  - the provider exposes **`get_agenda`**: the booked intervals for a window, optionally narrowed by doctor
    or clinic — the _truth_;
  - the clinic's working hours, slot length and booking rules live in **that tenant's** agent instructions
    and knowledge base — the _policy_;
  - the agent reasons over the two and proposes a time.

  This is the platform boundary applied literally, and it is also what keeps `client.ts` an adapter.

- **D4 — `habeasData` is surfaced, never interpreted.** The read tools return it as the provider states it.
  Whether the agent may then message that patient is not a rule this adapter gets to make.

- **D5 — Complete coverage, but an agent does not hold a scalpel.** Every SaludTools operation gets built
  (§1). What differs is **who may call it**:
  - **Agent tools** — the agenda loop, the patient lookup, the catalogs, and the clinical _reads_ a service
    conversation can legitimately need.
  - **Control-plane operations** (`controlPlane: true`, ADR 0013 — dispatched by `tools/call`, **withdrawn
    from `tools/list`**) — the clinical _writes_: a clinic-history entry, a prescription, an exam result, a
    disability certificate, a medicine, a deleted patient. These exist in the API for system-to-system
    sync, not so a language model can decide to write in someone's medical record. The consumer performs
    them; the agent never chooses them.

  This replaces "do not build the clinical modules". Not building them left the integration incomplete and
  the reasoning invisible; `controlPlane` builds them and states the boundary in code, where a reviewer and
  the published `tools/list` both show it.

- **D6 — Field projection is per tool, allow-list, at author time.** Every tool returns the named fields its
  job needs and drops everything else, so a field SaludTools adds tomorrow does not leak by default. This is
  the control HiMed's grill recommended and never got to apply; it is permitted by _Fidelity over
  Unification_ (ADR 0009) because what is dropped is not signal for the job, and it is what makes D7 work.

- **D7 — `get_agenda` carries no patient identity at all.** Its projection keeps `startAppointment`,
  `endAppointment`, `doctorDocumentNumber`, `clinic`, `stateAppointment` and the appointment `id`, and drops
  every patient field. A booked interval with nobody's name on it is not personal data — so the tool that
  answers "when could I come in?" is not a read of other patients' records, and does not have to be refused
  in a patient-facing channel. This is a deliberate design move, not an accident of curation: the
  alternative (returning whole appointments and letting the consumer filter them) is exactly what
  xcale-backend#1020 refuses to do, and says why.

- **D8 — Identity policy is declared on every tool that touches a patient**, using the `identityPolicy`
  field that xcale-mcp-server#101 adds. `get_patient`, `list_patient_appointments`, `create_patient`,
  `update_patient`, the appointment writes and every clinical read are `subject-bound` on their
  patient-document fields; `get_agenda` and the catalogs declare nothing, because after D7 they reach
  nobody. **This makes #101 a hard dependency of the implementation** (§9) — a PHI provider whose tools
  cannot say whose data they reach is exactly the unguarded class #101 was written to close.

- **D9 — `PATIENT / SEARCH` is control-plane, not an agent tool.** It returns a paged list of the clinic's
  patients from partial filters — the one call in this API that hands back a stranger's record for a guessed
  name. It is built (completeness) and withdrawn from `tools/list` (D5). The agent's way to a patient is the
  document-number lookup.

## 4. The phases

Each phase is independently shippable and carries its own evidence. They all land in **one PR** at the end
(Mateo, 2026-09-21), so the phases are a build order and a review structure, not a PR sequence.

### Phase 1 — the agenda loop

All over `POST /integration/sync/event/v1/`.

| Tool                                       | eventType / actionType                    | Type                   | identityPolicy                                     |
| ------------------------------------------ | ----------------------------------------- | ---------------------- | -------------------------------------------------- |
| `mcp_saludtools_get_patient`               | `PATIENT` / `READ`                        | read                   | `subject-bound` (`documentType`, `documentNumber`) |
| `mcp_saludtools_create_patient`            | `PATIENT` / `CREATE`                      | **write**              | `subject-bound`                                    |
| `mcp_saludtools_update_patient`            | `PATIENT` / `UPDATE`                      | **write**              | `subject-bound`                                    |
| `mcp_saludtools_get_agenda`                | `APPOINTMENT` / `SEARCH`                  | read (paginated)       | _(none — D7)_                                      |
| `mcp_saludtools_list_patient_appointments` | `APPOINTMENT` / `SEARCH`                  | read (paginated)       | `subject-bound` (`patientDocumentNumber`)          |
| `mcp_saludtools_get_appointment`           | `APPOINTMENT` / `READ`                    | read                   | `subject-bound`                                    |
| `mcp_saludtools_create_appointment`        | `APPOINTMENT` / `CREATE`                  | **write**              | `subject-bound`                                    |
| `mcp_saludtools_update_appointment`        | `APPOINTMENT` / `UPDATE`                  | **write**              | `subject-bound`                                    |
| `mcp_saludtools_cancel_appointment`        | `APPOINTMENT` / `UPDATE` or `DELETE` (Q4) | **write**              | `subject-bound`                                    |
| `mcp_saludtools_search_patients`           | `PATIENT` / `SEARCH`                      | **control-plane** (D9) | `subject-scoped`                                   |
| `mcp_saludtools_delete_patient`            | `PATIENT` / `DELETE`                      | **control-plane**      | `subject-bound`                                    |
| `mcp_saludtools_delete_appointment`        | `APPOINTMENT` / `DELETE`                  | **control-plane**      | `subject-bound`                                    |

- `get_agenda` and `list_patient_appointments` are the **same** provider call with different curation and a
  different identity policy. That is the point of D7, and it is worth the second tool.
- **Cancel is an open question, not a choice yet (Q4):** `DELETE` removes the appointment; `UPDATE` to a
  cancelled `stateAppointment` keeps it with an audit trail. Which one a clinic wants is close to policy,
  but which one SaludTools actually honours is a wire fact we do not have.

### Phase 2 — the catalogs

The clinic-facing ones the agent needs, as agent tools: `clinics`, `documents` (document types), `states`
(appointment states), `genders`, `eps`, `treatmenareatype` (specialties), `attentionModality`,
`encounterreasontype`.

The rest exist to make the later phases' payloads writable, and are reached the same way:
`principleact`, `commercialname`, `atcconcentration` (takes `?principleact=`), `intakemethod`,
`frequencyunit`, `durationunit`, `encountercommonid`, `configurationclinichistoryid`,
`examprescriptiontype`, `medicalexamtype`, `remissioncontainerid`, `externalcause`, `diagnosticcie10`,
`diagnosticClasification`, `diagnosticType`, `eyestype`, `diabetesType`, `evaluationenum`,
`inabilityworktype`, `contraceptivetype`, `friendlyname`, `personalantecedentsgroup`,
`antecedentspersonal`, `familiarRelationshipType`.

Open shape question for the feature-design: **one `get_catalog` tool over an enum of names, or one tool
per catalog?** One tool keeps `tools/list` readable and the adapter thin; per-catalog tools give the agent
better descriptions. Decided once we can see whether the payloads are uniform (several are paged, one is
filtered — so they are not). Leaning: one agent-facing `get_catalog` over the eight clinic-facing names,
and the long tail as control-plane, because an agent has no business paging CIE-10.

### Phase 3 — clinical reads · **gated on Q6**

`MEDICINE` read and read-last, clinic history read, exam prescription read, exam results read and search,
paraclinics read, gynaecological history read, personal history read, family history read and search,
documents search and download.

All `subject-bound`. All projected (D6). This is the phase that puts real clinical PHI into the LLM
context, so **Q6 must be answered before it is written**, not before it is shipped.

### Phase 4 — clinical writes · **control-plane, all of them**

`MEDICINE` create, update, delete; clinic history create; exam prescription create; exam results create;
paraclinics create; disability certificate create; document create (`/integration/sync/event/documents/v1/`);
gynaecological, personal and family history create.

Withdrawn from `tools/list` by D5. Built so the surface is complete and a consumer can drive a sync; never
offered to an agent.

### Phase 5 — webhooks · **gated on Q5**

A receiver for the patient and scheduling events the clinic switches on in its own SaludTools UI. Deferred
until a payload has been observed, and it belongs in xcale-backend (the server is stateless and has no
tenant to route an event to), so it is a cross-repo phase, not a provider one.

## 5. Auth and errors

```ts
// Shape only — the expiry field is Q2, and the contract is not written until it closes.
export const saludtoolsAuth: ProviderAuthDescriptor = {
  type: 'credential_exchange',
  credentialDelivery: 'reference',
  tokenEndpoint: 'https://saludtools.carecloud.com.co/integration/authenticate/apikey/v1/',
  method: 'POST',
  bodyFields: { key: 'key', secret: 'secret' }, // logical == wire, as Siigo pins it
  responseFields: { token: 'access_token' /*, expiry: ? — Q2 */ },
  tokenPlacement: 'bearer_header',
};
```

Errors — the provider misreports twice, and `errors.ts` has to know both:

- **`code` inside a 200.** Every call unwraps the envelope and reads `code` before trusting the body
  (finding 4). The envelope's `message` is Spanish vendor prose and is **never interpolated into a tool
  error** (repo glossary rule); the error carries the HTTP status and the code.
- **500 means "wrong credentials" at the auth endpoint** (finding 12). A mint that 500s is
  `PROVIDER_AUTH_EXPIRED`, not a provider outage — otherwise a clinic that rotated its key sees "SaludTools
  is down" and nobody reconnects. Rail A owns the mint path, so **this is a cross-repo fact, not only
  ours** (§8).
- 401 on a data call → `PROVIDER_AUTH_EXPIRED` → the backend marks the connection and the agent asks the
  clinic to reconnect.
- 412 → typed input error. 404 → not found. The mapping is pinned by fixtures once Q1 unblocks recording.

## 6. Open questions

> **A production ApiKey arrived 2026-09-21** (a real clinic's, `role_admin`/`role_superadmin`), and it
> closed Q1, Q2, Q4, Q7, Q8 and Q9 and corrected four documented "facts". What it did **not** unlock is
> any read of a real patient: the key is production and Q6 is still Mateo's. Verification stayed to
> calls that touch nobody — the mint, the catalogs, an empty agenda window, and error probes.

- **Q1 — ANSWERED (2026-09-21). A production key, not a sandbox.** It mints on
  `saludtools.carecloud.com.co`; **QA rejects it** (`412`, "La llave es invalida para generar el
  token"), so `saludtools.qa.carecloud.com.co` needs its own credential and the sandbox request
  (`sandbox-access-request.md`) is **still worth sending** — arguably more so now, because the only key
  we hold is a live clinic's with admin scope.
  - The JWT's `client_id` names the tenant and its `scope` is `role_admin` + `role_superadmin`. **There
    is no read-only scope on offer**, so the credential a clinic hands us can do anything its staff can.
    That is an argument for the control-plane withdrawals (D5) carrying real weight rather than being
    tidiness: the gateway is the only thing standing between an agent and a delete.
- **Q2 — ANSWERED. The mint returns far more than the docs say.**
  `{access_token, token_type, refresh_token, expires_in, scope, jti}`, and the token lives **~6 days**
  (`exp - iat` = 518400s). `responseFields.expiry` is now `expires_in` in both repos. No ADR was needed
  after all (§10 holds). `refresh_token` is deliberately unused — Rail A already holds the ApiKey.
- **Q3 — ANSWERED. The envelope `code` mirrors the HTTP status**, and the vendor uses `412` for every
  input problem, an unknown patient included. Plus two statuses its docs do not list at all: **`429`**
  (seven catalog reads in quick succession — the rate ceiling is real and undiscoverable from the docs)
  and the `412` on the mint. A 401 answers with a bare JSON string, not an envelope.
- **Q4 — ANSWERED. Cancel is an UPDATE.** The live `states` catalog carries `CANCELLED`,
  `CANCELLED_BY_DOCTOR` and `RESCHEDULED`, so a cancellation is recorded rather than erased.
  `delete_appointment` stays control-plane: a deleted appointment is a fact the clinic can no longer
  audit, and it never needed to be the way to cancel.
- **Q5 — still open · webhooks.** Configured by hand in the clinic's own SaludTools UI, payload
  undocumented. Phases 1–4 stay pull-only.
- **Q6 — STILL OPEN, AND NOW THE BINDING ONE · security and legal. Filed as [xcale-backend#1055](https://github.com/matesjara/xcale-backend/issues/1055).** It stopped being theoretical the
  moment a production key of a real clinic arrived. Patient names, documents, phone numbers, birth
  dates and EPS would enter the LLM context and the stored conversation; Ley 1581 treats health data as
  _sensitive_ and a US-hosted model raises consent and residency questions. D6 and D7 shrink the
  surface; they do not answer it. **No patient record has been read.** This is Mateo's call, it is the
  same item HiMed's grill raised and never closed, and one answer covers both.
- **Q7 — ANSWERED for this tenant.** One ApiKey = one `company` (18662 here) which may hold several
  sites; this clinic has exactly one, id `17688` — a five-digit id, not the docs' example `8`. `clinic`
  stays an explicit tool argument, which is what a multi-site clinic will need anyway.
- **Q8 — ANSWERED, and D3 stands.** `APPOINTMENT/SEARCH` accepts a date window with **no doctor and no
  patient**. `get_agenda` is possible exactly as designed.
- **Q9 — ANSWERED. The nested `pageable` is correct**; the top-level `page`/`size` on the vendor's
  _Buscar citas_ page is wrong. The Postman collection won, which is the general lesson: where the
  prose and the executable artifact disagree, believe the artifact — then verify it.
- **Q10 — ANSWERED (2026-09-22). Only `EXAMS_RESULTS` (plural) exists.** Production rejects the
  singular with "No se ha enviado un tipo de evento valido", so the vendor's collection has a typo on
  its exam-result READ. Settled in `client.ts`.
- **Q11 — ANSWERED (2026-09-22). It is `ANTECEDENT_PERSONAL`.** Production answers it with "El evento
  read requiere en id" — a complaint about the body, so the dispatcher knows the type; `PERSONAL_HISTORY`
  and `PERSONAL_ANTECEDENT` are both rejected as unknown. Asked with a document that cannot exist, so
  no record was read.
- **Q12 — NEW, gates phase 3 · a `402` means "not found".** `INABILITYWORK` and `PATIENT_FILES` report a
  missing record with envelope `code: 402`. The shared map sends 402 to `PROVIDER_ERROR`, so a phase-3
  tool that ignores it will call a missing record a provider malfunction — the defect already fixed once
  for patients. Recorded, not coded: no tool reaches those modules yet.
- **Q13 — NEW · three of the documented "catalogs" are per-patient reads.** `encountercommonid`,
  `remissioncontainerid` and `antecedentspersonal` all demand a `documentType`. Removed from the catalog
  enum and moved to phase 3, where they belong.

### What the documentation got wrong, in one place

Worth keeping as a list, because it sets how much the rest of the portal is worth:

| The docs say                                               | Production says                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Mint returns `{access_token}`                              | Also `expires_in`, `refresh_token`, `scope`, `token_type`, `jti`                                        |
| Invalid key → `500`                                        | `412`, with a readable envelope message                                                                 |
| `modality` ∈ {CONVENTIONAL, TELEMEDICINE, **DOMICILIARY**} | Twelve values, and **no `DOMICILIARY`**                                                                 |
| Appointment search paginates with top-level `page`/`size`  | Nested `pageable: {page, size}`                                                                         |
| Catalogs return `[{id, name}]`                             | Some return `[{value, name}]`; paged ones return a bare flattened page with no `code`                   |
| Statuses: 200/400/401/404/405/500                          | Also `412` for all input errors and `429` for rate limiting                                             |
| Patient has 13 attributes                                  | Also `address`, and an internal `id`                                                                    |
| Nothing about a page-size limit                            | **A page over 20 is refused** (`412`), and the gateway's default is 25 — so every paginated call failed |
| An unknown patient is a `412`                              | **HTTP 200, `code: 200`, `body: null`** — a success with nothing in it, and a different sentence        |
| QA and production share credentials                        | QA **rejects** this production key (`412`), so the sandbox needs its own                                |

Ten now, and **five would have shipped as defects**. Two were caught by the unit tests; three more
only by running the thing end to end against the real provider (`production-evidence.md`) — including
one that was not the vendor's fault at all: `identityPolicy` never reached the wire, so the PHI
protection this whole design leans on was declared and never published.

The pattern is worth naming, because it will repeat on the next provider: **every defect that
survived the unit tests lived in a seam** — between the documented shape and the real one, between
the core's pagination defaults and the provider's ceiling, between a provider's `listTools()` and the
protocol's serialisation of it. A test that mocks the other side of a seam cannot see the seam.

## 7. Environments

The pinned `tokenEndpoint` is production. QA (`saludtools.qa.carecloud.com.co`) is where the round-trip
proof will run. Because the endpoint is pinned in **two** places for security (here and in xcale-backend's
`credential-exchange-providers.ts`), the QA host must arrive as a **deployment** value read in
non-production configs only — never as a per-tenant or catalog-sourced field, which is precisely the
repointing attack the backend pins against. Settled in the feature-design.

## 8. Cross-repo footprint (xcale-backend)

Small, and already anticipated by the code:

1. `src/modules/mcp/toolboxes.ts` — one data entry (`saludtools`, category, features, logo).
2. `src/modules/connections/credential-exchange-providers.ts` — one pinned entry: the mint descriptor
   mirroring §5, `connectFields` of `[{ key: 'key', type: 'text' }, { key: 'secret', type: 'secret' }]`, and
   `accountKeyField: 'key'`. That file says in its own header that the machinery is generic and waiting for
   a second provider; this is it.
3. The golden test that pins `bodyFields` and the `tokenEndpoint` host across the two repos gains a case.
4. `assets/saludtools.svg` in xcale-mcp-server.
5. The "500 means bad credentials" mapping (§5) has to hold on Rail A's mint path too.
6. Phase 5's webhook receiver, when Q5 closes.

Filed as a consumer issue by URL, through `/cross-repo` — **provider before consumer**.

## 9. Dependencies — resolved in-branch, not waiting

Both halves of the PHI protection were open PRs, and neither could merge on our timetable (Mateo,
2026-09-22). Waiting would have meant shipping a provider whose safety argument was a promise, so both
were **merged into these branches** rather than waited on.

| Dependency                                                            | Where it is now                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **xcale-mcp-server#101** — _a tool publishes whose data it can reach_ | Merged into `docs/saludtools-integration`. Its wire half was missing entirely and is fixed here (§12).             |
| **xcale-backend#1020** — _an agent serves the person writing to it_   | Merged into `feat/saludtools-connect`, plus a test pinning SaludTools' real published policies through its loader. |

**Merged, not reimplemented** — on purpose. Copying the few lines we needed would have put the same fix
in two branches, which is how one bug gets fixed twice and then conflicts. A merge shares ancestry, so
whichever lands first the other reconciles by itself.

The cost is stated plainly for the reviewer: `feat/saludtools-connect` carries #1020's 49 files, and
`docs/saludtools-integration` carries #101's. Ours are the SaludTools module, the protocol line, and the
two registration data entries.

Still external, still blocking: **Q1's sandbox key** (QA rejects the production one) and **Q6**.

## 10. ADRs

**None expected** — and that is the headline difference from HiMed. SaludTools needs no new credential
placement, no signed auth and no core change: `credential_exchange` + `reference` + `bearer_header` already
exist and are proven by Siigo. The provider should land inside the `add-provider` golden rule, touching only
`src/providers/saludtools/` plus the asset and the generic config.

Two things _could_ force one: Q2, if we decide the descriptor must learn to read a token's expiry (prefer
the answer that does not); and phase 5, if the webhook receiver needs a shape the backend does not have.

## 11. CONTEXT.md

No new glossary terms. _Clinic_, _patient_, _appointment_ and _agenda_ are either already in the domain
vocabulary or are the provider's own words, used as such.

## 12. Build status (2026-09-22)

**Built, green, and PROVEN end to end** — `add-provider`'s Definition of Done is met for the phases that
exist: `server/discover` → `tools/list` → `tools/call` against the real provider, plus both forced
auth-failure paths, all passing. Transcript and caveats: `production-evidence.md`.

- `src/providers/saludtools/` — manifest, auth descriptor, client, `errors.ts`, `projections.ts`,
  `catalogs.ts`, `tools.ts`, provider factory, one line in `src/providers/index.ts`, plus
  `assets/saludtools.svg`. Inside the `add-provider` golden rule: **no file under `src/core`,
  `src/protocol` or `src/auth` was touched**, so no exceptional ADR is owed (§10 holds).
- **Phases 1 and 2 are implemented**: the nine agent tools of the agenda loop and the catalog read,
  plus four control-plane operations (`search_patients`, `delete_patient`, `delete_appointment`,
  `get_reference_catalog`).
- **Phases 3 and 4 are not**, and the reason is evidence, not effort — the file header of `tools.ts`
  says it in place: the clinical reads cannot be field-projected because the vendor documents no
  response body for them, and the clinical writes cannot be typed because their request bodies exist
  as single nested examples (5.4 KB for a clinical history) with no field table saying what is
  required. Both unblock with Q1 and one recorded round trip per module.
- **Tests:** 82 across four files (three provider, one protocol), green — including `__tests__/observed.test.ts`, which pins each
  place production contradicted the documentation so a future "cleanup" toward the tidier documented
  version goes red. The repo's full suite is 366/366 with this branch in. `tsc --noEmit` clean, Prettier
  clean; the repo's full suite 373/373.
- **Verified live (production, zero patient records read, nothing written):** the mint and its real
  response shape; a wrong key’s status; six catalogs; a paged catalog; an appointment search over an
  empty window with nested pagination and no doctor filter; the rate ceiling, found by hitting it; and
  the whole `reference` credential path end to end, including both ways it can fail.
- **One thing the proof needed that the repo cannot do:** `scripts/contract-probe.mjs` builds the app
  with `credentialResolveUrl: ''`, so it cannot drive ANY `reference` provider past credential
  resolution — not this one, not Siigo. The proof ran on a scratch harness with a stub Credential
  Authority. A `--resolve-url` flag would close it; filed for matesjara/xcale-harness#20, not done here
  because `scripts/` is outside this provider's blast radius.
- **Five defects were found, and where each hid is the lesson.** Two by the unit tests (an unwrap that
  never read the envelope on a transport failure; `definePaginatedList` not forwarding `controlPlane`).
  Three more only by running it end to end: the documented `modality` enum, which would have rejected
  every modality a real clinic uses; the page-size ceiling, which broke **every** paginated call; and a
  missing patient reported as a provider malfunction. Plus one that was not this provider's at all —
  `identityPolicy` never reached the wire, so the protection this design leans on was declared and
  unpublished. **Every one of them lived in a seam**, which is exactly where a mocked test cannot look.
- **It TOUCHES `src/protocol`**, against the add-provider golden rule and deliberately: the wire mapping
  had to grow one line for `identityPolicy` to reach a consumer. That is the other half of
  xcale-mcp-server#101, which took the same exception for `src/core` and recorded it in its commit
  rather than an ADR; this follows that precedent. Nothing else changes — a consumer that ignores the
  field sees the menu it always saw (additive, ADR 0001). **Say it out loud in the PR**: a reviewer
  scanning for the golden rule should find the reasoning, not the violation.
- **The consumer half is still missing.** xcale-backend's `McpToolDef` has no `identityPolicy` field and
  nothing reads one; that is PR #1020. Until it merges, the declarations travel and nobody acts on them.
- **What is NOT done and must be before this ships:** phases 3–4 (blocked on Q6 and on shapes that can
  only be seen by reading real clinical records), the api-contract, and a patient-facing read proven
  against anything.

## 13. Next step

The build is no longer the blocker. What is left is one decision and one credential.

1. **[#1055](https://github.com/matesjara/xcale-backend/issues/1055) to Mateo — the only thing between
   this and a shippable integration.** Everything that touches no patient is built, green and proven
   against production. Every read that returns a patient waits on his answer, and so does phase 3. Filed
   as one decision covering SaludTools, HiMed (#1053) and Dentalink (#1039), because HiMed's grill asked
   the same thing in September and nobody answered it three times over.
2. **Send the sandbox request** (`sandbox-access-request.md`). QA rejects the key we have, and the only
   credential we hold is a live clinic's with `role_admin` — not a thing to keep a test suite pointed at.
3. **When Q6 lands:** record a patient read and a populated agenda page (QA if the sandbox arrives,
   otherwise one consented patient with his say-so), replace the documented fixtures with recordings,
   and re-run the proof with those calls added.
4. **Then** the api-contract on observed responses, then phases 3–4, then the feature-design if it still
   earns its place beside these notes.
5. One PR with everything (Mateo, 2026-09-21) — and say in its body that it carries #101 and #1020,
   so a reviewer knows which diff is ours (§9).

**Standing constraints for anyone picking this up:**

- **No writes against this key.** `role_admin` on a real clinic — a "test" appointment is a real
  appointment in a real doctor's diary.
- **No patient reads until Q6.** The safe probes are the four in `production-evidence.md`.
- **The credential belongs in Doppler**, not in a file, a fixture or a commit. The one we were handed
  arrived over chat and should be rotated once it is in real use.
