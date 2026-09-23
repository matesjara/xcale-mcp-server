# SaludTools Provider — API Contract

- **Provider slug:** `saludtools` · **Vendor:** CareCloud S.A.S. (Colombia)
- **Scope of this contract:** phases 1–2 — the agenda loop and the catalogs. Phases 3–4 (clinical reads
  and writes) are designed in `grill-notes.md` §4 and **deliberately absent here**: their response
  shapes are undocumented and cannot be observed without reading real clinical records.
- **Evidence:** `production-evidence.md`. Everything in §A is **Observed** against production on
  2026-09-21/22 unless a line says otherwise, and every line marked _Documented-only_ is a vendor claim
  we have not been able to confirm — several of its neighbours turned out to be false.

> **Contract discipline.** This document exists because the vendor's portal contradicts production in
> ten places (`grill-notes.md` §6). Nothing here was copied from the portal without a call behind it,
> except where explicitly flagged.

---

## 0. The deltas that matter most

| The portal says                           | Production says                                                                          | Consequence for this contract                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Mint returns `{access_token}`             | `{access_token, token_type, refresh_token, expires_in, scope, jti}`; token lives ~6 days | `responseFields.expiry = 'expires_in'` (§B)                      |
| Invalid key → `500`                       | `412`, envelope message _"La llave es invalida para generar el token"_                   | Rail A must read it as a credential problem, not an outage (§E)  |
| `modality` ∈ 3 values incl. `DOMICILIARY` | 12 values, **no `DOMICILIARY`**                                                          | `modality` is a string against the catalog, never an enum (§C.1) |
| Pagination via top-level `page`/`size`    | Nested `pageable: {page, size}`, **`size` ≤ 20**                                         | §A.5                                                             |
| Catalogs return `[{id, name}]`            | Some return `[{value, name}]`; paged ones return a bare flattened page with no `code`    | Two unwraps (§A.6)                                               |
| Unknown patient → `412`                   | **HTTP 200, `code: 200`, `body: null`**                                                  | Not an error — `{found: false}` (§C.2)                           |
| Statuses 200/400/401/404/405/500          | Also `412` for every input error and `429` for rate limiting                             | §D                                                               |

---

## A. SaludTools external API — Observed wire surface

### A.1 Base + transport

| Environment | Host                                      | Status                                                           |
| ----------- | ----------------------------------------- | ---------------------------------------------------------------- |
| Production  | `https://saludtools.carecloud.com.co`     | Observed                                                         |
| QA          | `https://saludtools.qa.carecloud.com.co`  | **Rejects our production key** (`412`); needs its own credential |
| Dev         | `https://saludtools.dev.carecloud.com.co` | _Documented-only_ (collection variable)                          |

**One host serves every clinic**, so the environment is a deployment choice and nothing else. The
provider reads `SALUDTOOLS_BASE_URL` (optional; unset = production) — set it to the QA host in Doppler
`dev`/`stg` and leave it unset in `prd`. Without it a non-production deployment calls a real clinic's
live records, because a tenant's credential reaches this server identically in every environment. It
is a DEPLOYMENT value, never per-tenant and never catalog-sourced: the same host is pinned in
xcale-backend for the mint, and a network-sourced host is the repointing attack pinning exists to stop.

Two endpoints carry everything in scope:

- `POST /integration/authenticate/apikey/v1/` — the mint.
- `POST /integration/sync/event/v1/` — every patient and appointment operation, dispatched by
  `eventType` + `actionType` in the body.
- `GET /integration/parametric/{name}/v1/` — the reference catalogs.

`Content-Type: application/json`; `Authorization: Bearer <access_token>` on everything but the mint.

### A.2 Authentication (mint) — Observed

```http
POST /integration/authenticate/apikey/v1/
{"key": "STAKOA…", "secret": "…"}
```

`key` is the literal prefix `STAKOA` plus 24 characters; both halves are minted by the clinic inside its
own SaludTools account. Response (200):

```json
{
  "access_token": "<RS256 JWT>",
  "token_type": "bearer",
  "refresh_token": "…",
  "expires_in": 518399,
  "scope": ["role_admin", "role_superadmin"],
  "jti": "…"
}
```

- **Lifetime ~6 days** (`exp - iat` = 518400s).
- **`scope` is admin.** SaludTools offers no read-only credential: whatever a clinic hands us can do
  anything its staff can. This is why the control-plane withdrawals in §C are load-bearing.
- **`refresh_token` is not used** — Rail A already holds the durable ApiKey.
- **Invalid key/secret → `412`**, not the documented 500.

### A.3 Event envelope — Observed

Every event response, success or failure:

```json
{ "id": null, "code": 200, "message": "…", "eventId": "<uuid-ish>", "body": {} }
```

- `code` is **inside** the body of an HTTP 200; the transport status alone never decides.
- `message` is Spanish operator prose that interpolates record ids. **It never reaches a tool result.**
- `eventId` is an opaque per-call correlation id, safe to log and to quote in an error.
- **`body: null` on a READ means the record does not exist** (§C.2).

### A.4 Event dispatch — the values in scope

| eventType     | actionType          | Notes                                              |
| ------------- | ------------------- | -------------------------------------------------- |
| `PATIENT`     | `READ`              | body `{documentType, documentNumber}`              |
| `PATIENT`     | `CREATE` / `UPDATE` | the full patient record                            |
| `PATIENT`     | `SEARCH`            | partial filters + `pageable`; control-plane        |
| `PATIENT`     | `DELETE`            | control-plane                                      |
| `APPOINTMENT` | `READ`              | body `{id}`                                        |
| `APPOINTMENT` | `SEARCH`            | any combination of appointment fields + `pageable` |
| `APPOINTMENT` | `CREATE` / `UPDATE` | `UPDATE` takes `id`                                |
| `APPOINTMENT` | `DELETE`            | control-plane                                      |

Other `eventType` values exist (`MEDICINE`, `CLINIC_HISTORY`, `EXAMS_PRESCRIPTION`, `EXAM_RESULTS` /
`EXAMS_RESULTS`, `PARACLINICS`, `INABILITYWORK`, `PATIENT_FILES`, `GYNECOOBS_HISTORY`,
`FAMILY_HISTORY`) and are transcribed in `client.ts` — _Documented-only_, out of contract scope.

### A.5 Pagination — Observed

`pageable` is **nested** in the body, **0-based**, and **capped at 20**:

```json
"pageable": { "page": 0, "size": 20 }
```

- `size: 25` → `412 "La cantidad maxima de elementos a consultar debe ser menor a 20"`.
- `size: 20` is accepted, so the ceiling is 20 **inclusive** — the message is off by one.
- A SEARCH returns the full Spring `Page`: `content[]`, `pageable`, `totalPages`, `totalElements`,
  `numberOfElements`, `first`, `last`, `size`, `number`, `empty`.
- A window search with **no doctor and no patient** is accepted. This is what makes `get_agenda`
  possible at all.

### A.6 Catalogs — Observed, and not one shape

`GET /integration/parametric/{name}/v1/` answers with **no envelope**, in one of three shapes:

| Shape                       | Catalogs                                                        | Example                                                                           |
| --------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Bare array keyed on `id`    | `documents`, `genders`, `clinics`, `eps`, `encounterreasontype` | `[{"id":1,"name":"Cédula ciudadanía"}]`                                           |
| Bare array keyed on `value` | `states`, `attentionModality`                                   | `[{"value":"PENDING","name":"Pendiente"}]`                                        |
| Bare **flattened** page     | `treatmenareatype`, `diagnosticcie10`, … (the paged ones)       | `{"content":[…],"pageNumber":0,"pageSize":10,"totalElements":92,"totalPages":10}` |

Notes: `encounterreasontype` carries a third field (`ripsCode`); `clinics` carries `company` and
`deleted`; `atcconcentration` takes `?principleact=<id>`. Catalog names are used **verbatim**, typos
included (`treatmenareatype`, `diagnosticClasification`).

### A.7 Rate limiting — Observed, undocumented

Seven catalog reads in quick succession returned **`429` with an empty body**. The portal's status table
does not mention 429. No `Retry-After` was returned.

---

## B. `authDescriptor` — published in the catalog, non-secret

```ts
{
  type: 'credential_exchange',
  credentialDelivery: 'reference',
  tokenEndpoint: 'https://saludtools.carecloud.com.co/integration/authenticate/apikey/v1/',
  method: 'POST',
  bodyFields: { key: 'key', secret: 'secret' },   // logical == wire
  responseFields: { token: 'access_token', expiry: 'expires_in' },
  tokenPlacement: 'bearer_header',
}
```

- `reference`, not `forwarded`: forced by the shape (a durable credential minting a usable one) **and**
  by ADR 0003's hard gate, which admits `forwarded` only for standard-risk providers.
- No `staticHeaders` — SaludTools has no institutional header.
- No `connectionProbe` — a `credential_exchange` provider proves its credential by minting.
- No `contextSchema` — see §C.1 on `clinic`.
- The backend mirrors this descriptor in `modules/connections/credential-exchange-providers.ts`; a
  golden test pins the pair across the two repos.

---

## C. MCP tool contract — the published surface

### C.1 Published tools (the agent's menu)

| Tool                                       | Input (beyond pagination)                                                                  | `identityPolicy`                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `mcp_saludtools_get_patient`               | `documentType`, `documentNumber`                                                           | `subject-bound` (`documentNumber`)        |
| `mcp_saludtools_create_patient`            | the patient record; **`habeasData` required**                                              | `subject-bound` (`documentNumber`)        |
| `mcp_saludtools_update_patient`            | the patient record                                                                         | `subject-bound` (`documentNumber`)        |
| `mcp_saludtools_get_agenda`                | `startAppointment`, `endAppointment`, opt. `doctorDocument*`, `clinic`, `stateAppointment` | _(none — carries no identity)_            |
| `mcp_saludtools_list_patient_appointments` | `patientDocumentType`, `patientDocumentNumber`, opt. window + state                        | `subject-bound` (`patientDocumentNumber`) |
| `mcp_saludtools_get_appointment`           | `id`                                                                                       | `subject-scoped`                          |
| `mcp_saludtools_create_appointment`        | times, patient, doctor, `modality`, `clinic`, opt. state/type/comment                      | `subject-bound` (`patientDocumentNumber`) |
| `mcp_saludtools_update_appointment`        | the above + `id`, opt. `notificationState`                                                 | `subject-bound` (`patientDocumentNumber`) |
| `mcp_saludtools_get_catalog`               | `catalog` (enum of 8), opt. `page`                                                         | _(none)_                                  |

**Withdrawn from `tools/list`, callable by name (`controlPlane: true`, ADR 0013):**
`mcp_saludtools_search_patients` (a paged walk of the clinic's patient list),
`mcp_saludtools_delete_patient`, `mcp_saludtools_delete_appointment`,
`mcp_saludtools_get_reference_catalog` (the 24 clinical catalogs).

Input rules:

- **`modality` is a string, not an enum**, validated against the `attentionModalities` catalog. The
  documented three-value enum would have rejected every modality a real clinic uses. `notificationState`
  is a string for the same reason — three documented values, no catalog confirming them.
- **`clinic` is an explicit argument**, not ambient context (Explicit Context, ADR 0009). One ApiKey = one
  `company`, which may hold several sites; promoting it to context later is additive, demoting it is not.
- Datetimes are `yyyy-MM-dd HH:mm` in the **clinic's local time**, validated by regex so a caller's
  mistake is a typed input error rather than a 412 that does not say which field it disliked.
- **`habeasData` is required on create.** Absent, it would mean both "nobody asked" and "they said no",
  and those call for opposite behaviour. A default would silently pick one.
- Pagination is the gateway's uniform 1-based `page`/`pageSize`, translated to SaludTools' 0-based
  `pageable` and clamped to 20.
- **`update_appointment` takes the WHOLE appointment**, not a patch: read it first, then resend every
  field with the edit applied. Whether a partial body is accepted is untested — settling it needs an
  UPDATE call, which is a write, and no write has been made against a live clinic.
- **Cancelling is `update_appointment`** with the cancelled `stateAppointment` from the catalog, not
  `delete_appointment` (which is control-plane). A cancelled appointment stays auditable; a deleted
  one does not.

### C.2 Output

Success payloads are **projected** — an allow-list per tool, so a field the vendor adds does not leak by
default (`projections.ts`).

- `get_patient` → `{found: true, patient}` or **`{found: false}`**. Not finding a patient is an answer,
  not an error: the agent's next move is to offer to register them.
- `get_appointment` → `{found: true, appointment}` or `{found: false}`.
- `get_agenda` → the uniform `PaginatedResult`, items projected to
  `{id, startAppointment, endAppointment, doctorDocumentType, doctorDocumentNumber, modality, stateAppointment, clinic}`
  — **no patient field, and deliberately not `comment` or `appointmentType`**, both free text whose own
  published examples carry a person's name.
- `list_patient_appointments` → the uniform `PaginatedResult` with the full appointment.
- `get_catalog` → the vendor's own shape, verbatim (array or flattened page). Not unified: inventing
  `id`s for the `value`-keyed catalogs would produce ids no appointment accepts.

### C.3 Consumer guidance

- **Read the catalogs first.** `clinic`, `documentType`, `gender`, `eps`, `modality` and
  `stateAppointment` are all catalog values, and the catalogs are per-clinic configuration.
- **SaludTools publishes no availability and no doctor directory.** `get_agenda` returns what is
  _booked_. Opening hours, appointment length and which doctors take new patients are the tenant's own
  configuration and belong in its agent instructions — not in this contract and not in the adapter.
- **`habeasData` is surfaced, never interpreted.** Whether the agent may then message that patient is
  the tenant's rule and, where Ley 1581 speaks, the law's.

---

## D. Error mapping

| Condition                                             | Wire                                     | `ProviderErrorCode`                 |
| ----------------------------------------------------- | ---------------------------------------- | ----------------------------------- |
| Invalid/absent token on a data call                   | HTTP 401 (bare JSON string body)         | `PROVIDER_AUTH_EXPIRED`             |
| Rail A reports the durable credential revoked         | resolve → 422                            | `PROVIDER_AUTH_EXPIRED`             |
| Any input problem                                     | `412` (transport **or** envelope `code`) | `PROVIDER_INVALID_INPUT`            |
| Rate limited                                          | `429`, empty body                        | `PROVIDER_RATE_LIMITED`             |
| Server error on a data call                           | `5xx`                                    | `PROVIDER_UNAVAILABLE`              |
| 200 with no envelope `code`, or an unrecognized shape | —                                        | `PROVIDER_ERROR`                    |
| **200 with `body: null` on a READ**                   | —                                        | **not an error** → `{found: false}` |

`412` is the one re-classification this adapter makes: the shared status map sends it to
`PROVIDER_ERROR`, which tells a caller to give up on a call it could have fixed.

**A 500 on a data call is an outage, never a dead credential.** The 500-vs-412 quirk lives on the mint
endpoint, which only Rail A calls.

Error messages carry the operation, the status/code and `eventId` — never the vendor's prose.

---

## E. Cross-repo obligations (xcale-backend)

1. `modules/mcp/toolboxes.ts` — one catalog entry (done, unfeatured until a patient-facing read is proven).
2. `modules/connections/credential-exchange-providers.ts` — the pinned mint descriptor mirroring §B,
   `connectFields` `[{key:'key',type:'text'},{key:'secret',type:'secret'}]`, `accountKeyField: 'key'` (done).
3. **The mint's `412` must read as "wrong credential", not "provider down"** (§A.2). Only Rail A can.
4. `McpToolDef` must carry `identityPolicy` for §C.1 to mean anything — that is PR #1020, unmerged.

---

## F. What this contract does not cover

- **Phases 3–4** — clinical reads and writes. Designed, not specified: no response body is documented
  and none can be observed without reading real clinical records (Q6).
- **Webhooks** — configured by hand in the clinic's own UI, payload undocumented (Q5).
- **`EXAM_RESULTS` vs `EXAMS_RESULTS`** (Q10) and the personal-history `eventType` (Q11) — unresolved.
- **Any behaviour of a populated patient read or agenda page.** The projections are written against the
  vendor's published examples; the recordings that would replace them wait on Q6.
