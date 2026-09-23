# SaludTools — round-trip proof (production, 2026-09-21/22)

The `add-provider` Definition of Done, executed: `server/discover` lists the provider with its
descriptor, `tools/list` returns the tools an agent would see, `tools/call` runs real tools against the
real provider, and a forced auth failure comes back as `PROVIDER_AUTH_EXPIRED`.

**Run against SaludTools PRODUCTION** with a client clinic's ApiKey — QA rejects that key, so there was
no other environment to run it in (see `grill-notes.md` §6 Q1).

**Zero patient records were read, and nothing was written.** The calls are a catalog, a paged catalog,
an agenda window in 1990, and a lookup for a document nobody holds. That is a deliberate constraint:
the key carries `role_admin`/`role_superadmin` on a live clinic and the Ley 1581 question (§6 Q6) is
still open.

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

### Rate limiting, measured

The first pass hit `429` after roughly 35 calls in 40 seconds, and the mint itself was throttled for
about a minute afterwards. At 3.5s between calls nothing was refused. There is no `Retry-After`.

## What it did NOT prove

- **Any read that returns a real patient.** Not run, on purpose (Q6).
- **Any write.** Not run, and not to be run against this key: `role_admin` on a live clinic, where a
  "test" appointment is a real appointment in a real doctor's diary.
- **Phases 3–4** (clinical reads and writes). Still unbuilt — their response shapes are undocumented and
  cannot be observed without reading real clinical records.
- **The QA host.** It rejects this key; a sandbox credential is still wanted
  (`sandbox-access-request.md`).

## Reproducing it

Mint a token, stand up a stub that returns it on `POST /internal/credentials/resolve`, build the app
with `credentialResolveUrl` pointing at the stub, and drive `/mcp` over JSON-RPC. The tool calls that
are safe to repeat against production are exactly the four above. **Do not add a patient read to this
list without an answer to Q6**, and do not add a write at all.
