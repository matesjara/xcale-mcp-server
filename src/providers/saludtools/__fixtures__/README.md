# SaludTools fixtures — provenance

**Two kinds of file live here, and the difference is the `observed-` prefix.**

- **`observed-*` — real recordings**, captured 2026-09-21 against SaludTools **production** with a live
  clinic ApiKey. These are evidence.
- **everything else — the vendor's published examples**, transcribed from its developer portal
  (`developer.saludtools.com`). These are not evidence: the portal contradicts production in ten places
  (`docs/design/saludtools-provider/grill-notes.md` §6), and `__tests__/observed.test.ts` names each one.

Replacing the documented fixtures with recordings, one module at a time, is still outstanding — the
recordings so far cover the mint, the catalogs and an empty agenda search, because those touch no
patient's records. A patient read and a populated agenda were deliberately **not** recorded: the key is
production, and the Ley 1581 question is Mateo's and still open.

Why the documented ones are still here rather than deleted: they exercise shapes the recordings do not
yet cover (a populated patient record, a populated agenda page), and they are the vendor's own bytes
rather than a guess. But they are not proof, and the distinction matters enough to write down:

- They are **not invented** — the field names, the envelope, the `code` values, the Spanish messages
  and the Spring page shape are the vendor's own bytes, not a guess at what it might return.
- They are **not proof** — a published example can be stale, edited for the docs, or simply wrong, and
  an example cannot show what a _real_ clinic's data looks like, which fields are ever `null`, or which
  ones the docs never mentioned. One already caught us out: the patient record returns an `address`
  field that the vendor's own attribute table does not list.

So they are good enough to drive tests of **our** logic — the unwrap, the classification, the
projections, the pagination translation — and they are not the round-trip proof, which ran separately
(`docs/design/saludtools-provider/production-evidence.md`). Each one still gets replaced by a recording
as soon as the call behind it can be made without reading somebody's medical record; a diff at that
point is a finding, not an inconvenience.

| File                              | What it shows                  | Why it is here                                                                                    |
| --------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `patientRead.json`                | `PATIENT`/`READ` success       | The envelope, and the undocumented `address` + internal `id` the projection drops                 |
| `appointmentRead.json`            | `APPOINTMENT`/`READ` success   | A single appointment record                                                                       |
| `appointmentSearch.json`          | `APPOINTMENT`/`SEARCH` success | The Spring `Page` — `content`, `totalPages`, `totalElements`                                      |
| `gendersCatalog.json`             | `parametric/genders` success   | A catalog answers with a BARE ARRAY, not an envelope                                              |
| `errors/patientNotFound412.json`  | An unknown patient document    | Reported as `412`, the same code as a malformed request — the case `isPatientNotFound` exists for |
| `errors/invalidEventType412.json` | A missing/wrong `eventType`    | `412` with `body: null`                                                                           |
| `errors/unauthorized401.json`     | HTTP 401                       | The body is a **bare JSON string**, not an envelope                                               |

Recorded against production (`observed-*`):

| File                                       | What it proves                                                                                                                                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observed-mintResponse.shape.json`         | The mint returns `expires_in`, `refresh_token`, `scope`, `token_type`, `jti` — the portal documents only `access_token`. **Token values are redacted**: a real one is a live 6-day credential and is never written to disk. |
| `observed-attentionModalityCatalog.json`   | Twelve modalities, and **no `DOMICILIARY`** — the documented three-value enum was wrong in both directions                                                                                                                  |
| `observed-statesCatalog.json`              | Eleven appointment states, keyed on `value` not `id`, including `CANCELLED` and `RESCHEDULED` (which answers how to cancel)                                                                                                 |
| `observed-specialtiesPagedCatalog.json`    | A paged catalog returns a bare FLATTENED page with no envelope `code` — the shape the first unwrap rejected                                                                                                                 |
| `observed-clinicsCatalog.json`             | One site, a five-digit id, and a `company` field. **The clinic's name is anonymized** — the real response names a live customer.                                                                                            |
| `observed-appointmentSearchEmpty.json`     | A date window with no doctor and no patient is accepted, and pagination goes in a nested `pageable`                                                                                                                         |
| `errors/observed-mintInvalidKey412.json`   | An invalid key yields **412**, not the 500 the docs claim                                                                                                                                                                   |
| `observed-patientNotFound200.json`         | An unregistered document answers **HTTP 200 with `body: null`** — a success with nothing in it, not the `412` the docs show                                                                                                 |
| `errors/observed-pageSizeTooLarge412.json` | A page of 25 (the gateway's default) is refused; the ceiling is 20                                                                                                                                                          |

`appointmentSearch.json` carries two of the three records its `totalElements` reports: the third was
cut off when the page was captured. Left as it is on purpose — the totals are the vendor's, and a page
whose item count is below its total is a case worth having a test for anyway.

**One field is anonymized.** The vendor's patient example carries `lzarate@carecloud.com.co`, which
reads as a CareCloud employee's real address rather than test data; it is
`paciente.prueba@example.com` here. The names and document numbers are the vendor's own synthetic
values and are kept verbatim. Nothing else was changed, and on a provider whose fixtures will one day
hold real patients this is the habit to have from the first file, not from the first incident.
