import { z } from 'zod';

import { defineTool, type ToolDefinition } from '../../core/tool';
import type { SaludtoolsClient } from './client';
import { unwrapSaludtools } from './errors';
import { SLUG } from './manifest';
import { written } from './outcomes';

/*
 * PHASE 4 — the clinical writes. Read this before adding, exposing or running anything here.
 *
 * ## Every tool here is control-plane, PERMANENTLY
 *
 * Decision D5, and it does not expire the way phase 3's withdrawal does. Prescribing a medicine,
 * recording a diagnosis, filing a disability certificate or attaching a document to a medical record
 * are not moves an agent makes on a patient's behalf under any tenant's rules. They are built so the
 * provider covers the whole SaludTools API — a half-covered provider is one whose gaps nobody can see
 * from the outside — and so a consumer can drive a migration or a sync. Not so a model can call them.
 *
 * `controlPlane: true` withdraws them from `tools/list`, which is the agent's menu: a tool that never
 * appears there cannot be selected, hallucinated into a plan, or reached through prompt injection.
 *
 * ## NOTHING HERE HAS EVER BEEN EXECUTED
 *
 * Not once, against any environment. That is deliberate and it is the honest status of this file:
 *
 * - **Nine of these ten surfaces have no delete.** Only `MEDICINE` can be undone (vendor's own prose;
 *   `docs/design/saludtools-provider/clinical-surfaces.md` §2). The two write runs that proved the
 *   patient path were authorised on the condition that everything be reverted, and that condition
 *   cannot be met here. Running `create_clinic_history` once against Dra. Daniela's clinic leaves a
 *   clinical encounter in a real patient's record with no way back.
 * - **So the blocker is xcale-backend#1057, the sandbox** — not the shape, which is documented, and
 *   not permission. The first real call will correct some of these schemas; it should correct them
 *   somewhere nobody is treated.
 *
 * Treat every schema below as *Documented*, never *Observed*.
 *
 * ## Why the inputs are LOOSE where the outputs are STRICT
 *
 * Phase 3's projections are allow-lists: a field the vendor forgot is dropped, so the failure mode is
 * omission and imperfect documentation stays safe. **The asymmetry is deliberate, and reversing it
 * here would be the mistake.**
 *
 * On the way IN, the caller supplies the data, so there is no leak to prevent — and a schema stricter
 * than the provider rejects a clinical record the clinic had every right to file, with OUR error
 * rather than the provider's. This API has already been documented wrong in both directions
 * (a three-value enum whose live catalog had twelve), and the cost of that mistake lands on a patient
 * whose record cannot be written. So the big nested clinical blocks are accepted as objects and
 * forwarded verbatim, with the vendor's field table cited in the description.
 *
 * The rule: **validate what we would otherwise corrupt (shapes, dates, required identity), and let
 * the provider judge its own clinical vocabulary.** Same reasoning as `modality` in `tools.ts`.
 */

/** `yyyy-mm-dd`, the format most of these surfaces document. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-mm-dd');

/**
 * `DD-MM-AAAA` — `PARACLINICS` only, and it is the vendor's third date format.
 *
 * Validated rather than converted. An adapter that silently reformats a date is one that can silently
 * get it wrong, and on a laboratory result a swapped day and month is a plausible value that is not
 * the one anybody meant.
 */
const paraclinicDate = z
  .string()
  .regex(/^\d{2}-\d{2}-\d{4}$/, 'expected DD-MM-AAAA — this surface differs from the rest');

/** The patient, as most clinical surfaces name them. */
const patientRef = {
  documentType: z.number().int().positive().describe('Patient document type id'),
  documentNumber: z.string().min(1).describe('Patient document number'),
};

/** The patient, as `CLINIC_HISTORY`, `EXAMS_PRESCRIPTION`, `EXAMS_RESULTS` and `PARACLINICS` name
 * them. Not unified with the above on purpose — see `clinical.ts` and ADR 0009. */
const altPatientRef = {
  patientDocumentType: z.number().int().positive().describe('Patient document type id'),
  documentNumber: z.string().min(1).describe('Patient document number'),
};

/** A free-form clinical block forwarded verbatim. See "Why the inputs are LOOSE", above. */
const clinicalBlock = (what: string, where: string) =>
  z
    .record(z.unknown())
    .describe(
      `${what}. Forwarded to SaludTools verbatim — the field list is the vendor's, at ${where}. ` +
        'Not validated field by field here: a schema stricter than the provider rejects records the ' +
        'clinic was entitled to file.',
    );

/**
 * Phase 4's tools. Every one is `controlPlane: true` and none has ever been executed — see the
 * header before running any of them against a clinic that treats patients.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildSaludtoolsClinicalWriteTools(
  client: SaludtoolsClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): readonly ToolDefinition<any>[] {
  return [
    /* ───────────────── MEDICINE — the only reversible clinical surface ───────────────── */

    defineTool({
      name: `mcp_${SLUG}_create_prescription`,
      description:
        'Record a medicine prescription for a patient. Control-plane: prescribing is not an agent ' +
        "action. Requires the PRESCRIBING DOCTOR'S identity document, which SaludTools publishes no " +
        'way to discover — the clinic supplies it (see the onboarding runbook).',
      input: z
        .object({
          doctorDocumentType: z.number().int().positive(),
          doctorDocumentNumber: z.number().int().positive(),
          PatientId: z
            .number()
            .int()
            .positive()
            .describe(
              "The patient's SaludTools id — the vendor's own capitalisation, kept verbatim",
            ),
          encounterId: z.number().int().positive().optional(),
          improved: z.boolean().optional(),
          prescriptedMedicine: z
            .array(clinicalBlock('One prescribed medicine', '`/medicine`'))
            .min(1),
        })
        .strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-scoped' },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            await client.event('MEDICINE', 'CREATE', args, ctx.request),
            'create prescription',
          ),
          'created',
          'prescriptionId',
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_update_prescription`,
      description:
        'Update an existing medicine prescription. Send the whole prescription, not a patch — every ' +
        'SaludTools update observed so far replaces the record.',
      input: z
        .object({
          id: z.number().int().positive(),
          doctorDocumentType: z.number().int().positive(),
          doctorDocumentNumber: z.number().int().positive(),
          PatientId: z.number().int().positive(),
          encounterId: z.number().int().positive().optional(),
          improved: z.boolean().optional(),
          prescriptedMedicine: z
            .array(clinicalBlock('One prescribed medicine', '`/medicine`'))
            .min(1),
        })
        .strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-scoped' },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            await client.event('MEDICINE', 'UPDATE', args, ctx.request),
            'update prescription',
          ),
          'updated',
          'prescriptionId',
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_delete_prescription`,
      description:
        'Delete a medicine prescription by its SaludTools id. **The only clinical write in this API ' +
        'that can be undone** — every other clinical record, once created, stays.',
      input: z.object({ id: z.number().int().positive() }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-scoped' },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            await client.event('MEDICINE', 'DELETE', { id: args.id }, ctx.request),
            'delete prescription',
          ),
          'deleted',
          'prescriptionId',
        ),
    }),

    /* ───────────────── Create-only surfaces — none of these can be undone ───────────────── */

    defineTool({
      name: `mcp_${SLUG}_create_clinic_history`,
      description:
        'File a clinical encounter (_atención_) for a patient — impression, management plan, vital ' +
        'signs, diagnoses and physical examination. **Cannot be deleted once created.**',
      input: z
        .object({
          ...altPatientRef,
          appointmentId: z.number().int().positive().optional(),
          configurationClinicHistoryId: z.number().int().positive().optional(),
          impression: z.string().optional(),
          managementPlan: z.string().optional(),
          patientVitalSignsRecord: clinicalBlock(
            'Vital signs — roughly eighty numeric fields',
            '`/clinicHistory`',
          ).optional(),
          sectionDiagnostic: clinicalBlock(
            'Diagnoses: `externalCause` plus a `diagnosticList` of CIE-10 entries',
            '`/clinicHistory`',
          ).optional(),
          patientPhysicalExamination: clinicalBlock(
            'Physical examination — paired evaluation/finding per body region',
            '`/clinicHistory`',
          ).optional(),
          currentIllness: clinicalBlock(
            'Current illness and consultation metadata. **Where this attaches is not documented** — ' +
              'the vendor lists it separately from the encounter and never shows it nested',
            '`/clinicHistory`',
          ).optional(),
        })
        .strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            await client.event('CLINIC_HISTORY', 'CREATE', args, ctx.request),
            'create clinic history',
          ),
          'created',
          'encounterId',
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_create_exam_prescription`,
      description: 'Prescribe exams for a patient. **Cannot be deleted once created.**',
      input: z
        .object({
          ...altPatientRef,
          name: z.string().min(1).describe('Name of the container holding the prescribed exams'),
          encounterId: z.number().int().positive().optional(),
          examsRemissions: z
            .array(
              clinicalBlock(
                'One prescribed exam: `examPrescriptionType` (PRESCRIPTION_CUPS or ' +
                  'PRESCRIPTION_FREE), `examTypeCode`, `comments`, `freePrescriptionText`',
                '`/examsprescription`',
              ),
            )
            .min(1),
        })
        .strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            await client.event('EXAMS_PRESCRIPTION', 'CREATE', args, ctx.request),
            'create exam prescription',
          ),
          'created',
          'examPrescriptionId',
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_create_exam_result`,
      description:
        "Record an exam result on a patient's record. **Cannot be deleted once created.**",
      input: z
        .object({
          ...altPatientRef,
          encounterId: z.number().int().positive().optional(),
          medicalExamType: z.number().int().positive().optional(),
          classificationType: z.number().int().positive().optional(),
          examDate: z.string().optional().describe('Result date, as the vendor documents it'),
          comments: z.string().optional(),
        })
        .strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            await client.event('EXAMS_RESULTS', 'CREATE', args, ctx.request),
            'create exam result',
          ),
          'created',
          'examResultId',
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_create_paraclinic`,
      description:
        'Record a clinical-laboratory result. `examDate` is `DD-MM-AAAA` on this surface and only ' +
        'this one. **Cannot be deleted once created.**',
      input: z
        .object({
          ...altPatientRef,
          encounterId: z.number().int().positive().optional(),
          value: z.number().optional(),
          classification: z.number().int().positive().optional(),
          typeId: z.number().int().positive().optional(),
          unitId: z.number().int().positive().optional(),
          examDate: paraclinicDate.optional(),
          comments: z.string().optional(),
        })
        .strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            await client.event('PARACLINICS', 'CREATE', args, ctx.request),
            'create paraclinic',
          ),
          'created',
          'paraclinicId',
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_create_disability`,
      description:
        'File a disability certificate (_incapacidad_) for a patient. A legal document in Colombia. ' +
        '**Cannot be deleted once created.**',
      input: z
        .object({
          ...patientRef,
          diagnosticCIE10ID: z.string().min(1).describe('CIE-10 diagnosis code'),
          consultationExternalCauseID: z.number().int().positive().optional(),
          treatmentAreaOfApplicationID: z.number().int().positive().optional(),
          reoccurenceTypeID: z.number().int().positive().optional(),
          startInabilityDate: isoDate,
          endInabilityDate: isoDate,
          comments: z.string().optional(),
        })
        .strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            await client.event('INABILITYWORK', 'CREATE', args, ctx.request),
            'create disability',
          ),
          'created',
          'disabilityId',
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_create_gyneco_history`,
      description:
        "Record a patient's gynaecological and obstetric history. The most sensitive write in this " +
        'API. **Cannot be deleted once created.**',
      input: z
        .object({
          ...patientRef,
          history: clinicalBlock(
            'The obstetric record — pregnancies, births, contraception, menstrual and sexual history',
            '`/patientGinecoInformation`',
          ),
        })
        .strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) => {
        const { history, ...patient } = args;
        // The vendor documents one flat body: the patient's document alongside the history's own
        // fields. `history` is a nesting of OURS, for a readable schema, and is flattened here so the
        // wire stays the vendor's (ADR 0009).
        return written(
          unwrapSaludtools(
            await client.event(
              'GYNECOOBS_HISTORY',
              'CREATE',
              { ...patient, ...history },
              ctx.request,
            ),
            'create gynaecological history',
          ),
          'created',
          'gynecoHistoryId',
        );
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_create_personal_history`,
      description:
        "Record a personal medical antecedent on a patient's record. **Cannot be deleted once created.**",
      input: z
        .object({
          ...patientRef,
          encounterCommonInfo: z.number().int().positive().optional(),
          friendlyNameId: z.number().int().positive().optional(),
          othersDiagnosticText: z.string().optional(),
          othersDiagnosticTextGroupId: z.number().int().positive().optional(),
          diagnosticType: z.string().optional().describe('CIE-10 code'),
          diagnosticText: z.string().optional().describe('Used when the antecedent is generic'),
          diagnosisDate: isoDate.optional(),
          antecedentStateType: z.number().int().positive().optional(),
          antecedentState: z.number().int().positive().optional(),
          comments: z.string().optional(),
        })
        .strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            await client.event('ANTECEDENT_PERSONAL', 'CREATE', args, ctx.request),
            'create personal history',
          ),
          'created',
          'personalHistoryId',
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_create_family_history`,
      description:
        'Record a family medical antecedent for a patient. Send **either** `diagnosticText` or ' +
        '`diagnosticType`, never both — the vendor states it picks one and ignores the other. ' +
        '**Cannot be deleted once created.**',
      input: z
        .object({
          ...patientRef,
          encounterCommonInfo: z.number().int().positive().optional(),
          familiarRelationshipType: z
            .number()
            .int()
            .positive()
            .describe('Relationship id — from the `familiarRelationshipType` catalog'),
          diagnosticText: z.string().max(255).optional(),
          diagnosticType: z.string().max(10).optional().describe('CIE-10 code'),
          diagnosisDate: isoDate.optional(),
          comments: z.string().max(255).optional(),
        })
        .strict()
        /*
         * The one cross-field rule worth enforcing, because the provider does NOT reject it — it
         * silently picks one. A caller that sends both has two different intentions and gets an
         * arbitrary one of them recorded in a medical history, with no error to notice.
         */
        .refine(
          (v) => (v.diagnosticText === undefined) !== (v.diagnosticType === undefined),
          'send exactly one of diagnosticText or diagnosticType — the provider silently picks one',
        ),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            await client.event('FAMILY_HISTORY', 'CREATE', args, ctx.request),
            'create family history',
          ),
          'created',
          'familyHistoryId',
        ),
    }),

    /* ───────────────── Documents — the one call on its own endpoint ───────────────── */

    defineTool({
      name: `mcp_${SLUG}_upload_patient_file`,
      description:
        "Attach a document to a patient's record. Posts to the vendor's separate upload path, not " +
        'the event endpoint. **Cannot be deleted once uploaded.**',
      input: z
        .object({
          ...patientRef,
          files: clinicalBlock(
            "The document payload, as the vendor's upload endpoint expects it",
            '`/documents`',
          ),
        })
        .strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            // The single operation the vendor puts on its own path. Document search and download go
            // through the ordinary event endpoint; only the upload does not.
            await client.documentUpload(args, ctx.request),
            'upload patient file',
          ),
          'created',
          'fileId',
        ),
    }),
  ];
}
