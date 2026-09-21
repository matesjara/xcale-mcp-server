# SaludTools — grill notes (pre feature-design)

- **Status:** alignment (grill). This PR ships the grill notes only; the ADR, the feature-design and the
  api-contract are follow-ups.
- **Date:** 2026-09-21
- **Code target repo:** `xcale-mcp-server` (MCP provider); credentials in `xcale-backend` (Rail A).
- **Source:** SaludTools public developer portal (`https://developer.saludtools.com/`) and its published
  Postman collection (`/assets/IntegracionSaludtools.postman_collection.json`), both read 2026-09-21.
- **Vendor:** CareCloud S.A.S. (Colombia). SaludTools is its cloud clinical-records and scheduling product.

> Working document. Records what was verified in the vendor's wire documentation, the decisions that follow
> from it, and the questions that must close before the feature-design is authorized.
>
> **Evidence discipline.** Everything in §2 is *Documented* — read from the vendor's own portal and
> collection. Nothing here is *Observed*: no call has been made against SaludTools, because we hold no
> credential (Q1). Per `add-provider`, an unobserved wire fact **defers the api-contract**; it does not
> enter it provisionally. §2 is good enough to design against and **not** good enough to ship against.

---

## 1. Scope

Integrate SaludTools so a clinic's xcale agent can, over WhatsApp, recognize a patient, tell them what
appointments they have, and book, move or cancel one against the clinic's real agenda.

**In scope (candidate):** patients (read, create, update), appointments (read, search, create, update,
delete), and the parametric catalogs those two need (clinics, document types, appointment states, genders,
EPS, specialties).

**Out of scope, deliberately:** clinical history, clinical laboratories, paraclinics, exam prescriptions
and results, medicine prescriptions, disability certificates (*incapacidades*), patient documents, and the
gynaecological / personal / family history modules. The API exposes all of them; **we do not build them.**
They are deep clinical PHI with no scheduling or service job to do, and every tool we publish is a door.
See D5.

## 2. Recon findings (Documented 2026-09-21)

1. **Two endpoints carry the whole API.**
   - Auth: `POST {host}/integration/authenticate/apikey/v1/`, body `{"key": "...", "secret": "..."}`.
     `key` is the API user — the literal string `STAKOA` followed by 24 characters; `secret` is the secret
     half. Both are issued from inside the SaludTools UI and can be created at any time.
   - Everything else: `POST {host}/integration/sync/event/v1/`, `Authorization: Bearer <access_token>`,
     body `{"eventType": ..., "actionType": ..., "body": {...}}`. A single RPC endpoint dispatched by two
     enum fields — the same shape as HiMed's `accion` dispatch.
   - One exception in the collection: document upload posts to `/integration/sync/event/documents/v1/`.
     Out of scope (D5), so it does not concern us.
2. **The auth response is a JWT.** `{"access_token": "<JWT>"}`. The token carries an `exp` claim and the
   portal states it expires and must be re-minted. **Whether the JSON also carries an `expires_in` or
   equivalent expiry field is not documented** — see Q2.
3. **Hosts are global, not per-clinic.** Production `https://saludtools.carecloud.com.co/`, QA
   `https://saludtools.qa.carecloud.com.co/`, dev `https://saludtools.dev.carecloud.com.co/` (the last two
   from the collection's variables). A clinic is identified by its credential, not by a subdomain — so a
   single pinned `tokenEndpoint` works, exactly as Siigo's does.
4. **Every response is wrapped, and the status lives inside the 200.**

   ```json
   { "id": null, "code": 200, "message": "Se consulta la informacion de  id: 2593842",
     "eventId": "3eb8d63a93be49d096c51f39b35d7bfd", "body": { } }
   ```

   `code` is a field in the body of an HTTP 200. This is the Toteat shape — a provider whose HTTP status
   does not, on its own, tell you whether the call worked — and it is why this provider needs a real
   `errors.ts` (§5).
5. **SEARCH returns a Spring `Page`.** `body.content[]` plus `pageable`, `totalPages`, `totalElements`,
   `numberOfElements`, `first`, `last`, `size`, `number`, `empty`. `page` and `size` are **required**;
   omitting them is a 412. This maps cleanly onto `definePaginatedList`.
6. **Appointments name people by document, never by internal id.** An appointment carries
   `patientDocumentType` + `patientDocumentNumber` and `doctorDocumentType` + `doctorDocumentNumber`, plus
   `startAppointment` / `endAppointment` (`yyyy-MM-dd HH:mm`), `modality`
   (`CONVENTIONAL` / `TELEMEDICINE` / `DOMICILIARY`), `stateAppointment`, `notificationState`
   (`ATTEND` / `NOT_ATTEND` / `NOT_RESPOND`), `appointmentType` (a free-text string), `clinic` (a numeric
   id) and `comment`. The appointment's own `id` is returned and is what READ, UPDATE and DELETE take.
7. **`appointment SEARCH` is a real filter.** It accepts any combination of the appointment fields,
   including a `startAppointment` / `endAppointment` window, the doctor, the patient, the clinic and the
   state — with mandatory pagination. This is the single most useful read in the API.
8. **The patient record carries `habeasData`** — a boolean the clinic records for "the patient authorized
   being contacted". The provider's own answer to a question our product has to ask before it messages
   anybody. See D4.
9. **Parametric catalogs are plain authenticated GETs**, `GET {host}/integration/parametric/{name}/v1/`,
   returning `[{id, name}]`. The ones this scope needs: `clinics`, `documents` (document types), `states`
   (appointment states), `genders`, `eps`, `treatmenareatype` (specialties). Some are paged (`?page=0`).
10. **There is no doctor directory and no availability endpoint.** Nothing in the portal or the collection
    lists the clinic's doctors, their schedules, their working hours, or free slots. This is the finding
    that shapes the whole design — see D3.
11. **Webhooks exist, but only as a manual UI setup.** The clinic turns them on inside SaludTools
    (Configuración › Integraciones › WebHooks), per event — Paciente and Agendamiento, each with create,
    update and delete — choosing the HTTP method, the destination URL, and optional URL params and headers.
    **There is no API to register or list them, and the payload shape is not documented** (Q5).
12. **Documented HTTP codes:** 200, 400, 401 (invalid or absent token), 404, 405, 412 (Precondition Failed —
    this is what validation errors use), 500. Notably, **the auth endpoint answers 500 for an invalid key
    or secret**, not 401 (§5).
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
    or clinic — the *truth*;
  - the clinic's working hours, slot length and booking rules live in **that tenant's** agent instructions
    and knowledge base — the *policy*;
  - the agent reasons over the two and proposes a time.

  This is the platform boundary applied literally, and it is also what keeps `client.ts` an adapter.

- **D4 — `habeasData` is surfaced, never interpreted.** The read tools return it as the provider states it.
  Whether the agent may then message that patient is not a rule this adapter gets to make.

- **D5 — The clinical modules are not built.** See §1. Declining to publish a tool is the cheapest and most
  durable PHI control we have, and re-adding one later is additive (ADR 0001) — removing one is not.

- **D6 — Field projection is per tool, allow-list, at author time.** Every tool returns the named fields its
  job needs and drops everything else, so a field SaludTools adds tomorrow does not leak by default. This is
  the control HiMed's grill recommended and never got to apply; it is permitted by *Fidelity over
  Unification* (ADR 0009) because what is dropped is not signal for the job, and it is what makes D7 work.

- **D7 — `get_agenda` carries no patient identity at all.** Its projection keeps `startAppointment`,
  `endAppointment`, `doctorDocumentNumber`, `clinic`, `stateAppointment` and the appointment `id`, and drops
  every patient field. A booked interval with nobody's name on it is not personal data — so the tool that
  answers "when could I come in?" is not a read of other patients' records, and does not have to be refused
  in a patient-facing channel. This is a deliberate design move, not an accident of curation: the
  alternative (returning whole appointments and letting the consumer filter them) is exactly what
  xcale-backend#1020 refuses to do, and says why.

- **D8 — Identity policy is declared on every tool that touches a patient**, using the `identityPolicy`
  field that xcale-mcp-server#101 adds. `get_patient`, `list_patient_appointments`, `create_patient`,
  `update_patient` and the appointment writes are `subject-bound` on their patient-document fields;
  `get_agenda` and the catalogs declare nothing, because after D7 they reach nobody. **This makes #101 a
  hard dependency of the implementation** (§9) — a PHI provider whose tools cannot say whose data they
  reach is exactly the unguarded class #101 was written to close.

- **D9 — No `search_patients`.** SaludTools offers `PATIENT` / `SEARCH` with partial filters and pagination —
  a paged list of the clinic's patients. There is no job in scope that a document-number lookup does not do,
  and it is the one call in this API that hands back a stranger's record for a guessed name. Left unbuilt.

## 4. Proposed tools

Phase 1 — read and the booking loop. All over `POST /integration/sync/event/v1/` unless noted.

| Tool | eventType / actionType | Type | identityPolicy |
|---|---|---|---|
| `mcp_saludtools_get_patient` | `PATIENT` / `READ` | read | `subject-bound` (`documentType`, `documentNumber`) |
| `mcp_saludtools_create_patient` | `PATIENT` / `CREATE` | **write** | `subject-bound` |
| `mcp_saludtools_update_patient` | `PATIENT` / `UPDATE` | **write** | `subject-bound` |
| `mcp_saludtools_get_agenda` | `APPOINTMENT` / `SEARCH` | read (paginated) | *(none — D7)* |
| `mcp_saludtools_list_patient_appointments` | `APPOINTMENT` / `SEARCH` | read (paginated) | `subject-bound` (`patientDocumentNumber`) |
| `mcp_saludtools_get_appointment` | `APPOINTMENT` / `READ` | read | `subject-bound` |
| `mcp_saludtools_create_appointment` | `APPOINTMENT` / `CREATE` | **write** | `subject-bound` |
| `mcp_saludtools_update_appointment` | `APPOINTMENT` / `UPDATE` | **write** | `subject-bound` |
| `mcp_saludtools_cancel_appointment` | `APPOINTMENT` / `UPDATE` or `DELETE` | **write** | `subject-bound` |
| `mcp_saludtools_list_clinics` | `GET parametric/clinics` | read | *(none)* |
| `mcp_saludtools_list_catalogs` | `GET parametric/*` | read | *(none)* |

Notes:

- `get_agenda` and `list_patient_appointments` are the **same** provider call with different curation and a
  different identity policy. That is the point of D7, and it is worth the second tool.
- **Cancel is an open question, not a choice yet (Q4):** `DELETE` removes the appointment; `UPDATE` to a
  cancelled `stateAppointment` keeps it with an audit trail. Which one a clinic wants is close to policy,
  but which one SaludTools actually honours is a wire fact we do not have.
- `list_catalogs` may end up as one tool over an enum, or several. Decided in the feature-design once we can
  see whether the payloads are uniform.
- **No `delete_patient`.** `PATIENT` / `DELETE` exists. An agent must never hold it.

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

- **Q1 — BLOCKING EVERYTHING · commercial and access.** *We have no credential and no sandbox.* The key is
  minted from inside a SaludTools account, so we cannot get one without a clinic that has one, or a
  CareCloud partner conversation. Nothing can be recorded, no fixture is legitimate, and `add-provider`'s
  round-trip proof cannot be run. **Until this closes, this integration can be designed and cannot be
  built.**
  - Sub-question, and the same one HiMed answered on 2026-09-15: **who pays, and who holds the key?** The
    HiMed precedent says the clinic pays and xcale is only the integrator. Unless Mateo says otherwise, the
    same answer should hold here, for the same reason.
  - Worth asking early: does CareCloud run a partner programme? The QA host exists and is public. If it is
    reachable with a QA-only key, the whole build unblocks without a production clinic. **This is the single
    highest-value thing to find out**, and Cloudbeds is the cautionary tale — a partner agreement, not code,
    gated that integration for weeks.
- **Q2 — blocking the contract · wire.** Does the auth response carry an expiry field beside `access_token`?
  If not, `responseFields.expiry` is omitted and Rail A has no declared lifetime to cache against. The JWT's
  own `exp` claim is right there, but the descriptor is *strictly declarative* by ADR 0010 and does not
  parse tokens. Decide: omit expiry and let a 401 drive the re-mint, or teach the descriptor an expiry
  source. **The second option touches shared code and would need its own ADR** — prefer the first if the
  re-mint cost is one extra call per expiry window.
- **Q3 — blocking the contract · wire.** Which `code` values does the envelope use for failures inside a
  200? Only `200` has been seen. The whole error mapping rests on this.
- **Q4 — product and wire.** Cancel by `DELETE`, or by `UPDATE` to a cancelled state? Needs the `states`
  catalog (is there a cancelled state at all?) and a clinic's opinion on whether a cancelled appointment
  should survive in the record. Leaning `UPDATE` — a deleted appointment is a lost fact — but Q1 gates it.
- **Q5 — product · webhooks.** Webhooks are configured by hand in the clinic's own SaludTools UI and their
  payload is undocumented (finding 11). Two consequences: **onboarding a clinic includes a human clicking
  through twelve steps**, and we cannot design a receiver against an unknown body. Phase 1 should be
  **pull-only** — the agent reads when it needs to — with webhooks deferred to their own phase, on observed
  payloads. Reminders are the use case that will eventually want them.
- **Q6 — security and legal, and not solved by code.** Patient names, documents, phone numbers, birth dates
  and EPS enter the LLM context and the stored conversation. Ley 1581 (Colombian habeas data) treats health
  data as *sensitive*, and sending it to a US-hosted model has consent and residency implications. D6 and D7
  shrink the surface; they do not answer the question. **This is Mateo's call, and it is the same open item
  HiMed's grill raised (its Q4) and never closed** — one answer should cover both, and it should come before
  either provider carries real patient data in production, not after.
- **Q7 — wire.** Does one API key span several clinics? The appointment's numeric `clinic` field and the
  `clinics` catalog both suggest yes. If it does, `clinic` is an explicit tool argument (Explicit Context,
  ADR 0009) rather than ambient context — but `accountContextKeys` and the connect form depend on the
  answer.
- **Q8 — wire.** Does `appointment SEARCH` accept a date window with no doctor and no patient? `get_agenda`
  (D3) is built on the assumption that it does. If it does not, the agent must pass a doctor — and then it
  needs a doctor directory the API does not have (finding 10), which the tenant would have to supply as
  configuration. **The design does not fall over, but D3 gets noticeably worse.** Test this first.

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

Filed as a consumer issue by URL, through `/cross-repo` — **provider before consumer**.

## 9. Dependencies

| Dependency | Where | Why it blocks |
|---|---|---|
| **xcale-mcp-server#101** — *a tool publishes whose data it can reach* | open PR against `dev` | D8. Without `identityPolicy`, every patient tool ships unguarded. Must merge before the provider's code. |
| **xcale-backend#1020** — *an agent serves the person writing to it* | open PR | The consumer half. Nothing enforces D8 until this lands. Its own description names #101 as merging first. |
| **Q1** — a credential | external | No evidence, no contract, no fixtures, no round-trip proof. |

These notes are written on `origin/dev` and depend on neither PR, so they can merge independently.

## 10. ADRs

**None expected** — and that is the headline difference from HiMed. SaludTools needs no new credential
placement, no signed auth and no core change: `credential_exchange` + `reference` + `bearer_header` already
exist and are proven by Siigo. The provider should land inside the `add-provider` golden rule, touching only
`src/providers/saludtools/` plus the asset and the generic config.

The one thing that *could* force an ADR is Q2, if we decide the descriptor must learn to read a token's
expiry. Prefer the answer that does not.

## 11. CONTEXT.md

No new glossary terms. *Clinic*, *patient*, *appointment* and *agenda* are either already in the domain
vocabulary or are the provider's own words, used as such.

## 12. Next step

1. **Chase Q1** — it gates the build, and it is the long-lead item. A CareCloud or SaludTools partner key,
   or a QA key, is the unblock; a customer clinic with an account is the fallback.
2. Put **Q6** in front of Mateo together with HiMed's Q4 — one decision, two providers.
3. With a key in hand: record Q2, Q3, Q4, Q7 and Q8 against QA, then authorize `/feature-design`, then
   `/api-contract-authoring` on observed responses only.
4. Implementation stacks on #101.
