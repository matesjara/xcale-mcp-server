import { z } from 'zod';

import {
  err,
  ok,
  type ToolDefinition,
  type ToolHandlerContext,
  toolFactory,
} from '../../core/tool';

import type { HimedClient } from './client';
import type { HimedContext } from './context';
import { envelopeRows, unwrapHimed, unwrapHimedScheduling } from './errors';

type Ctx = ToolHandlerContext<HimedContext>;

/** Autoagendamiento rows come back as JSON arrays of objects; guard the shape before projecting. */
function rows(data: unknown): ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

/**
 * The unified HiMed provider (ADR: himed-multi-credential-provider). One provider, three credential
 * groups — each tool declares its `credentialGroup` and the materializer injects that group's secret:
 *  - `demograficos` (api_key): patient writes on `m.medsas.co/.../Demograficos/*.php`.
 *  - `directorio` (api_key, the "Service token"): Sedes + Doctores on `m.medsas.co`. `list_locations`
 *    is the `connectionProbe`.
 *  - `autoagendamiento` (token + `codigo_servicio` context): the Autoagendamiento RPC endpoint.
 * Sandbox-verified (ship-log 2026-10-01): Demográficos dates are YYYY-MM-DD; scheduling dates DD-MM-YYYY
 * / times HH:mm:ss; availability keys the professional on `idEspecialista`; cancel needs `idPaciente`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildHimedTools(
  client: HimedClient,
): ReadonlyArray<ToolDefinition<any, HimedContext>> {
  const tool = toolFactory<HimedContext>();

  /** Autoagendamiento dispatch: adds `accion` + `codigo_servicio` (context); the materializer injects `token`. */
  const call = (ctx: Ctx, accion: string, fields: Record<string, unknown>) =>
    client.callScheduling(ctx.request, {
      accion,
      ...fields,
      codigo_servicio: ctx.metadata.codigo_servicio,
    });

  // ─── Demográficos (group: demograficos) ──────────────────────────────────
  const createPatient = tool({
    name: 'mcp_himed_create_patient',
    description:
      'Create a patient in HiMed (idempotent: also confirms an existing patient). Required by the ' +
      'scheduling flow, which can only book patients that already exist.',
    credentialGroup: 'demograficos',
    input: z
      .object({
        tipoDocumento: z
          .string()
          .min(1)
          .describe('Document type code (see HiMed reference catalog)'),
        idPaciente: z.string().min(4).max(20).describe('Patient document number'),
        primerNombre: z.string().min(1),
        primerApellido: z.string().min(1),
        fechaNacimiento: z
          .string()
          .min(1)
          .describe('Birth date, YYYY-MM-DD (confirmed against the sandbox 2026-10-01)'),
      })
      .strict(),
    handler: async (args, ctx) => {
      const res = await client.post('Demograficos/crearPaciente.php', ctx.request, {
        tipo_documento: args.tipoDocumento,
        id_paciente: args.idPaciente,
        primer_nombre: args.primerNombre,
        primer_apellido: args.primerApellido,
        fecha_nacimiento: args.fechaNacimiento,
      });
      const out = unwrapHimed(res, 'create_patient');
      return out.ok ? ok(out.data) : err(out.code, out.message);
    },
  });

  const updatePatient = tool({
    name: 'mcp_himed_update_patient',
    description:
      "Update a patient's modifiable demographic fields. tipoDocumento + idPaciente identify the " +
      'patient and cannot be changed here (use change_patient_document for that).',
    credentialGroup: 'demograficos',
    input: z
      .object({
        tipoDocumento: z.string().min(1),
        idPaciente: z.string().min(4).max(20),
        fields: z
          .record(z.string(), z.union([z.string(), z.number()]))
          .describe('Modifiable demographic fields to update (allow-listed at the consumer)'),
      })
      .strict(),
    handler: async (args, ctx) => {
      const res = await client.post('Demograficos/modificarPaciente.php', ctx.request, {
        tipo_documento: args.tipoDocumento,
        id_paciente: args.idPaciente,
        ...args.fields,
      });
      const out = unwrapHimed(res, 'update_patient');
      return out.ok ? ok(out.data) : err(out.code, out.message);
    },
  });

  const changePatientDocument = tool({
    name: 'mcp_himed_change_patient_document',
    description: "Change a patient's document type and/or number, with an audit reason.",
    credentialGroup: 'demograficos',
    input: z
      .object({
        tipoIdActual: z.string().min(1),
        idPacienteActual: z.string().min(1),
        tipoIdNuevo: z.string().min(1),
        idPacienteNuevo: z.string().min(1),
        motivoCambio: z.string().min(1),
      })
      .strict(),
    handler: async (args, ctx) => {
      const res = await client.post('Demograficos/modificarIdTipoIdPaciente.php', ctx.request, {
        tipo_id_actual: args.tipoIdActual,
        id_paciente_actual: args.idPacienteActual,
        tipo_id_nuevo: args.tipoIdNuevo,
        id_paciente_nuevo: args.idPacienteNuevo,
        motivo_cambio: args.motivoCambio,
      });
      const out = unwrapHimed(res, 'change_patient_document');
      return out.ok ? ok(out.data) : err(out.code, out.message);
    },
  });

  // ─── Directory (group: directorio) ───────────────────────────────────────
  const listLocations = tool({
    name: 'mcp_himed_list_locations',
    description:
      'List active clinic sedes (full directory) with address, optionally filtered by area.',
    credentialGroup: 'directorio',
    input: z
      .object({
        pais: z.string().optional(),
        departamento: z.string().optional(),
        ciudad: z.string().optional(),
      })
      .strict(),
    handler: async (args, ctx) => {
      const res = await client.post('Sedes/consultarSedes.php', ctx.request, {
        ...(args.pais !== undefined ? { pais: args.pais } : {}),
        ...(args.departamento !== undefined ? { departamento: args.departamento } : {}),
        ...(args.ciudad !== undefined ? { ciudad: args.ciudad } : {}),
      });
      const out = unwrapHimed(res, 'list_locations');
      if (!out.ok) return err(out.code, out.message);
      return ok(
        envelopeRows(out.data, 'info_sede').map((r) => ({
          idSede: r.id_sede,
          sede: r.sede,
          direccion: r.direccion,
          telefono: r.telefono,
          municipio: r.municipio,
        })),
      );
    },
  });

  const listDoctors = tool({
    name: 'mcp_himed_list_doctors',
    description:
      'List active health professionals (full directory), optionally filtered by specialty or user. ' +
      'Richer than the scheduling list; use for professional info beyond booking.',
    credentialGroup: 'directorio',
    input: z
      .object({
        tipoUser: z.string().optional().describe('User type filter (e.g. "2" = professional)'),
        idEspecialidad: z.string().optional(),
        idUsuario: z.string().optional(),
      })
      .strict(),
    handler: async (args, ctx) => {
      const res = await client.post('Usuarios/consultarUsuarios.php', ctx.request, {
        ...(args.tipoUser !== undefined ? { tipo_user: args.tipoUser } : {}),
        ...(args.idEspecialidad !== undefined ? { id_especialidad: args.idEspecialidad } : {}),
        ...(args.idUsuario !== undefined ? { id_usuario: args.idUsuario } : {}),
      });
      const out = unwrapHimed(res, 'list_doctors');
      if (!out.ok) return err(out.code, out.message);
      // Curate: drop the professional's contact PHI (email, phones, address, birth date).
      return ok(
        envelopeRows(out.data, 'usuarios').map((r) => ({
          idUsuario: r.id_usuario,
          nombres: r.nombres,
          apellidos: r.apellidos,
          rol: r.rol,
          idEspecialidad: r.id_especialidad,
        })),
      );
    },
  });

  // ─── Autoagendamiento (group: autoagendamiento) ──────────────────────────
  const patientExists = tool({
    name: 'mcp_himed_patient_exists',
    description:
      'Check whether a patient already exists in the clinic (required before booking). Returns the ' +
      "patient's name so the agent can confirm identity.",
    credentialGroup: 'autoagendamiento',
    identityPolicy: { mode: 'subject-scoped' },
    input: z.object({ idPaciente: z.string().min(4).max(20) }).strict(),
    handler: async (args, ctx) => {
      const out = unwrapHimedScheduling(await call(ctx, 'existePaciente', args), 'patient_exists');
      if (!out.ok) return err(out.code, out.message);
      const first = rows(out.data)[0];
      const found = !!first && Number(first.cantidad ?? 0) > 0;
      return ok(
        found
          ? { found: true, nombre: first.nombre, idEntidad: first.idEntidad }
          : { found: false },
      );
    },
  });

  const listSpecialties = tool({
    name: 'mcp_himed_list_specialties',
    description: 'List medical specialties available at a sede.',
    credentialGroup: 'autoagendamiento',
    input: z.object({ idSede: z.union([z.string(), z.number()]) }).strict(),
    handler: async (args, ctx) => {
      const out = unwrapHimedScheduling(
        await call(ctx, 'listarEspecialidades', args),
        'list_specialties',
      );
      if (!out.ok) return err(out.code, out.message);
      return ok(
        rows(out.data).map((r) => ({
          idEspecialidad: r.idEspecialidad,
          descripcion: r.descripcion,
        })),
      );
    },
  });

  const listProfessionals = tool({
    name: 'mcp_himed_list_professionals',
    description:
      'List health professionals at a sede for a specialty. idUsuario is the booking id.',
    credentialGroup: 'autoagendamiento',
    input: z
      .object({
        idSede: z.union([z.string(), z.number()]),
        idEspecialidad: z.string().min(1),
      })
      .strict(),
    handler: async (args, ctx) => {
      const out = unwrapHimedScheduling(
        await call(ctx, 'listarUsuarios', args),
        'list_professionals',
      );
      if (!out.ok) return err(out.code, out.message);
      return ok(
        rows(out.data).map((r) => ({
          idUsuario: r.idUsuario,
          usuario: r.usuario,
          especialidad: r.especialidad,
        })),
      );
    },
  });

  const listModalities = tool({
    name: 'mcp_himed_list_modalities',
    description:
      'List attention modalities (in-person, telemedicine, home) for a professional/sede.',
    credentialGroup: 'autoagendamiento',
    input: z
      .object({
        idUsuario: z.string().min(1),
        idSede: z.union([z.string(), z.number()]),
      })
      .strict(),
    handler: async (args, ctx) => {
      const out = unwrapHimedScheduling(
        await call(ctx, 'listarModalidades', args),
        'list_modalities',
      );
      if (!out.ok) return err(out.code, out.message);
      return ok(
        rows(out.data).map((r) => ({ idModalidad: r.idModalidad, descripcion: r.descripcion })),
      );
    },
  });

  const listAppointmentTypes = tool({
    name: 'mcp_himed_list_appointment_types',
    description: 'List enabled appointment types for a professional.',
    credentialGroup: 'autoagendamiento',
    input: z.object({ idUsuario: z.string().min(1) }).strict(),
    handler: async (args, ctx) => {
      const out = unwrapHimedScheduling(
        await call(ctx, 'listarTiposCitas', args),
        'list_appointment_types',
      );
      if (!out.ok) return err(out.code, out.message);
      return ok(
        rows(out.data).map((r) => ({ id: r.ID, nombre: r.nombre, recomendacion: r.recomendacion })),
      );
    },
  });

  const getAvailability = tool({
    name: 'mcp_himed_get_availability',
    description: 'Get available date/time slots for a professional at a sede from a start date.',
    credentialGroup: 'autoagendamiento',
    input: z
      .object({
        idUsuario: z.string().min(1),
        idSede: z.union([z.string(), z.number()]),
        fechaInicial: z.string().min(1).describe('DD-MM-YYYY'),
        fechaFinal: z.string().optional().describe('DD-MM-YYYY or "none"'),
        forma: z.enum(['texto']).default('texto'),
      })
      .strict(),
    handler: async (args, ctx) => {
      const out = unwrapHimedScheduling(
        // HiMed keys the professional on `idEspecialista` for availability (not `idUsuario`, which it
        // rejects as missing — sandbox 2026-10-01 + Autoagendamiento docs). The agent-facing input stays
        // `idUsuario` (what list_professionals returns); map it to the wire field here.
        // `idSede` goes as a string: consultarDisponibilidad answers 400 to a numeric one, which is
        // exactly what list_locations hands the agent (sandbox 2026-10-06).
        await call(ctx, 'consultarDisponibilidad', {
          idEspecialista: args.idUsuario,
          idSede: String(args.idSede),
          fechaInicial: args.fechaInicial,
          fechaFinal: args.fechaFinal ?? 'none',
          forma: args.forma,
        }),
        'get_availability',
      );
      if (!out.ok) return err(out.code, out.message);
      // HiMed repeats the same slot across rows; offer each one once.
      const seen = new Set<string>();
      return ok(
        rows(out.data)
          .filter((r) => {
            const key = `${String(r.fecha)} ${String(r.hora)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map((r) => ({
            disponibilidad: r.disponibilidad,
            fecha: r.fecha,
            hora: r.hora,
            duracion: r.duracion,
          })),
      );
    },
  });

  const createAppointment = tool({
    name: 'mcp_himed_create_appointment',
    description: 'Book an appointment for an existing patient. Confirm the patient exists first.',
    credentialGroup: 'autoagendamiento',
    input: z
      .object({
        idPaciente: z.string().min(4).max(20),
        idSede: z.union([z.string(), z.number()]),
        idUsuario: z.string().min(1),
        fechaCita: z.string().min(1).describe('DD-MM-YYYY'),
        horaInicioCita: z.string().min(1).describe('HH:mm:ss'),
        modalidadAtencion: z.union([z.string(), z.number()]),
        idTipoCita: z.union([z.string(), z.number()]).optional(),
        tipo: z.enum(['paciente', 'usuario']).default('paciente'),
        observaciones: z.string().optional(),
        nombrePideCita: z.string().optional(),
        apellidoPideCita: z.string().optional(),
        parentescoPideCita: z
          .string()
          .optional()
          .describe(
            'Relationship catalog code — 15 = patient books own, 17 = unknown (default 15)',
          ),
      })
      .strict(),
    handler: async (args, ctx) => {
      // HiMed requires `parentescoPideCita` (15 = patient books their own; 17 = unknown); default 15 for
      // a self-booking. `strModulo:'himed'` and the canonical field spellings are sandbox-verified.
      const out = unwrapHimedScheduling(
        await call(ctx, 'CrearCita', {
          ...args,
          parentescoPideCita: args.parentescoPideCita ?? '15',
          strModulo: 'himed',
        }),
        'create_appointment',
      );
      return out.ok ? ok(out.data) : err(out.code, out.message);
    },
  });

  const listPatientAppointments = tool({
    name: 'mcp_himed_list_patient_appointments',
    description:
      "List a patient's appointments (also the primitive the reminder verifier re-reads).",
    credentialGroup: 'autoagendamiento',
    identityPolicy: { mode: 'subject-scoped' },
    input: z
      .object({
        idPaciente: z.string().min(4).max(20),
        forma: z.string().default('texto'),
      })
      .strict(),
    handler: async (args, ctx) => {
      const out = unwrapHimedScheduling(
        await call(ctx, 'citasPaciente', args),
        'list_patient_appointments',
      );
      return out.ok ? ok(out.data) : err(out.code, out.message);
    },
  });

  const cancelAppointment = tool({
    name: 'mcp_himed_cancel_appointment',
    description: "Cancel a patient's appointment.",
    credentialGroup: 'autoagendamiento',
    input: z
      .object({
        idCita: z.string().min(1),
        // HiMed rejects a cancel without the patient ("No se ha proporcionado el valor del campo
        // 'idPaciente'" — sandbox 2026-10-01), so it is required. Sending it is always safe — the cancel
        // flow has the patient in hand.
        idPaciente: z.string().min(4).max(20),
      })
      .strict(),
    handler: async (args, ctx) => {
      const out = unwrapHimedScheduling(
        await call(ctx, 'cancelarCita', args),
        'cancel_appointment',
      );
      return out.ok ? ok(out.data) : err(out.code, out.message);
    },
  });

  return [
    createPatient,
    updatePatient,
    changePatientDocument,
    listLocations,
    listDoctors,
    patientExists,
    listSpecialties,
    listProfessionals,
    listModalities,
    listAppointmentTypes,
    getAvailability,
    createAppointment,
    listPatientAppointments,
    cancelAppointment,
  ];
}
