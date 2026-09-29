# The clinical surfaces — what the vendor documents, and what production answers

Source material for phases 3 and 4. Transcribed from `developer.saludtools.com` on **2026-09-28**,
section by section, and cross-checked against what production actually accepts.

**Everything here is _Documented_ unless a line says otherwise.** This vendor's documentation has been
wrong at least seven times during this integration (`grill-notes.md` §6), so treat every field as a
claim to be confirmed by a live call — see _How to use this safely_ at the end.

---

## 1. How each surface is addressed

The single most useful thing on this page, because it is not derivable from the documentation alone
and it decides whether a surface is reachable from a conversation at all.

| Event type            | Patient field the docs name | Reached from a patient document?      | Observed                                              |
| --------------------- | --------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `MEDICINE`            | `PatientId` (an **id**)     | `READ` via nested `{search: {…}}`     | ✅ accepted                                           |
| `GYNECOOBS_HISTORY`   | `documentType`              | `READ` at the root                    | ✅ accepted                                           |
| `FAMILY_HISTORY`      | `documentType`              | `READ` at the root **and** `SEARCH`   | ✅ accepted                                           |
| `ANTECEDENT_PERSONAL` | `documentType`              | `READ` needs an id; `SEARCH` untested | `412 "El evento read requiere en id"`                 |
| `INABILITYWORK`       | `documentType`              | `READ` needs an id; `SEARCH` untested | `402 "Se esperaba un id"`                             |
| `PATIENT_FILES`       | `documentType`              | `READ` needs an id; `SEARCH` untested | `402 "Se esperaba un id"`                             |
| `EXAMS_RESULTS`       | **`patientDocumentType`**   | `SEARCH` → ids → `READ` by id         | ✅ `SEARCH` accepted                                  |
| `CLINIC_HISTORY`      | **`patientDocumentType`**   | **no** — not by document, either name | rejects both `documentType` and `patientDocumentType` |
| `EXAMS_PRESCRIPTION`  | **`patientDocumentType`**   | **no** — not by document, either name | rejects both                                          |
| `PARACLINICS`         | **`patientDocumentType`**   | **no** — not by document, either name | rejects both                                          |

### The field name is not uniform, and it cost three "unknowns"

`PATIENT` and five clinical surfaces name it **`documentType`**. Four name it
**`patientDocumentType`**. Nothing distinguishes the two groups except the vendor's own history.

Every probe before 2026-09-28 sent `documentType`, which was the obvious suspect for the bottom three
rows — they had been written down as "grammar unknown", and twice already in this integration a
rejection turned out to be our own request rather than the provider's design.

**Tested, and this time it was not.** Asked again with `patientDocumentType`, all three still answer
`412 "El cuerpo del evento esta mal conformado"`. So `CLINIC_HISTORY`, `EXAMS_PRESCRIPTION` and
`PARACLINICS` genuinely cannot be read by a patient document under either name — consistent with the
vendor's own prose, which gives them _"crear y leer"_ and no search. They are encounter-scoped: the
way in is an `encounterId` or a record id, and where an agent would get one is **[open]**.

The hypothesis is recorded here with its refutation because the next person will have it too.

**Do not unify the two names in the adapter.** Fidelity over Unification (ADR 0009): each surface gets
the key the vendor gave it. A helper that "normalises" them would hide exactly the difference that
made three surfaces look unreachable.

---

## 2. Which actions each surface supports

Taken from the vendor's own prose ("usted puede …"). **This is what makes most of phase 4
irreversible** — only `MEDICINE` offers a delete.

| Surface               | Vendor's words                   | create | read | search | update | delete |
| --------------------- | -------------------------------- | :----: | :--: | :----: | :----: | :----: |
| `MEDICINE`            | crear, leer, actualizar y borrar |   ✅   |  ✅  |   —    |   ✅   |   ✅   |
| `CLINIC_HISTORY`      | crear y leer                     |   ✅   |  ✅  |   —    |   —    |   —    |
| `EXAMS_PRESCRIPTION`  | crear y leer                     |   ✅   |  ✅  |   —    |   —    |   —    |
| `PARACLINICS`         | crear y leer                     |   ✅   |  ✅  |   —    |   —    |   —    |
| `EXAMS_RESULTS`       | cargar, leer y buscar            |   ✅   |  ✅  |   ✅   |   —    |   —    |
| `INABILITYWORK`       | crear, leer y buscar             |   ✅   |  ✅  |   ✅   |   —    |   —    |
| `PATIENT_FILES`       | cargar, leer y buscar            |   ✅   |  ✅  |   ✅   |   —    |   —    |
| `GYNECOOBS_HISTORY`   | cargar, leer y buscar            |   ✅   |  ✅  |   ✅   |   —    |   —    |
| `ANTECEDENT_PERSONAL` | cargar, leer y buscar            |   ✅   |  ✅  |   ✅   |   —    |   —    |
| `FAMILY_HISTORY`      | cargar, leer y buscar            |   ✅   |  ✅  |   ✅   |   —    |   —    |

**Nine of ten clinical writes cannot be undone.** That is why phase 4 must not be exercised against a
clinic that treats real patients, and why [#1057](https://github.com/matesjara/xcale-backend/issues/1057)
is its blocker rather than a convenience.

---

## 3. The documented attribute tables

Field names, types and the vendor's own examples. Enum values are reproduced **as documentation, not
as constraints** — `z.enum` on a documented list is the trap that would have rejected real
appointments (`grill-notes.md` §6 Q2, where a documented three-value enum turned out to have twelve
live values). Use `z.string()` with the values in the description, and validate against the live
catalog where one exists.

### 3.1 `MEDICINE` — prescription

`doctorDocumentType`, `doctorDocumentNumber` (**the doctor is required — see
[#1062](https://github.com/matesjara/xcale-backend/issues/1062)**), `encounterId`, `PatientId` (note
the capital `P` — the vendor's own casing), `improved`, `prescriptedMedicine[]`.

Each entry of `prescriptedMedicine`: `medicinePrescriptionType` (documented
`ACTIVE_PRINCIPLE` / `MASTER_FORMULA` / `COMMERCIAL_PRESENTATION`), `comercialProductName`,
`comercialProductId`, `magistralPreparationFormula`, `principleActiveType`, `atcConcentrationId`,
`intakemethod`, `quantityImproved`, `quantityUnit`, `frecuencyImproved`, `frequencyUnit`,
`durationImproved`, `durationUnit`, `totalQuantity`, `indicationsTaking`, `comments`, `pharmaForm`.

The vendor's own misspellings (`comercialProductName`, `frecuencyImproved`, `intakemethod`) are
reproduced verbatim. They are the wire.

### 3.2 `CLINIC_HISTORY` — a clinical encounter

`appointmentId`, `impression`, `managementPlan`, `configurationClinicHistoryId`,
`patientDocumentType`, `documentNumber`, plus three nested structures:

- **`patientVitalSignsRecord`** — ~80 numeric fields, from `weight`, `heightCm`,
  `systolicBloodPressure`, `heartRate`, `temperature`, `imc`, `sp02` through body-composition,
  obstetric (`uterineHeight`, `fetalHeartRate1..3`) and specialty scores (`poem`, `dlqi`, `escorad`,
  `easi`, `asaClassification`, `ocularPressureEyeLeft/Right`). Full list on the vendor's page; it is
  long, flat and entirely optional-looking.
- **`sectionDiagnostic`** — `externalCause`, `diagnosticList[]` of
  `{diagnosticCie10, diagnosticDate ("yyyy-MM-dd HH:mm"), diagnosticClasification, diagnosticType,
diagnosticObservations, eyes, diabetesType}`.
- **`patientPhysicalExamination`** — paired `…Evaluation` / `…Finding` strings for head, neck, chest,
  abdomen, neurological, extremities, skin.

Also documented but not shown as nested under the encounter: **`currentIllness`**
(`attentionModality`, `consultationReason`, `consultationName`, `attentionConsecutive`,
`consultationActualDisease`, `actualDiseaseComment`, `attenderUserDocumentType`,
`attenderUserDocumentNumber`) and **`SystemReview`** (`type`, `symptoms[]`). **Where these attach is
not documented** — a gap to settle with a live call before building.

### 3.3 `EXAMS_PRESCRIPTION`

`name`, `encounterId`, `patientDocumentType`, `documentNumber`, `examsRemissions[]` of
`{examPrescriptionType (PRESCRIPTION_CUPS | PRESCRIPTION_FREE), examTypeCode, comments,
freePrescriptionText}`.

### 3.4 `EXAMS_RESULTS`

Request: `encounterId`, `patientDocumentType`, `documentNumber`.
Result: `{medicalExamType, classificationType, examDate, comments, Documentos}` where `Documentos` is
the shared **`Documents`** shape below.

### 3.5 `PARACLINICS` (Laboratorios clínicos)

Request: `encounterId`, `patientDocumentType`, `documentNumber`.
Result: `{value, classification, typeId, unitId, comments, examDate ("DD-MM-AAAA" — a third date
format, and not the one the rest of the API uses)}`.

### 3.6 `INABILITYWORK`

`documentType`, `documentNumber`, `diagnosticCIE10ID`, `consultationExternalCauseID`,
`treatmentAreaOfApplicationID`, `reoccurenceTypeID`, `startInabilityDate`, `endInabilityDate`,
`comments`.

### 3.7 `PATIENT_FILES` (Documentos)

Request: `documentType`, `documentNumber`, `files`. Upload posts to
`/integration/sync/event/documents/v1/`; search and download go through the ordinary event endpoint.
Result: the **`Documents`** shape.

### 3.8 `GYNECOOBS_HISTORY`

`documentType`, `documentNumber`, `fup`, `weeksOfPregnancy`, `otherObservations`, `fur`,
`trustworthy`, `contraceptiveType` (documented ids 26–34), `detailContraceptiveMethod`,
`aliveBirths`, `pregnancies`, `births`, `cesareans`, `ceases`, `molas`, `ectopics`, `menarche`,
`pubarchy`, `telarchy`, `irs`, `sexualPartners`, `menstrualRegularity` (`REGULAR` | `IRREGULAR`),
`menstrualCycles`, `lastCytologyDate`, `previousGestationalObservations`, `currentlyPregnant`, and —
kept only when `currentlyPregnant` is true — `ultrasoundDate`, `gestationWeek`, `gestationDay`,
`observations`.

**This is the most sensitive surface in the API** and the clearest case for
[#1055](https://github.com/matesjara/xcale-backend/issues/1055): pregnancies, terminations, sexual
history and contraception are exactly the data Ley 1581 calls sensitive.

### 3.9 `ANTECEDENT_PERSONAL`

`documentType`, `documentNumber`, `encounterCommonInfo`, `friendlyNameId`, `othersDiagnosticText`,
`othersDiagnosticTextGroupId`, `diagnosticType` (a CIE-10 code), `diagnosticText`, `diagnosisDate`,
`antecedentStateType`, `antecedentState`, `comments`.

### 3.10 `FAMILY_HISTORY`

`documentNumber`, `documentType`, `encounterCommonInfo`, `familiarRelationshipType` (documented ids
1–16), `diagnosticText` **or** `diagnosticType` — the vendor states these are mutually exclusive and
that sending both makes it pick one — `diagnosisDate`, `comments`.

### 3.11 The shared `Documents` shape

Returned by `EXAMS_RESULTS` and `PATIENT_FILES`: `id`, `fileName`, `typeFile`, `byteSize`,
`pathLocation`, `uuid`, `insertDate`, `encounterId`, `diaryId`, `patient`, `idExam`.

`pathLocation` (`patients/1/11111/files/<uuid>/`) and `patient` (an internal id) are **infrastructure
detail about another system's storage layout**. They are not signal for any agent job and must not
survive a projection.

---

## 4. Webhooks — documented, and useless

`/webhook` gives **twelve UI steps** for switching events on inside the clinic's own SaludTools
(Configuración › Integraciones › WebHooks; Paciente or Agendamiento; create/update/delete; choose the
HTTP method, the URL, optional params and headers).

It documents **nothing about the payload**. No example, no field list, no headers, no signature, no
retry policy. There is also no API to register or list a webhook.

So [#1060](https://github.com/matesjara/xcale-backend/issues/1060) cannot be unblocked by reading —
only by pointing a real endpoint at a real clinic and looking at what arrives.

---

## 5. How to use this safely

1. **Treat every field as _Documented_.** The status line of each phase says what has been observed;
   this page is the starting hypothesis, not evidence.
2. **No `z.enum` from this page.** Documented enums have already been wrong by a factor of four here.
   `z.string()` plus the values in the description, validated against the live catalog when one exists.
3. **Projections are allow-lists, and that is what makes this page usable.** If the vendor omitted a
   field, the projection omits it too — the failure mode is a missing value, never a leak. Every known
   documentation error in this integration lands on that safe side.
4. **Drop `pathLocation`, `patient`, `uuid` and every internal id** that names another system's
   storage. D6.
5. **Both phases are now BUILT, and both are withdrawn from `tools/list`** (2026-09-28/29, D10 and
   D5). Phase 3's withdrawal is temporary and lifts when #1055 answers; phase 4's is permanent.
   **No clinical write has ever been executed** against any environment, and none should be until
   #1057 provides a sandbox — nine of the ten cannot be undone.
