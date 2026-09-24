# SaludTools — round-trip proof (production, 2026-09-21 · 22 · 24)

The `add-provider` Definition of Done, executed: `server/discover` lists the provider with its
descriptor, `tools/list` returns the tools an agent would see, `tools/call` runs real tools against the
real provider, and a forced auth failure comes back as `PROVIDER_AUTH_EXPIRED`.

**Run against SaludTools PRODUCTION** with a client clinic's ApiKey — QA rejects that key, so there was
no other environment to run it in (see `grill-notes.md` §6 Q1).

**Zero patient records were read, and nothing was written** — in the first run, below. The calls are a
catalog, a paged catalog, an agenda window in 1990, and a lookup for a document nobody holds. That is
a deliberate constraint: the key carries `role_admin`/`role_superadmin` on a live clinic and the Ley
1581 question (§6 Q6) is still open.

Two later runs (09-22 and 09-24) did write, each authorised for that run, each reversible, each
undone and verified. **No existing record of the clinic was ever read, written or deleted**: every
write acted on one synthetic patient this integration created and then removed. The two sections at
the end record them call by call.

## How it was run

`scripts/contract-probe.mjs` — the repo's own probe, and what the `mcp-contract-qa` gate reports on —
**cannot drive this provider**. It builds the app with `credentialResolveUrl: ''`, so a
`credential_exchange` + `reference` provider dies at credential resolution before any tool runs. The
same is true of Siigo, which is why no Siigo `tools/call` evidence exists either.

So the proof was run with a throwaway harness that stands up a stub Credential Authority answering the
documented Hop-B contract (`POST {resolveUrl}` + `{reference}` → `{token}`; `422` → reconnect required)
and points the real app at it. That exercises **more** than the probe would: nonce → resolve →
materialize → provider → typed result, the whole `reference` path.

**The gap is worth closing.** A `--resolve-url` flag on `contract-probe.mjs` would let the gate prove
any `reference` provider, and today it can prove none of them. Not done here: it is `scripts/`, outside
this provider's blast radius, and it belongs with matesjara/xcale-harness#20. The harness itself was a
scratch file and is not committed — this transcript is the evidence it produced.

## The transcript

```
## 1. Mint (real, production)
  PASS  minted (HTTP 200), expires_in=518399s, fields=[access_token, expires_in, jti, refresh_token, scope, token_type]

## 2. server/discover
  PASS  listed: SaludTools · healthcare · 9 tools · auth credential_exchange
  PASS  credentialDelivery: reference
  PASS  descriptor declares expires_in
  PASS  no contextSchema — a clinic travels as an explicit argument

## 3. tools/list (what an agent actually receives)
  PASS  9 saludtools tools published
      - mcp_saludtools_get_patient · no identityPolicy
      - mcp_saludtools_create_patient · no identityPolicy
      - mcp_saludtools_update_patient · no identityPolicy
      - mcp_saludtools_get_agenda · no identityPolicy
      - mcp_saludtools_list_patient_appointments · no identityPolicy
      - mcp_saludtools_get_appointment · no identityPolicy
      - mcp_saludtools_create_appointment · no identityPolicy
      - mcp_saludtools_update_appointment · no identityPolicy
      - mcp_saludtools_get_catalog · no identityPolicy
  PASS  all four control-plane tools withdrawn from the published menu

   (raw JSON-RPC view - what xcale-backend actually parses)
      - mcp_saludtools_get_patient · identityPolicy=subject-bound
      - mcp_saludtools_create_patient · identityPolicy=subject-bound
      - mcp_saludtools_update_patient · identityPolicy=subject-bound
      - mcp_saludtools_get_agenda · NONE
      - mcp_saludtools_list_patient_appointments · identityPolicy=subject-bound
      - mcp_saludtools_get_appointment · identityPolicy=subject-scoped
      - mcp_saludtools_create_appointment · identityPolicy=subject-bound
      - mcp_saludtools_update_appointment · identityPolicy=subject-bound
      - mcp_saludtools_get_catalog · NONE
  PASS  get_agenda publishes no identityPolicy (it carries no patient identity)
  PASS  get_patient publishes subject-bound ON THE WIRE
  PASS  6 tools publish subject-bound on the wire

## 4. tools/call — live, and touching no patient record
  PASS  get_catalog(clinics) → {"ok":true,"data":[{"id":17688,"name":"<clinic name redacted>","company":18662,"deleted":null}]}
  PASS  get_catalog(specialties) paged → {"ok":true,"data":{"content":[{"id":1,"name":"AREA 1"},{"id":2,"name":"AREA 2"},{"id":3,"name":"Ginecología"},…
  PASS  get_agenda (empty 1990 window) → {"ok":true,"data":{"items":[],"page":1,"pageSize":25,"totalPages":0,"totalResults":0,"hasMore":false}}
  PASS  get_patient(nonexistent) → found:false, not an error

## 5. Forced auth failures
  PASS  a token SaludTools rejects → PROVIDER_AUTH_EXPIRED
  PASS  Rail A says 422 (revoked) → PROVIDER_AUTH_EXPIRED

(Rail A was called 6 times — one resolve per tools/call, nothing cached.)

## Verdict
  ALL CHECKS PASSED — round-trip proof complete.
```

## Read the two `tools/list` views side by side

They are the same call, parsed two ways, and the difference is the most important thing on this page.

The **SDK client** shows `no identityPolicy` on every tool. The **raw JSON-RPC** view shows six
`subject-bound` declarations. Both are accurate: the MCP SDK's `ToolSchema` is a plain `z.object`, so
its typed client strips any field the spec does not name. xcale-backend does not use that client — it
posts bare JSON-RPC and reads the response as JSON (`modules/mcp/mcp-client.ts`) — so the field reaches
the real consumer.

Anyone verifying this by hand through the SDK will see nothing and conclude the fix does not work.

## What this run found

Three defects, none of which any unit test could have caught, because each lived in a seam:

1. **`identityPolicy` never reached the wire.** `src/protocol/mcp-server.ts` built each published tool
   as `{name, description, inputSchema}` and dropped the policy. xcale-mcp-server#101 added the field,
   forwarded it through `provider-factory` and `definePaginatedList`, and pinned it with tests that read
   `provider.listTools()` — the in-process object, one layer short of the wire. So every declaration was
   true and none of it left the building, which is exactly the failure #101's own commit message
   describes. **Fixed here**, with a protocol test that asserts the wire shape.

   The consumer half — `McpToolDef` carrying the field and the loader validating it — is PR #1020's,
   which cannot merge on our timetable. It is **merged into `feat/saludtools-connect`** instead, with a
   test there that pins these exact published policies through the loader using the bytes below. The
   chain is complete across the two branches; neither is waiting on the other.

2. **Every paginated call failed.** The gateway's default page size is 25; SaludTools refuses anything
   over 20 (`"La cantidad maxima de elementos a consultar debe ser menor a 20"` — a 412 the docs never
   mention). Now clamped. The message is off by one: `size: 20` is accepted, which is why the ceiling
   was measured rather than read.

3. **A patient who does not exist looked like a provider malfunction.** Production answers an unknown
   document with **HTTP 200, `code: 200`, `body: null`** and the sentence _"No se encontro un paciente
   con los datos suministrados"_ — not the `412` the vendor's docs show, and not the sentence they show
   either. The prose marker written from the documentation never fired, and the tool returned
   `PROVIDER_ERROR`. The signal is structural now (a success with an empty body); the prose is the
   fallback, and it matches both sentences.

## Read-only exploration, 2026-09-22

A second pass, still touching no patient record: every documented catalog path, and every clinical
`eventType`, called with identifiers that cannot match anything. The dispatcher's own error text is
the answer — "recognised" vs "no such event type" — and no record comes back either way.

### All 32 catalog paths

Twenty-eight answered `200`. The other four did not, and three of them are a structural finding:

| Path                   | Answer                                                        | What it means                                            |
| ---------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| `encountercommonid`    | `412 Required String parameter 'documentType' is not present` | **Not a catalog.** A per-patient read on a catalog's URL |
| `remissioncontainerid` | same                                                          | **Not a catalog**                                        |
| `antecedentspersonal`  | same                                                          | **Not a catalog**                                        |
| `atcconcentration`     | `412 Required Long parameter 'principleact' is not present`   | A catalog, but its filter is mandatory                   |

The three per-patient ones are removed from the enum: left in, they would have been dead options
offered to an agent, every call a 412. They belong to phase 3, gated on Q6. `atcconcentration` now
refuses locally with a message naming the field, rather than spending a round trip to be told.

Shapes, which are more varied than the docs suggest: `[{id,name}]` for most, `[{value,name}]` for
`states`, `attentionModality`, `examprescriptiontype`, `medicalexamtype` and `evaluationenum`,
`[{code,name}]` for `diagnosticcie10`, and a third field (`description`, `ripsCode`, `active`) on
five more. Sizes worth knowing before an agent is let near them: `commercialname` 219,777 entries and
`diagnosticcie10` 12,618, both paged ten at a time — which is why they are control-plane.

### The clinical eventTypes

| eventType                                                                                                                                                   | Verdict                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `MEDICINE`, `CLINIC_HISTORY`, `EXAMS_PRESCRIPTION`, `EXAMS_RESULTS`, `PARACLINICS`, `INABILITYWORK`, `PATIENT_FILES`, `GYNECOOBS_HISTORY`, `FAMILY_HISTORY` | recognised                                                                                                 |
| **`EXAM_RESULTS`** (singular)                                                                                                                               | **does not exist** — "No se ha enviado un tipo de evento valido"                                           |
| **`ANTECEDENT_PERSONAL`**                                                                                                                                   | **exists** — "El evento read requiere en id", a complaint about the body, so the dispatcher knows the type |
| `PERSONAL_HISTORY`, `PERSONAL_ANTECEDENT`                                                                                                                   | do not exist                                                                                               |

That closes **Q10** (the vendor's collection has a typo: only the plural `EXAMS_RESULTS` is real) and
**Q11** (the personal-history module's eventType is `ANTECEDENT_PERSONAL`, despite having no entry in
the collection at all). Both are settled in `client.ts`.

### Two more things to carry into phase 3

- **A `402` in the envelope means "not found".** `INABILITYWORK` and `PATIENT_FILES` both answer a
  missing record with `code: 402` — HTTP's "Payment Required", used as a not-found marker. The shared
  status map sends 402 to `PROVIDER_ERROR`, so **a phase-3 tool that does not handle it will report a
  missing record as a provider malfunction** — the exact defect already fixed once for patients.
  Recorded here rather than coded now, because no tool calls those modules yet.
- **A third wording for "no such patient":** "No existe paciente con ese tipo y numero de
  documentacion en la compañia", used by the clinical modules. Added to the marker, which now matches
  all three sentences the vendor uses for one condition.

### Rate limiting, measured — and re-measured, much lower

The first pass hit `429` after roughly 35 calls in 40 seconds, and the mint itself was throttled for
about a minute afterwards. At 3.5s between calls nothing was refused. There is no `Retry-After`.

**That ceiling was wrong, and optimistic.** On 2026-09-24 a read-only probe was refused after **seven
calls spaced four seconds apart** — one mint and six reads, about 24 seconds of traffic. Spacing does
not buy what the first measurement suggested, so whatever the limit counts, it is not a simple
per-second rate.

Worse for planning: **the mint came back `429` on a fresh attempt minutes later, before this session
had made any call at all.** It did so again on a second run. The only reading that fits is that the
quota is shared and something else is spending it — the clinic's own integrations, most likely, since
this is a live clinic's ApiKey and we are not its only consumer.

Two consequences, and neither is a code change here:

- **An agent that fans out reads in one turn will be refused.** Reading the eight agent-facing catalogs
  is already eight calls. The catalogs are per-clinic configuration that changes rarely, so the place
  to hold them is the consumer's cache, not a retry loop in a stateless gateway.
- **A shared ceiling is not ours to raise.** `PROVIDER_RATE_LIMITED` is the honest answer and the
  adapter should keep giving it. Asking CareCloud what the limit actually is belongs with the sandbox
  request (#1057) — it is the same conversation and the same silence so far.

## The write path, run and undone — 2026-09-22

Authorised on the condition that every write be reversible, and run **step by step by hand rather than
by script**, so the exact inventory was known at every moment. The ladder: prove the undo on the
cheapest object before risking anything else.

| #   | Call                                                         | Result                                                         |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| 1   | `PATIENT/READ` doc `999999901`                               | absent — **the document was free before anything was created** |
| 2   | `PATIENT/CREATE`                                             | `{"id": 6923470, "code": 200, "body": null}`                   |
| 3   | `PATIENT/READ`                                               | the full record back, `habeasData` intact                      |
| 4   | `PATIENT/DELETE` → `READ`                                    | **verified gone** — the undo works                             |
| 5   | `APPOINTMENT/SEARCH` 2024–2026                               | **0 appointments in three years**                              |
| 6   | `APPOINTMENT/CREATE`, patient absent                         | refused: the patient must exist first                          |
| 7   | `PATIENT/CREATE` → `APPOINTMENT/CREATE`                      | refused: **no such doctor**                                    |
| 8   | `PATIENT/DELETE` → `READ` → `SEARCH` surname → `SEARCH` 2030 | **0, 0, 0**                                                    |

**The clinic is exactly as it was found.** Nothing created survived, and the final sweep says so from
three directions.

### The defect this found

**A successful creation was being reported as a provider malfunction.** A create answers with the new
id in the **envelope** and `body: null` — the mirror image of a read, where the record is in `body` and
the envelope id is null. All four write tools projected `body` exactly like the reads do, got null, and
returned `PROVIDER_ERROR` with the patient already created. An agent told its call failed retries, and
**creates a duplicate patient in a real clinic**.

No unit test caught it because none covered a create response at all — the fixtures were reads.

### The finding that matters more than the test

**Booking needs a doctor's identity document, and SaludTools publishes no way to discover one.** A
create is refused with _"No se ha encontrado ningun medico … revisa que el usuario se encuentre
registrado o activo"_. There is no doctor directory endpoint, and the agenda — the only other place a
doctor's document appears — is **empty for this account across three years**.

So: **a clinic must supply its doctors' identity documents as configuration.** That is an onboarding
requirement nobody had written down, it applies to HiMed and Dentalink if their APIs are shaped the
same way, and it is a precondition for the booking loop working at all — not a code change.

It is also why the booking write remains unproven: not permission, and not effort. There was no doctor
to book with.

### Two more wordings for "no such patient"

A fourth and fifth: _"No se ha encontrado ningun paciente en saludtools con el tipo y número de
documento enviado"_ (from `APPOINTMENT/CREATE`) and the doctor equivalent. Deliberately **not** added to
`isPatientNotFound`: on a booking these are genuine caller-fixable input errors, not an answer, and
`412 → PROVIDER_INVALID_INPUT` is already right.

## The write path again, to close what the first run left open — 2026-09-24

Three unknowns survived the 2026-09-22 run, and each of them was a way the integration could
misbehave in a live clinic. Same conditions: every write reversible, **by hand, one call at a time**,
with the inventory checked between each — never a script, because a script knows what it was told to
undo and a person knows what exists.

| #   | Call                                                | Result                                                                                          |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | `PATIENT/READ` doc `999999901` · `SEARCH` surname   | absent · **0 matches** — the document was free and nothing was left over from 09-22             |
| 2   | `PATIENT/CREATE`                                    | `{"id": 6929503, "code": 200, "message": "Se registra el paciente id: 6929503", "body": null}`  |
| 3   | `PATIENT/CREATE` **again, same document**           | `{"id": null, "code": 412, "message": "Ya existe un paciente … Id:6929503", "body": null}`      |
| 4   | `PATIENT/UPDATE` — phone, and `habeasData` → `true` | `{"id": 6929503, "code": 200, "message": "Se actualiza el paciente id: 6929503", "body": null}` |
| 5   | `PATIENT/READ`                                      | both changes landed                                                                             |
| 6   | `PATIENT/DELETE`                                    | `{"code": 200, "message": "Se elimina el paciente id: 6929503"}`                                |
| 7   | `PATIENT/READ` · `SEARCH` surname                   | `body: null` · **0 matches** — verified gone from two directions                                |

**The clinic is exactly as it was found**, for the second time. No appointment was created: there is
still no doctor document to book with (#1062).

### 1. A duplicate create is refused — the unknown that mattered most

`written()` carried a warning that this was unobserved, and that if SaludTools silently created a
second record, an agent retrying after a timeout would duplicate a patient in a real clinic.

**It does not.** SaludTools enforces uniqueness on (`documentType`, `documentNumber`) and refuses the
second create outright. The retry hazard that shaped the create path does not exist.

What it exposed instead is a shape problem. A `412` is `PROVIDER_INVALID_INPUT`, and the vendor's
prose is stripped before a caller sees it — so the agent was told **it sent bad input**. It had not:
it sent a real person who is already registered, and the vendor even handed back their id. The two
readings lead opposite ways — re-ask for the document, versus carry on and book the appointment — and
an agent given the wrong one loops on a form the patient already filled in correctly.

`create_patient` now answers `{created: false, alreadyExists: true, patientId}`. The id travels; the
Spanish sentence that carried it does not. Same move already made for "no such patient", one step
further along the same conversation.

### 2. A delete answers with no body and no id

`{"code": 200, "message": "Se elimina el paciente id: 6929503"}` — the thinnest envelope this provider
sends. Read the way the read tools read, that is a success carrying `null`: the caller cannot tell a
completed deletion from an empty answer. Both delete tools now report `{deleted: true}`.

### 3. `habeasData` is writable through the API

The update set it from `false` to `true` and the read-back confirmed it. That matters for Ley 1581
(#1055): the consent flag is not a read-only field the clinic maintains in its own UI — an agent with
`update_patient` can change a patient's recorded consent. Whether it ever should is the tenant's
policy and, more likely, a legal question; that it _can_ is now a fact the decision has to account
for, rather than an assumption.

Three fixtures were recorded from this run — `observed-patientDuplicate412.json`,
`observed-patientUpdated200.json`, `observed-patientDeleted200.json` — and the first two are the only
tests in the module that exercise a write refusal and an update at all.

## What it did NOT prove

- **Any read that returns a real patient.** Not run, on purpose (Q6).
- **The booking write.** The patient writes are proven (the two runs above); `APPOINTMENT/CREATE` is
  not, and cannot be until the clinic supplies a doctor's identity document (#1062). It is the one
  write that puts something in a real doctor's diary, so it waits for a clinic that agrees to the
  slot, not for a spare moment.
- **Phases 3–4** (clinical reads and writes). Still unbuilt — their response shapes are undocumented and
  cannot be observed without reading real clinical records.
- **The QA host.** It rejects this key; a sandbox credential is still wanted
  (`sandbox-access-request.md`).

## Reproducing it

Mint a token, stand up a stub that returns it on `POST /internal/credentials/resolve`, build the app
with `credentialResolveUrl` pointing at the stub, and drive `/mcp` over JSON-RPC. The tool calls that
are safe to repeat against production are exactly the four above. **Do not add a patient read to this
list without an answer to Q6**, and do not add a write at all.
