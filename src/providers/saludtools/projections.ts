/**
 * Per-tool field projection — the PHI control this provider leans on hardest.
 *
 * Every tool returns the named fields its job needs and drops the rest. Allow-list, never deny-list,
 * so a field SaludTools adds next release does **not** leak by default: it simply is not in a list, and
 * the tool that should carry it has to be edited on purpose.
 *
 * This is permitted by *Fidelity over Unification* (ADR 0009) because nothing is renamed, retyped or
 * reshaped — each kept field keeps the vendor's own name and value. What is dropped is not signal for
 * the job; it is somebody's medical record travelling further than it was asked to.
 */

/** Keep only `fields`, in order, skipping the ones the record does not carry. */
export function project<T extends string>(
  record: unknown,
  fields: readonly T[],
): Record<string, unknown> | null {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return null;
  const source = record as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in source) out[field] = source[field];
  }
  return out;
}

/** Project each element of a list, dropping anything that was not a record. */
export function projectAll<T extends string>(
  records: readonly unknown[],
  fields: readonly T[],
): readonly Record<string, unknown>[] {
  return records
    .map((record) => project(record, fields))
    .filter((record): record is Record<string, unknown> => record !== null);
}

/**
 * A patient, as a service conversation needs them: who they are, how to reach them, and whether they
 * agreed to be reached.
 *
 * `habeasData` is in this list deliberately. It is the clinic's own record of the patient's
 * authorization to be contacted, and an agent that cannot see it is an agent that cannot respect it.
 * Surfacing it is not the same as interpreting it: what the agent then does is the tenant's rule and,
 * where Ley 1581 speaks, the law's — never this adapter's.
 */
export const PATIENT_FIELDS = [
  'firstName',
  'secondName',
  'firstLastName',
  'secondLastName',
  'birthDate',
  'gender',
  'documentType',
  'documentNumber',
  'phone',
  'cellPhone',
  'email',
  'eps',
  'habeasData',
] as const;

/** A full appointment, for the patient it belongs to. */
export const APPOINTMENT_FIELDS = [
  'id',
  'startAppointment',
  'endAppointment',
  'patientDocumentType',
  'patientDocumentNumber',
  'doctorDocumentType',
  'doctorDocumentNumber',
  'modality',
  'stateAppointment',
  'notificationState',
  'appointmentType',
  'clinic',
  'comment',
] as const;

/**
 * A booked interval with **nobody's identity on it** — the projection that makes `get_agenda` safe to
 * offer in a patient-facing channel (grill-notes D7). Drop one field from this list and the tool stops
 * being a calendar and starts being a read of other people's records.
 *
 * Every patient field is gone, and so are two that look harmless and are not:
 *
 * - **`comment`** is free text a receptionist types. The vendor's own documented example is
 *   *"el paciente viene acompañado de su hijo"* — a sentence about a patient and their family, in the
 *   field a naive projection would keep because it is "just a note".
 * - **`appointmentType`** is also free text, and the vendor's own examples are `"Pruebas Luis"` and
 *   `"CITADEPRUEBA"`. The first one is a person's name. A field whose published sample leaks an
 *   identity is not a field an anonymous calendar can carry.
 *
 * `doctorDocumentNumber` stays: it is how the caller books with the same doctor, and a treating
 * physician's professional identity inside their own clinic's scheduling system is not the patient
 * confidentiality this projection exists to protect.
 */
export const AGENDA_FIELDS = [
  'id',
  'startAppointment',
  'endAppointment',
  'doctorDocumentType',
  'doctorDocumentNumber',
  'modality',
  'stateAppointment',
  'clinic',
] as const;
