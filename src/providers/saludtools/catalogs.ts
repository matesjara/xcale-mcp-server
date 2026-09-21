/**
 * SaludTools' reference catalogs — `GET /integration/parametric/{name}/v1/`.
 *
 * Every `name` here is transcribed from a URL the vendor publishes (its *Parametros* page and its
 * Postman collection, read 2026-09-21), including the spellings that look like typos:
 * `treatmenareatype` (not `treatmentareatype`), `diagnosticClasification` (one `s`),
 * `attentionModality` and `diagnosticClasification` in camelCase while their neighbours are flat.
 * **These are wire identifiers, not names we get to tidy up** — correcting one is how a catalog
 * silently 404s.
 *
 * ## Why the split
 *
 * The agent's menu is a place a language model chooses from, so a catalog earns its place there only
 * if a patient conversation actually needs it. Eight do: to book, the agent has to know the clinics,
 * the document types, the appointment states, the specialties, the modalities and the reason types,
 * and to register a patient it needs the genders and the EPS list.
 *
 * The other twenty-three exist so the clinical write payloads are fillable — CIE-10 diagnoses, active
 * principles, commercial drug names, concentrations, intake methods, eye types, diabetes types. An
 * agent has no business paging the CIE-10 catalog, and publishing twenty-three more tools would bury
 * the six that matter. They stay reachable by name as control-plane reads (ADR 0013).
 */

/** One catalog: its wire name and what the caller needs to know to read it. */
export interface CatalogDescriptor {
  /** The `{name}` path segment, verbatim. */
  readonly name: string;
  /** What it lists, for the tool description. */
  readonly label: string;
  /** The vendor calls this one with `?page=`. */
  readonly paged?: boolean;
  /**
   * This catalog is filtered by another catalog's id — `atcconcentration` is the only one, and it
   * takes `?principleact=<id>`. The value is the query-parameter name.
   */
  readonly filterParam?: string;
}

/** The catalogs a patient conversation needs. Published as an agent tool. */
export const AGENT_CATALOGS = {
  clinics: {
    name: 'clinics',
    label: "the clinic's sites (the numeric `clinic` an appointment takes)",
  },
  documentTypes: { name: 'documents', label: 'identity document types' },
  appointmentStates: { name: 'states', label: 'appointment states' },
  genders: { name: 'genders', label: 'genders' },
  eps: { name: 'eps', label: 'health insurers (EPS)', paged: true },
  specialties: { name: 'treatmenareatype', label: 'medical specialties', paged: true },
  attentionModalities: { name: 'attentionModality', label: 'consultation modalities' },
  encounterReasonTypes: {
    name: 'encounterreasontype',
    label: 'consultation (encounter) reason types',
  },
} as const satisfies Readonly<Record<string, CatalogDescriptor>>;

/**
 * The reference catalogs the clinical payloads need. Control-plane: reachable by name, withdrawn from
 * the agent's menu.
 */
export const REFERENCE_CATALOGS = {
  principleActs: { name: 'principleact', label: 'drug active principles', paged: true },
  commercialNames: { name: 'commercialname', label: 'commercial drug names', paged: true },
  atcConcentrations: {
    name: 'atcconcentration',
    label: 'concentrations of an active principle',
    filterParam: 'principleact',
  },
  intakeMethods: { name: 'intakemethod', label: 'medication intake methods' },
  frequencyUnits: { name: 'frequencyunit', label: 'dosing frequency units' },
  durationUnits: { name: 'durationunit', label: 'treatment duration units' },
  encounterCommonIds: { name: 'encountercommonid', label: 'encounter (attention) ids' },
  clinicHistoryConfigurations: {
    name: 'configurationclinichistoryid',
    label: 'clinical-history configuration ids',
    paged: true,
  },
  examPrescriptionTypes: { name: 'examprescriptiontype', label: 'exam prescription types' },
  medicalExamTypes: { name: 'medicalexamtype', label: 'medical exam types', paged: true },
  remissionContainerIds: { name: 'remissioncontainerid', label: 'exam prescription container ids' },
  externalCauses: { name: 'externalcause', label: 'external causes of consultation' },
  diagnosesCie10: { name: 'diagnosticcie10', label: 'CIE-10 diagnosis codes', paged: true },
  diagnosisClassifications: {
    name: 'diagnosticClasification',
    label: 'diagnosis classifications',
  },
  diagnosisTypes: { name: 'diagnosticType', label: 'diagnosis types' },
  eyeTypes: { name: 'eyestype', label: 'eye (laterality) types' },
  diabetesTypes: { name: 'diabetesType', label: 'diabetes types' },
  physicalExamEvaluations: { name: 'evaluationenum', label: 'physical-examination evaluations' },
  inabilityWorkTypes: { name: 'inabilityworktype', label: 'disability certificate types' },
  contraceptiveTypes: { name: 'contraceptivetype', label: 'contraceptive methods' },
  friendlyNames: { name: 'friendlyname', label: 'friendly names' },
  personalAntecedentGroups: {
    name: 'personalantecedentsgroup',
    label: 'personal-history groups',
  },
  personalAntecedents: { name: 'antecedentspersonal', label: 'personal-history entries' },
  familiarRelationshipTypes: {
    name: 'familiarRelationshipType',
    label: 'family relationship types',
  },
} as const satisfies Readonly<Record<string, CatalogDescriptor>>;

export type AgentCatalogKey = keyof typeof AGENT_CATALOGS;
export type ReferenceCatalogKey = keyof typeof REFERENCE_CATALOGS;

export const AGENT_CATALOG_KEYS = Object.keys(AGENT_CATALOGS) as [
  AgentCatalogKey,
  ...AgentCatalogKey[],
];
export const REFERENCE_CATALOG_KEYS = Object.keys(REFERENCE_CATALOGS) as [
  ReferenceCatalogKey,
  ...ReferenceCatalogKey[],
];

/** Describe a catalog for a tool description, so the enum documents itself. */
export function describeCatalogs(catalogs: Readonly<Record<string, CatalogDescriptor>>): string {
  return Object.entries(catalogs)
    .map(([key, descriptor]) => `\`${key}\` (${descriptor.label})`)
    .join(', ');
}
