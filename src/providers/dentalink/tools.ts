import { z } from 'zod';

import { defineTool, ok, type ToolDefinition, type ToolOutcome } from '../../core/tool';
import type { DentalinkClient } from './client';
import { unwrapDentalink } from './errors';
import { SLUG } from './manifest';

/** No-argument input, for the reference-data reads that take no filter. */
const noArgs = z.object({}).strict();

function toOutcome(result: ReturnType<typeof unwrapDentalink>): ToolOutcome {
  return result.ok ? ok(result.data) : { ok: false, code: result.code, message: result.message };
}

// ---------------------------------------------------------------------------
// Inputs (zod, the single source of truth — JSON Schema is generated from these).
// Shapes come from the api-contract §1.3; every field marked ⏳ is doc-derived and unverified against
// the live API (no sandbox exists — api-contract §8).
// ---------------------------------------------------------------------------

const listServicesInput = z.object({ idEspecialidad: z.string().optional() }).strict();

const listAvailableSlotsInput = z
  .object({
    idSucursal: z.string().min(1),
    duracion: z.number().int().positive(), // minutes (required by GET /agendas, doc-confirmed)
    fecha: z.string().optional(), // 'YYYY-MM-DD'; defaults to today upstream
    idDentista: z.string().optional(), // omit ⇒ online-enabled dentists
  })
  .strict();

const findPatientInput = z
  .object({ documento: z.string().min(1) }) // cédula/RUT — the dedup key (feature-design AD-6)
  .strict();

const listProfessionalsInput = z
  .object({
    idSucursal: z.string().optional(),
    idEspecialidad: z.string().optional(),
  })
  .strict();

// ⏳ Required fields unverified — confirm against POST /pacientes before freezing (api-contract §8).
const createPatientInput = z
  .object({
    nombre: z.string().min(1),
    apellidos: z.string().min(1),
    documento: z.string().min(1),
    celular: z.string().optional(),
    email: z.string().email().optional(),
    fechaNacimiento: z.string().optional(), // 'YYYY-MM-DD'
  })
  .strict();

// ⏳ Required fields unverified — confirm against POST /citas before freezing (api-contract §8).
const createAppointmentInput = z
  .object({
    idPaciente: z.string().min(1),
    idDentista: z.string().min(1),
    idSucursal: z.string().min(1),
    fecha: z.string().min(1), // 'YYYY-MM-DD'
    horaInicio: z.string().min(1), // 'HH:MM'
    duracion: z.number().int().positive(),
    idMotivo: z.string().optional(),
    idTratamiento: z.string().optional(),
    comentarios: z.string().optional(),
  })
  .strict();

// ⏳ Server-side read (CRM sync), NOT patient-facing — confirm the citas endpoint/params (api-contract §8).
const listAppointmentsInput = z
  .object({
    idSucursal: z.string().min(1),
    fechaInicio: z.string().optional(), // 'YYYY-MM-DD'
    fechaFin: z.string().optional(), // 'YYYY-MM-DD'
  })
  .strict();

/**
 * Dentalink's `q` filter column for a patient's identity document. ⏳ Confirm the real column name
 * against the live API (api-contract §8, Q-5): `rut` vs `documento` vs `numero_documento`.
 */
const PATIENT_DOCUMENT_COLUMN = 'rut';

/** ⏳ Column for the appointment date in the `q` filter — confirm against the live API (api-contract §8). */
const APPOINTMENT_DATE_COLUMN = 'fecha';

/**
 * Dentalink `q` filter columns for scoping the dentists list. ⏳ Unverified — api-contract §8 must
 * confirm whether `/dentistas` is `q`-filterable and by which columns.
 */
const PROFESSIONAL_BRANCH_COLUMN = 'id_sucursal';
const PROFESSIONAL_SPECIALTY_COLUMN = 'id_especialidad';

/** Build Dentalink's JSON `q` filter: `{"<column>":{"eq":"<value>"}}` (confirmed syntax, doc). */
function eqFilter(column: string, value: string): string {
  return JSON.stringify({ [column]: { eq: value } });
}

/**
 * Pull the first matching patient's id out of a Dentalink `GET /pacientes?q=` list response — and
 * NOTHING else. Curating to the id is what keeps a patient's personal fields off the channel: the
 * document resolves the writer's OWN ficha for the booking flow (feature-design AD-4 / grill CQ2), and
 * existence + id is all the agent needs. There is no third-party PII to leak because there is no
 * personal field in the result at all.
 *
 * ⏳ The list envelope and the id field name are unverified (api-contract §8). This reads the common
 * shapes defensively and returns `undefined` when it cannot find one (⇒ `exists: false`) — the
 * safe direction, since the worst case is a missed match, never a leak.
 */
function firstPatientId(data: unknown): string | undefined {
  const c = data as {
    objects?: unknown;
    data?: unknown;
    results?: unknown;
  };
  const list = Array.isArray(data)
    ? data
    : Array.isArray(c.objects)
      ? c.objects
      : Array.isArray(c.data)
        ? c.data
        : Array.isArray(c.results)
          ? c.results
          : [];
  const first = list[0] as { id?: unknown; id_paciente?: unknown } | undefined;
  const id = first?.id ?? first?.id_paciente;
  return id === undefined || id === null ? undefined : String(id);
}

/**
 * The Dentalink tool set. v1 = read + additive reserve path (feature-design §5). Result shapes are
 * returned **verbatim** (Fidelity over Unification) and every wire field name mapped below is
 * PROVISIONAL until verified against the real API with a token (no sandbox — api-contract §8).
 */
export function buildDentalinkTools(
  client: DentalinkClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any>> {
  return [
    // --- Structure reads -----------------------------------------------------
    defineTool({
      name: `mcp_${SLUG}_list_branches`,
      description:
        "List the clinic's active branches (sucursales). Returns Dentalink's records verbatim; each " +
        'branch carries its `id` (the `id_sucursal` other tools take as an argument) and `nombre`. ' +
        'This is also the connection probe — a cheap, no-argument read that proves the token has read ' +
        'scope.',
      input: noArgs,
      handler: async (_args, ctx) =>
        toOutcome(unwrapDentalink(await client.get('sucursales', ctx.request), 'list branches')),
    }),
    defineTool({
      name: `mcp_${SLUG}_list_specialties`,
      description:
        "List the clinic's specialties (especialidades). Returns records verbatim; each carries `id` " +
        '(the `id_especialidad` used to look up appointment reasons) and `nombre`.',
      input: noArgs,
      handler: async (_args, ctx) =>
        toOutcome(
          unwrapDentalink(await client.get('especialidades', ctx.request), 'list specialties'),
        ),
    }),
    defineTool({
      name: `mcp_${SLUG}_list_professionals`,
      description:
        "List the clinic's dentists/professionals (dentistas). Optionally scope by `idSucursal` and/or " +
        '`idEspecialidad` (server-side via the `q` filter). Returns records verbatim; each carries `id` ' +
        '(the `id_dentista` used for availability and booking) and `nombre`.',
      input: listProfessionalsInput,
      handler: async (args, ctx) => {
        // ⏳ Filter columns unverified — see PROFESSIONAL_*_COLUMN (api-contract §8).
        const filter: Record<string, { eq: string }> = {};
        if (args.idSucursal) filter[PROFESSIONAL_BRANCH_COLUMN] = { eq: args.idSucursal };
        if (args.idEspecialidad)
          filter[PROFESSIONAL_SPECIALTY_COLUMN] = { eq: args.idEspecialidad };
        const params = Object.keys(filter).length > 0 ? { q: JSON.stringify(filter) } : undefined;
        return toOutcome(
          unwrapDentalink(await client.get('dentistas', ctx.request, params), 'list professionals'),
        );
      },
    }),
    defineTool({
      name: `mcp_${SLUG}_list_treatments`,
      description:
        "List the clinic's active treatments/procedures (prestaciones — the billing catalog). Returns " +
        'records verbatim. Distinct from the appointment reasons in list_services.',
      input: noArgs,
      handler: async (_args, ctx) =>
        toOutcome(
          unwrapDentalink(await client.get('prestaciones', ctx.request), 'list treatments'),
        ),
    }),
    defineTool({
      name: `mcp_${SLUG}_list_services`,
      description:
        'List the appointment reasons (motivos de atención) — what the patient is booking for ' +
        '(cleaning, valuation, general consult). Pass `idEspecialidad` to scope the reasons to one ' +
        'specialty; omit it for all reasons. Returns records verbatim.',
      input: listServicesInput,
      handler: async (args, ctx) =>
        toOutcome(
          unwrapDentalink(
            // Vendor docs expose BOTH endpoints: `GET /motivosAtencionEspecialidad` (all) and
            // `GET /especialidades/{id_especialidad}/motivos` (per specialty). ⏳ Both are doc-derived
            // and unverified live — api-contract §1.2/§8.
            await client.get(
              args.idEspecialidad
                ? `especialidades/${encodeURIComponent(args.idEspecialidad)}/motivos`
                : 'motivosAtencionEspecialidad',
              ctx.request,
            ),
            'list services',
          ),
        ),
    }),
    // --- Agenda read ---------------------------------------------------------
    defineTool({
      name: `mcp_${SLUG}_list_available_slots`,
      description:
        'List free appointment time-blocks (bloques libres) at a branch for a given slot duration. ' +
        '`idSucursal` and `duracion` (minutes) are required; `fecha` (YYYY-MM-DD) defaults to today ' +
        'upstream; omit `idDentista` to search all online-enabled dentists. Returns blocks verbatim ' +
        '(each with its start/end time and the dentist).',
      input: listAvailableSlotsInput,
      handler: async (args, ctx) =>
        toOutcome(
          unwrapDentalink(
            await client.get('agendas', ctx.request, {
              id_sucursal: args.idSucursal,
              duracion: args.duracion,
              ...(args.fecha ? { fecha: args.fecha } : {}),
              ...(args.idDentista ? { id_dentista: args.idDentista } : {}),
            }),
            'list available slots',
          ),
        ),
    }),
    // --- Patient -------------------------------------------------------------
    defineTool({
      name: `mcp_${SLUG}_find_patient`,
      description:
        'Check whether a patient with a given identity document (cédula/RUT) exists in the clinic. ' +
        "Returns only `{ exists, id_paciente? }` — never the patient's personal data — so the booking " +
        'flow can reuse an existing ficha or create one. Empty ⇒ no such patient yet.',
      input: findPatientInput,
      handler: async (args, ctx) => {
        const res = unwrapDentalink(
          await client.get('pacientes', ctx.request, {
            q: eqFilter(PATIENT_DOCUMENT_COLUMN, args.documento),
          }),
          'find patient',
        );
        if (!res.ok) return { ok: false, code: res.code, message: res.message };
        // Curate to id-only: NEVER surface the patient's personal fields to the channel (data-privacy).
        const idPaciente = firstPatientId(res.data);
        return ok(
          idPaciente !== undefined ? { exists: true, id_paciente: idPaciente } : { exists: false },
        );
      },
    }),
    defineTool({
      name: `mcp_${SLUG}_create_patient`,
      description:
        'Create a basic patient record (ficha). Use only after find_patient returns no match. Returns ' +
        "Dentalink's created patient verbatim (with its `id_paciente`). Basic contact fields only — no " +
        'clinical data.',
      input: createPatientInput,
      handler: async (args, ctx) =>
        toOutcome(
          unwrapDentalink(
            // ⏳ Wire field names provisional — confirm against POST /pacientes (api-contract §8).
            await client.post('pacientes', ctx.request, {
              nombre: args.nombre,
              apellidos: args.apellidos,
              [PATIENT_DOCUMENT_COLUMN]: args.documento,
              ...(args.celular ? { celular: args.celular } : {}),
              ...(args.email ? { email: args.email } : {}),
              ...(args.fechaNacimiento ? { fecha_nacimiento: args.fechaNacimiento } : {}),
            }),
            'create patient',
          ),
        ),
    }),
    // --- Booking -------------------------------------------------------------
    defineTool({
      name: `mcp_${SLUG}_create_appointment`,
      description:
        'Book an appointment (cita) for a patient with a dentist at a branch, on a date/time, for a ' +
        'given duration. Returns the created appointment verbatim. On a slot conflict the call fails ' +
        'with an error — the consumer never retries blindly, it re-offers blocks (feature-design §6.3).',
      input: createAppointmentInput,
      handler: async (args, ctx) =>
        toOutcome(
          unwrapDentalink(
            // ⏳ Wire field names provisional — confirm against POST /citas (api-contract §8).
            await client.post('citas', ctx.request, {
              id_paciente: args.idPaciente,
              id_dentista: args.idDentista,
              id_sucursal: args.idSucursal,
              fecha: args.fecha,
              hora_inicio: args.horaInicio,
              duracion: args.duracion,
              ...(args.idMotivo ? { id_motivo: args.idMotivo } : {}),
              ...(args.idTratamiento ? { id_tratamiento: args.idTratamiento } : {}),
              ...(args.comentarios ? { comentarios: args.comentarios } : {}),
            }),
            'create appointment',
          ),
        ),
    }),
    // --- Server-side read (CRM sync; NOT for the patient-facing basket) ------
    defineTool({
      name: `mcp_${SLUG}_list_appointments`,
      description:
        "List a branch's appointments in a date window (cita agenda). **Server-side / staff read** " +
        "for the CRM appointment-event sync — it returns other patients' appointments, so a consumer " +
        'must NOT curate it into a patient-facing agent. Returns records verbatim.',
      input: listAppointmentsInput,
      handler: async (args, ctx) => {
        // ⏳ Endpoint + date-range filter provisional — confirm against the live API (api-contract §8).
        const range: Record<string, string> = {};
        if (args.fechaInicio) range.gte = args.fechaInicio;
        if (args.fechaFin) range.lte = args.fechaFin;
        const params =
          Object.keys(range).length > 0
            ? { q: JSON.stringify({ [APPOINTMENT_DATE_COLUMN]: range }) }
            : undefined;
        return toOutcome(
          unwrapDentalink(
            await client.get(
              `sucursales/${encodeURIComponent(args.idSucursal)}/citas`,
              ctx.request,
              params,
            ),
            'list appointments',
          ),
        );
      },
    }),
  ];
}
