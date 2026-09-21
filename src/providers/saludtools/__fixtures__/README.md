# SaludTools fixtures — provenance

**These are NOT recordings.** Every file here is transcribed from a response example the vendor
publishes on its own developer portal (`developer.saludtools.com`), captured 2026-09-21. No call has
ever been made against SaludTools from this repo: there is no credential yet
(`docs/design/saludtools-provider/grill-notes.md` §6 Q1).

`add-provider` requires **anonymized recordings, never invented ones**. These sit between the two, and
the distinction matters enough to write down:

- They are **not invented** — the field names, the envelope, the `code` values, the Spanish messages
  and the Spring page shape are the vendor's own bytes, not a guess at what it might return.
- They are **not proof** — a published example can be stale, edited for the docs, or simply wrong, and
  an example cannot show what a _real_ clinic's data looks like, which fields are ever `null`, or which
  ones the docs never mentioned. One already caught us out: the patient record returns an `address`
  field that the vendor's own attribute table does not list.

So they are good enough to drive tests of **our** logic — the unwrap, the classification, the
projections, the pagination translation — and they are not the round-trip proof. When a key arrives
(Q1), each one is re-recorded against the QA host and replaced; a diff at that point is a finding, not
an inconvenience.

| File                              | What it shows                  | Why it is here                                                                                    |
| --------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `patientRead.json`                | `PATIENT`/`READ` success       | The envelope, and the undocumented `address` + internal `id` the projection drops                 |
| `appointmentRead.json`            | `APPOINTMENT`/`READ` success   | A single appointment record                                                                       |
| `appointmentSearch.json`          | `APPOINTMENT`/`SEARCH` success | The Spring `Page` — `content`, `totalPages`, `totalElements`                                      |
| `gendersCatalog.json`             | `parametric/genders` success   | A catalog answers with a BARE ARRAY, not an envelope                                              |
| `errors/patientNotFound412.json`  | An unknown patient document    | Reported as `412`, the same code as a malformed request — the case `isPatientNotFound` exists for |
| `errors/invalidEventType412.json` | A missing/wrong `eventType`    | `412` with `body: null`                                                                           |
| `errors/unauthorized401.json`     | HTTP 401                       | The body is a **bare JSON string**, not an envelope                                               |

`appointmentSearch.json` carries two of the three records its `totalElements` reports: the third was
cut off when the page was captured. Left as it is on purpose — the totals are the vendor's, and a page
whose item count is below its total is a case worth having a test for anyway.

**One field is anonymized.** The vendor's patient example carries `lzarate@carecloud.com.co`, which
reads as a CareCloud employee's real address rather than test data; it is
`paciente.prueba@example.com` here. The names and document numbers are the vendor's own synthetic
values and are kept verbatim. Nothing else was changed, and on a provider whose fixtures will one day
hold real patients this is the habit to have from the first file, not from the first incident.
