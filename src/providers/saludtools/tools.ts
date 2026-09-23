import { z } from 'zod';

import { ProviderErrorCode } from '../../core/errors';
import { definePaginatedList, type PaginatedHandlerResult } from '../../core/pagination';
import { defineTool, err, ok, type ToolDefinition, type ToolOutcome } from '../../core/tool';
import {
  AGENT_CATALOGS,
  AGENT_CATALOG_KEYS,
  REFERENCE_CATALOGS,
  REFERENCE_CATALOG_KEYS,
  describeCatalogs,
  type CatalogDescriptor,
} from './catalogs';
import type { SaludtoolsClient } from './client';
import {
  isPatientNotFound,
  isRecordAbsent,
  unwrapSaludtools,
  unwrapSaludtoolsCatalog,
} from './errors';
import { SLUG } from './manifest';
import {
  AGENDA_FIELDS,
  APPOINTMENT_FIELDS,
  PATIENT_FIELDS,
  project,
  projectAll,
} from './projections';

/*
 * SCOPE OF THIS FILE — read before adding a tool.
 *
 * Phases 1 and 2 of `docs/design/saludtools-provider/grill-notes.md`: the agenda loop and the
 * catalogs. Both have request AND response shapes documented with concrete examples, so they can be
 * written, projected and tested now.
 *
 * Phases 3 and 4 — the clinical reads and writes — are NOT here, and their absence is a decision:
 *
 * - **The clinical READS cannot be projected yet.** D6 requires an allow-list of fields, and the
 *   vendor documents no response body for a clinical history, an exam result, a paraclinic or an
 *   antecedent. Writing them today means either inventing field names or returning raw clinical PHI
 *   unprojected. Both are worse than waiting.
 * - **The clinical WRITES cannot be typed yet.** Their request bodies exist as single examples —
 *   `CLINIC_HISTORY/CREATE` is 5.4 KB of nested clinical JSON — with no field table saying which
 *   parts are required, which repeat and which are catalog ids. A strict zod schema derived from one
 *   example is a guess wearing a compiler's approval.
 *
 * Both unblock the same way: a credential (Q1) and one recorded round trip per module. The phases are
 * designed; they are not fabricated.
 */

/** A patient's identity in SaludTools: the document type id plus the number. */
const documentRef = {
  documentType: z
    .number()
    .int()
    .positive()
    .describe(
      'Identity document type id — from the `documentTypes` catalog (1 = cédula de ciudadanía)',
    ),
  documentNumber: z
    .string()
    .min(1)
    .describe('Identity document number, digits as the clinic holds them'),
};

/** `yyyy-MM-dd`, the format the vendor documents for `birthDate`. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-MM-dd');

/**
 * `yyyy-MM-dd HH:mm` — the format the vendor documents for `startAppointment`/`endAppointment`. A
 * space, not a `T`, and no timezone: the clinic's own local time, which is why nothing here converts
 * it. Validated rather than parsed, so a caller's mistake is a typed input error instead of a 412
 * from a provider that will not say which field it disliked.
 */
const localDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    'expected "yyyy-MM-dd HH:mm" in the clinic\'s local time',
  );

/**
 * The consultation modality, as a STRING validated against the live catalog — deliberately not an
 * enum, and this is a correction, not a shortcut.
 *
 * The vendor's portal documents exactly three values: `CONVENTIONAL`, `TELEMEDICINE`, `DOMICILIARY`.
 * The live `parametric/attentionModality` catalog (Observed 2026-09-21, production) returns at least
 * twelve — `ASSISTED`, `NO_APLICA`, `INTRAMULAR`, `EXTRAMURAL_MOBILE_UNIT`, `EXTRAMURAL_HOME`,
 * `EXTRAMURAL_HEALTH_DAY`, four `TELEMEDICINE_*` variants — and **`DOMICILIARY` is not among them.**
 * The documented enum was wrong in both directions: it would have rejected every modality a real
 * clinic actually uses and accepted one the provider does not know.
 *
 * So the catalog is the source of truth and the agent is told to read it. A closed list here is a
 * hard-coded guess about a set the vendor extends and each clinic enables differently — and when the
 * guess is wrong the cost lands on a patient who cannot be booked, which is the wrong way to lose a
 * tie. An unknown value fails at the provider, with the provider's own reason; a value this adapter
 * rejects fails with ours, and ours would have been mistaken.
 */
const modality = z
  .string()
  .min(1)
  .describe(
    'Consultation modality — a `value` from the `attentionModalities` catalog (e.g. CONVENTIONAL, ' +
      'TELEMEDICINE, EXTRAMURAL_HOME). Read the catalog; do not guess, the list is longer than it looks',
  );

function toOutcome(result: ReturnType<typeof unwrapSaludtools>): ToolOutcome {
  return result.ok ? ok(result.data) : err(result.code, result.message);
}

/**
 * The outcome of a WRITE. Observed 2026-09-22: SaludTools answers a create with the new id in the
 * ENVELOPE (`{"id": 6923470, …, "body": null}`) — the mirror image of a read, where the record is in
 * `body` and the envelope id is null.
 *
 * Projecting `body` here, as the reads do, turned a successful registration into `PROVIDER_ERROR`
 * with the patient already created — and an agent told its call failed creates a duplicate on retry.
 * So a write reports what a write actually produces: that it happened, and the id if there is one.
 */
function written(result: ReturnType<typeof unwrapSaludtools>, idKey: string): ToolOutcome {
  if (!result.ok) return err(result.code, result.message);
  return ok({
    ok: true,
    ...(result.recordId !== undefined ? { [idKey]: result.recordId } : {}),
  });
}

/**
 * SaludTools refuses a page larger than 20, and the gateway's default is 25 — so **every paginated
 * call failed** until this clamp existed.
 *
 * Observed 2026-09-21: `{"code": 412, "message": "La cantidad maxima de elementos a consultar debe
 * ser menor a 20"}`. The message is off by one — `size: 20` is accepted, `size: 25` is not — so the
 * ceiling is 20 inclusive, measured rather than read.
 *
 * Clamped rather than rejected. A caller asking for 25 gets 20 records instead of an error, which is
 * the right trade for a limit that is the provider's and not the caller's business; the uniform
 * envelope echoes the requested `pageSize`, so a page may carry fewer items than it asked for. Siigo
 * documents the same asymmetry from the other direction (it rounds a small page size up).
 */
const MAX_PROVIDER_PAGE_SIZE = 20;

/**
 * Translate the gateway's pagination into SaludTools' own.
 *
 * Two mismatches, both silent if you get them wrong:
 * - **`page` is 0-based here, 1-based in the gateway** (`core/pagination`), which every other
 *   provider publishes. Off by one and every search skips its first page — a bug that presents as
 *   "the clinic has no appointments tomorrow", which is a sentence a patient would believe.
 * - **`size` is capped at 20** (see above), and it travels inside a nested `pageable` object rather
 *   than at the top level, whatever the vendor's *Buscar citas* page says.
 */
function pageable(page: number, pageSize: number): { page: number; size: number } {
  return { page: page - 1, size: Math.min(pageSize, MAX_PROVIDER_PAGE_SIZE) };
}

/**
 * Unwrap a SaludTools `Page` into the page the uniform `PaginatedResult` envelope is built from.
 * `content` carries the records; `totalPages`/`totalElements` carry the totals. Everything else
 * Spring emits (`sort`, `first`, `last`, `numberOfElements`, `empty`, the nested `pageable`) is
 * derivable or already in our envelope, so it is dropped rather than passed through.
 */
function toPage(
  result: ReturnType<typeof unwrapSaludtools>,
  fields: readonly string[],
): PaginatedHandlerResult<Record<string, unknown>> {
  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  const env = result.data as {
    readonly content?: readonly unknown[];
    readonly totalPages?: number;
    readonly totalElements?: number;
  } | null;

  const content = Array.isArray(env?.content) ? env.content : [];
  return {
    ok: true,
    items: projectAll(content, fields),
    ...(typeof env?.totalPages === 'number' ? { totalPages: env.totalPages } : {}),
    ...(typeof env?.totalElements === 'number' ? { totalResults: env.totalElements } : {}),
  };
}

/** A catalog read, shared by the agent-facing tool and the control-plane one. */
function readCatalog(
  client: SaludtoolsClient,
  descriptor: CatalogDescriptor,
  request: Parameters<SaludtoolsClient['parametric']>[1],
  page: number | undefined,
  filter: number | undefined,
): ReturnType<SaludtoolsClient['parametric']> {
  const params: Record<string, string | number | undefined> = {};
  // Only the catalogs the vendor documents as paged take `page`, and they are 0-based like everything
  // else here. A `page` sent to a catalog that does not expect one is a 412 waiting to happen.
  if (descriptor.paged === true && page !== undefined) params.page = page - 1;
  if (descriptor.filterParam !== undefined && filter !== undefined) {
    params[descriptor.filterParam] = filter;
  }
  return client.parametric(descriptor.name, request, params);
}

/**
 * Build the SaludTools tools.
 *
 * No `toolFactory<M>()` and no context: SaludTools needs no per-call routing context, so `clinic`
 * travels as an explicit argument on the tools that need it (see `manifest.ts`, Q7).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input types (heterogeneous tool collection); call-site types stay sound
export function buildSaludtoolsTools(client: SaludtoolsClient): readonly ToolDefinition<any>[] {
  return [
    /* ─────────────────────────── Phase 1 · patients ─────────────────────────── */

    defineTool({
      name: `mcp_${SLUG}_get_patient`,
      description:
        "Look up one patient in the clinic's records by identity document. Returns " +
        '`{found: true, patient}` with their name, contact details, insurer and `habeasData` — the ' +
        "clinic's record of whether the patient authorized being contacted — or `{found: false}` if " +
        'nobody holds that document, which is an answer, not an error: the patient can then be ' +
        'registered. Use it to recognize the person writing before acting for them.',
      input: z.object({ ...documentRef }).strict(),
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) => {
        const result = unwrapSaludtools(
          await client.event(
            'PATIENT',
            'READ',
            { documentType: args.documentType, documentNumber: args.documentNumber },
            ctx.request,
          ),
          'get patient',
        );
        /*
         * "No patient holds that document" is a FACT, and it comes back looking like a failure —
         * SaludTools reports it with the same `412` it uses for a malformed request (see
         * `isPatientNotFound`). Reporting it as `PROVIDER_INVALID_INPUT` would tell the agent it
         * built a bad call, and the two situations call for opposite next moves: fix the request, or
         * offer to register the person.
         *
         * `found` names which one it is, so the agent never has to infer it from an absence — the
         * shape of mistake that has cost us real production bugs.
         */
        /*
         * Structural signal first, prose second. Production answers an unknown document with a
         * SUCCESS carrying a null body (`{"code": 200, "body": null}`); the vendor's docs show a 412
         * with a different sentence. Both mean the same thing and both are handled.
         */
        if (isRecordAbsent(result) || isPatientNotFound(result)) return ok({ found: false });
        if (!result.ok) return err(result.code, result.message);
        const patient = project(result.data, PATIENT_FIELDS);
        if (patient === null) {
          return err(
            ProviderErrorCode.PROVIDER_ERROR,
            'SaludTools get patient returned no record in its envelope body',
          );
        }
        return ok({ found: true, patient });
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_create_patient`,
      description:
        "Register a new patient in the clinic's records. Required before an appointment can be " +
        'booked for someone the clinic does not have yet. `habeasData` must be stated explicitly — ' +
        'it records whether the patient authorized being contacted.',
      input: z
        .object({
          firstName: z.string().min(1),
          secondName: z.string().optional(),
          firstLastName: z.string().min(1),
          secondLastName: z.string().optional(),
          birthDate: isoDate,
          gender: z.number().int().positive().describe('Gender id — from the `genders` catalog'),
          ...documentRef,
          phone: z.string().optional(),
          cellPhone: z.string().optional(),
          email: z.string().email().optional(),
          eps: z.number().int().positive().describe('Health insurer id — from the `eps` catalog'),
          /*
           * REQUIRED, and not because the provider demands it.
           *
           * `habeasData` records whether this patient authorized being contacted. If it were optional,
           * an omission would mean two completely different things — "nobody asked them yet" and
           * "they said no" — and the two call for opposite behaviour. A default would silently pick
           * one, and the one a default picks is always the wrong one to guess about consent.
           *
           * Making it required moves the decision to the caller, who is the only party that knows.
           */
          habeasData: z
            .boolean()
            .describe(
              'Did the patient authorize being contacted? State it; there is no safe default',
            ),
        })
        .strict(),
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            await client.event('PATIENT', 'CREATE', args, ctx.request),
            'create patient',
          ),
          'patientId',
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_update_patient`,
      description:
        "Update a patient's details in the clinic's records — contact information, insurer, or the " +
        '`habeasData` authorization. The patient is identified by document type and number; the ' +
        'document itself cannot be changed this way.',
      input: z
        .object({
          firstName: z.string().min(1),
          secondName: z.string().optional(),
          firstLastName: z.string().min(1),
          secondLastName: z.string().optional(),
          birthDate: isoDate,
          gender: z.number().int().positive(),
          ...documentRef,
          phone: z.string().optional(),
          cellPhone: z.string().optional(),
          email: z.string().email().optional(),
          eps: z.number().int().positive(),
          habeasData: z.boolean(),
        })
        .strict(),
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            await client.event('PATIENT', 'UPDATE', args, ctx.request),
            'update patient',
          ),
          'patientId',
        ),
    }),

    /* ─────────────────────────── Phase 1 · the agenda ─────────────────────────── */

    definePaginatedList({
      name: `mcp_${SLUG}_get_agenda`,
      description:
        "What is ALREADY BOOKED in a time window — the clinic's agenda, optionally narrowed to one " +
        'doctor or one site. Returns booked intervals with no patient information at all. ' +
        'SaludTools does not publish free slots, opening hours or appointment lengths: combine this ' +
        "with the clinic's own schedule to work out when someone can be seen.",
      input: z
        .object({
          startAppointment: localDateTime.describe('Start of the window to inspect'),
          endAppointment: localDateTime.describe('End of the window to inspect'),
          doctorDocumentType: z.number().int().positive().optional(),
          doctorDocumentNumber: z.string().min(1).optional(),
          clinic: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Site id — from the `clinics` catalog'),
          stateAppointment: z.string().min(1).optional(),
        })
        .strict(),
      // No identityPolicy, and that is the whole point of the AGENDA_FIELDS projection: this tool
      // reaches nobody's personal records, so it is answerable in a patient-facing channel. See
      // grill-notes D7 — and do not add a patient filter to this tool, add it to the one below.
      handler: async (args, ctx) => {
        const { page, pageSize, ...filters } = args;
        return toPage(
          unwrapSaludtools(
            await client.event(
              'APPOINTMENT',
              'SEARCH',
              { ...filters, pageable: pageable(page, pageSize) },
              ctx.request,
            ),
            'get agenda',
          ),
          AGENDA_FIELDS,
        );
      },
    }),

    definePaginatedList({
      name: `mcp_${SLUG}_list_patient_appointments`,
      description:
        "One patient's own appointments, newest page first, optionally narrowed to a time window or " +
        'a state. Returns the full appointment including its doctor, site, modality and the ' +
        "patient's confirmation state.",
      input: z
        .object({
          patientDocumentType: z.number().int().positive(),
          patientDocumentNumber: z.string().min(1),
          startAppointment: localDateTime.optional(),
          endAppointment: localDateTime.optional(),
          stateAppointment: z.string().min(1).optional(),
        })
        .strict(),
      identityPolicy: { mode: 'subject-bound', identityFields: ['patientDocumentNumber'] },
      handler: async (args, ctx) => {
        const { page, pageSize, ...filters } = args;
        return toPage(
          unwrapSaludtools(
            await client.event(
              'APPOINTMENT',
              'SEARCH',
              { ...filters, pageable: pageable(page, pageSize) },
              ctx.request,
            ),
            'list patient appointments',
          ),
          APPOINTMENT_FIELDS,
        );
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_get_appointment`,
      description:
        'Read one appointment by its SaludTools id. Returns `{found: true, appointment}`, or ' +
        '`{found: false}` when no appointment carries that id — an answer, not an error.',
      input: z.object({ id: z.string().min(1) }).strict(),
      // The id names no person, but the RESULT is one patient's appointment — so the tool reaches a
      // person's record without taking their identifier, which is what `subject-scoped` means.
      identityPolicy: { mode: 'subject-scoped' },
      handler: async (args, ctx) => {
        const result = unwrapSaludtools(
          await client.event('APPOINTMENT', 'READ', { id: args.id }, ctx.request),
          'get appointment',
        );
        // Same shape as `get_patient`, for the same reason: an id that matches nothing is an answer.
        // Reported as PROVIDER_ERROR it would read as "SaludTools is broken" to the agent.
        if (isRecordAbsent(result)) return ok({ found: false });
        if (!result.ok) return err(result.code, result.message);
        const appointment = project(result.data, APPOINTMENT_FIELDS);
        if (appointment === null) {
          return err(
            ProviderErrorCode.PROVIDER_ERROR,
            'SaludTools get appointment returned no record in its envelope body',
          );
        }
        return ok({ found: true, appointment });
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_create_appointment`,
      description:
        'Book an appointment for a patient with a doctor. The patient must already exist in the ' +
        "clinic's records. Check `get_agenda` first: SaludTools accepts what it is given and does " +
        "not police the clinic's opening hours.",
      input: z
        .object({
          startAppointment: localDateTime,
          endAppointment: localDateTime,
          patientDocumentType: z.number().int().positive(),
          patientDocumentNumber: z.string().min(1),
          doctorDocumentType: z.number().int().positive(),
          doctorDocumentNumber: z.string().min(1),
          modality,
          clinic: z.number().int().positive(),
          stateAppointment: z.string().min(1).optional(),
          appointmentType: z.string().min(1).optional(),
          comment: z.string().optional(),
        })
        .strict(),
      identityPolicy: { mode: 'subject-bound', identityFields: ['patientDocumentNumber'] },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            await client.event('APPOINTMENT', 'CREATE', args, ctx.request),
            'create appointment',
          ),
          'appointmentId',
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_update_appointment`,
      description:
        'Move or change an existing appointment — its time, doctor, site, modality, state, or the ' +
        "patient's confirmation (`notificationState`). Identified by its SaludTools id. " +
        '**Send the whole appointment, not just what changed**: read it first with `get_appointment` ' +
        'or `list_patient_appointments`, then resend every field with your edits applied. ' +
        '**To cancel, this is the tool** — set `stateAppointment` to the cancelled value from the ' +
        '`appointmentStates` catalog. Cancelling this way keeps the appointment in the record; ' +
        'deleting it does not, and the clinic can no longer audit what happened.',
      input: z
        .object({
          id: z.string().min(1),
          startAppointment: localDateTime,
          endAppointment: localDateTime,
          patientDocumentType: z.number().int().positive(),
          patientDocumentNumber: z.string().min(1),
          doctorDocumentType: z.number().int().positive(),
          doctorDocumentNumber: z.string().min(1),
          modality,
          clinic: z.number().int().positive(),
          stateAppointment: z.string().min(1).optional(),
          // A string, for the same reason `modality` is one: the vendor documents three values
          // (ATTEND / NOT_ATTEND / NOT_RESPOND) and publishes no catalog to confirm them, and its
          // documented `stateAppointment` list turned out to have eleven entries, not the handful
          // implied. An unverified closed list is a guess that fails on the patient's side.
          notificationState: z
            .string()
            .min(1)
            .optional()
            .describe(
              "The patient's confirmation: ATTEND, NOT_ATTEND or NOT_RESPOND per the vendor's docs",
            ),
          appointmentType: z.string().min(1).optional(),
          comment: z.string().optional(),
        })
        .strict(),
      identityPolicy: { mode: 'subject-bound', identityFields: ['patientDocumentNumber'] },
      handler: async (args, ctx) =>
        written(
          unwrapSaludtools(
            await client.event('APPOINTMENT', 'UPDATE', args, ctx.request),
            'update appointment',
          ),
          'appointmentId',
        ),
    }),

    /* ─────────────────────────── Phase 2 · catalogs ─────────────────────────── */

    defineTool({
      name: `mcp_${SLUG}_get_catalog`,
      description:
        `Read one of the clinic's reference catalogs, needed to fill the ids the other tools take: ` +
        `${describeCatalogs(AGENT_CATALOGS)}. Returns \`{id, name}\` entries.`,
      input: z
        .object({
          catalog: z.enum(AGENT_CATALOG_KEYS),
          page: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
              'Only used by the paged catalogs (`eps`, `specialties`); 1 is the first page',
            ),
        })
        .strict(),
      handler: async (args, ctx) =>
        toOutcome(
          // The CATALOG unwrap, not the event one: this surface has no envelope, and a paged catalog
          // answers with a bare flattened page that the event unwrap rejects outright.
          unwrapSaludtoolsCatalog(
            await readCatalog(
              client,
              AGENT_CATALOGS[args.catalog],
              ctx.request,
              args.page,
              undefined,
            ),
            `get catalog ${args.catalog}`,
          ),
        ),
    }),

    /* ───────────── Control plane · documented, and never on the agent's menu ───────────── */

    defineTool({
      name: `mcp_${SLUG}_get_reference_catalog`,
      description: `Read one of SaludTools' clinical reference catalogs: ${describeCatalogs(REFERENCE_CATALOGS)}.`,
      input: z
        .object({
          catalog: z.enum(REFERENCE_CATALOG_KEYS),
          page: z.number().int().positive().optional(),
          principleAct: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
              'Required by `atcConcentrations`: the active principle whose concentrations to list',
            ),
        })
        .strict(),
      // Withdrawn from the menu: these are the catalogs a clinical write payload needs — CIE-10,
      // active principles, concentrations. An agent paging a national diagnosis codebook is not a
      // move it should be able to choose.
      controlPlane: true,
      handler: async (args, ctx) => {
        const descriptor: CatalogDescriptor = REFERENCE_CATALOGS[args.catalog];
        // Checked here so the caller is told which field is missing. Sent without it, production
        // answers 412 "Required Long parameter 'principleact' is not present" — correct, and a
        // round trip to learn something we already knew.
        if (descriptor.filterRequired === true && args.principleAct === undefined) {
          return err(
            ProviderErrorCode.INVALID_INPUT,
            `SaludTools catalog ${args.catalog} requires principleAct`,
          );
        }
        return toOutcome(
          unwrapSaludtoolsCatalog(
            await readCatalog(client, descriptor, ctx.request, args.page, args.principleAct),
            `get reference catalog ${args.catalog}`,
          ),
        );
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_search_patients`,
      description:
        "Search the clinic's patients by partial name or document. Returns SaludTools' own page " +
        'object, with the patient records projected.',
      input: z
        .object({
          firstName: z.string().min(1).optional(),
          firstLastName: z.string().min(1).optional(),
          documentNumber: z.string().min(1).optional(),
          page: z.number().int().positive().default(1),
          size: z.number().int().positive().max(100).default(25),
        })
        .strict(),
      /*
       * Control-plane, and this is the one withdrawal worth arguing for.
       *
       * With every filter optional, this is a paged walk of the clinic's entire patient list; with a
       * guessed surname it hands back a stranger's record. An agent talking to a patient has no job
       * that `get_patient` does not do — that one takes a document number, which the person writing
       * either knows or does not.
       *
       * It is BUILT because the operation is real and a consumer performing a migration or a
       * reconciliation needs it, and the alternative — leaving it unimplemented — hides the reasoning
       * instead of recording it. `subject-scoped` is declared anyway, so that if it is ever published,
       * xcale-backend#1020's gate already knows what it is.
       *
       * WHY NOT `definePaginatedList`, unlike every other list here: that helper does not forward
       * `controlPlane`. It re-declares its own parameter type and forwards `requiredScopes` and
       * `identityPolicy` only, so a paginated tool cannot be a control-plane one — the compiler
       * rejects the field rather than dropping it, which is the good version of that failure (the
       * same helper silently dropped `identityPolicy` until xcale-mcp-server#101 caught it). Fixing
       * the helper means editing `src/core`, which the add-provider golden rule puts behind an
       * exceptional ADR, and widening shared infra to serve one withdrawn tool is not a trade worth
       * making here. So this one takes explicit `page`/`size` and returns the provider's own page
       * verbatim (Fidelity over Unification) — acceptable precisely because no agent ever sees it.
       * **Filed for the harness, not forgotten:** matesjara/xcale-harness#20 already tracks where
       * this recipe and the real providers disagree.
       */
      controlPlane: true,
      identityPolicy: { mode: 'subject-scoped' },
      handler: async (args, ctx) => {
        const { page, size, ...filters } = args;
        const result = unwrapSaludtools(
          await client.event(
            'PATIENT',
            'SEARCH',
            { ...filters, pageable: pageable(page, size) },
            ctx.request,
          ),
          'search patients',
        );
        if (!result.ok) return err(result.code, result.message);
        const env = result.data as { readonly content?: readonly unknown[] } | null;
        const content = Array.isArray(env?.content) ? env.content : [];
        return ok({ ...(env ?? {}), content: projectAll(content, PATIENT_FIELDS) });
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_delete_appointment`,
      description: "Delete an appointment from the clinic's records by its SaludTools id.",
      input: z.object({ id: z.string().min(1) }).strict(),
      /*
       * Control-plane rather than the agent's way to cancel.
       *
       * Whether a cancelled appointment should be DELETED or kept with a cancelled `stateAppointment`
       * is Q4 — unresolved, and partly the clinic's call. Until it is answered, the destructive one
       * stays off the menu and cancelling is `update_appointment` with the clinic's own cancelled
       * state, which loses nothing. A deleted appointment is a fact the clinic can no longer audit.
       */
      controlPlane: true,
      identityPolicy: { mode: 'subject-scoped' },
      handler: async (args, ctx) =>
        toOutcome(
          unwrapSaludtools(
            await client.event('APPOINTMENT', 'DELETE', { id: args.id }, ctx.request),
            'delete appointment',
          ),
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_delete_patient`,
      description: "Delete a patient from the clinic's records.",
      input: z
        .object({
          firstName: z.string().min(1),
          secondName: z.string().optional(),
          firstLastName: z.string().min(1),
          secondLastName: z.string().optional(),
          birthDate: isoDate,
          gender: z.number().int().positive(),
          ...documentRef,
          phone: z.string().optional(),
          cellPhone: z.string().optional(),
          email: z.string().email().optional(),
          eps: z.number().int().positive(),
        })
        .strict(),
      // Deleting a person's medical record is not a conversational move under any tenant's rules.
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) =>
        toOutcome(
          unwrapSaludtools(
            await client.event('PATIENT', 'DELETE', args, ctx.request),
            'delete patient',
          ),
        ),
    }),
  ];
}
