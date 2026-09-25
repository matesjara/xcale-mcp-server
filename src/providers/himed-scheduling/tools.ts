import { z } from 'zod';

import {
  err,
  ok,
  type ToolDefinition,
  type ToolHandlerContext,
  toolFactory,
} from '../../core/tool';

import type { HimedSchedulingClient } from './client';
import type { HimedSchedulingContext } from './context';
import { unwrapHimedScheduling } from './errors';

type Ctx = ToolHandlerContext<HimedSchedulingContext>;

/** Rows come back as JSON arrays of objects; guard the shape before projecting. */
function rows(data: unknown): ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

/**
 * HiMed Autoagendamiento tools (verified against the sandbox 2026-09-24). One RPC endpoint dispatched
 * by `accion`; the handler adds `accion` + `codigo_servicio` (from context) to the body and the
 * materializer injects the `token`. Outputs are curated (allow-list) to minimize PHI in the model's
 * context. Dates are DD-MM-YYYY, times HH:mm:ss.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildHimedSchedulingTools(
  client: HimedSchedulingClient,
): ReadonlyArray<ToolDefinition<any, HimedSchedulingContext>> {
  const tool = toolFactory<HimedSchedulingContext>();

  const call = (ctx: Ctx, accion: string, fields: Record<string, unknown>) =>
    client.call(ctx.request, { accion, ...fields, codigo_servicio: ctx.metadata.codigo_servicio });

  const patientExists = tool({
    name: 'mcp_himed-scheduling_patient_exists',
    description:
      'Check whether a patient already exists in the clinic (required before booking). Returns the ' +
      "patient's name so the agent can confirm identity.",
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

  const listLocations = tool({
    name: 'mcp_himed-scheduling_list_locations',
    description: 'List the clinic sedes (locations) configured for self-scheduling.',
    input: z.object({}).strict(),
    handler: async (_args, ctx) => {
      const out = unwrapHimedScheduling(await call(ctx, 'listarSedes', {}), 'list_locations');
      if (!out.ok) return err(out.code, out.message);
      return ok(rows(out.data).map((r) => ({ idSede: r.idSede, sede: r.sede })));
    },
  });

  const listSpecialties = tool({
    name: 'mcp_himed-scheduling_list_specialties',
    description: 'List medical specialties available at a sede.',
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
    name: 'mcp_himed-scheduling_list_professionals',
    description:
      'List health professionals at a sede for a specialty. idUsuario is the booking id.',
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
    name: 'mcp_himed-scheduling_list_modalities',
    description:
      'List attention modalities (in-person, telemedicine, home) for a professional/sede.',
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
    name: 'mcp_himed-scheduling_list_appointment_types',
    description: 'List enabled appointment types for a professional.',
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
    name: 'mcp_himed-scheduling_get_availability',
    description: 'Get available date/time slots for a professional at a sede from a start date.',
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
        await call(ctx, 'consultarDisponibilidad', {
          idUsuario: args.idUsuario,
          idSede: args.idSede,
          fechaInicial: args.fechaInicial,
          fechaFinal: args.fechaFinal ?? 'none',
          forma: args.forma,
        }),
        'get_availability',
      );
      if (!out.ok) return err(out.code, out.message);
      return ok(
        rows(out.data).map((r) => ({
          disponibilidad: r.disponibilidad,
          fecha: r.fecha,
          hora: r.hora,
          duracion: r.duracion,
        })),
      );
    },
  });

  const createAppointment = tool({
    name: 'mcp_himed-scheduling_create_appointment',
    description: 'Book an appointment for an existing patient. Confirm the patient exists first.',
    input: z
      .object({
        idPaciente: z.string().min(4).max(20),
        idSede: z.union([z.string(), z.number()]),
        idUsuario: z.string().min(1),
        fechaCita: z.string().min(1).describe('DD-MM-YYYY'),
        horaInicioCita: z.string().min(1).describe('HH:mm:ss'),
        modalidadAtencion: z.union([z.string(), z.number()]),
        idTipoCita: z.union([z.string(), z.number()]),
        tipo: z.enum(['paciente']).default('paciente'),
        observaciones: z.string().optional(),
        nombrePideCita: z.string().optional(),
        apellidoPideCita: z.string().optional(),
        parentescoPideCita: z.string().optional(),
      })
      .strict(),
    handler: async (args, ctx) => {
      // NOTE (R-2, sandbox 2026-09-25): CrearCita rejected the doc example with
      // `401 {estado:'error', mensaje:'El parentesco es obligatorio'}` even though it carried
      // `parentescoPideCita:'17'` — so the server's required field is NOT `parentescoPideCita`.
      // The exact parentesco field/requirement (and whether tipo='paciente' should exempt it) must be
      // confirmed with HiMed before the write path ships. Also confirm the `horaInicioCita` key
      // (the example spells it `horalnicioCita`, an I/l typo).
      const out = unwrapHimedScheduling(
        await call(ctx, 'CrearCita', { ...args, strModulo: 'himed' }),
        'create_appointment',
      );
      return out.ok ? ok(out.data) : err(out.code, out.message);
    },
  });

  const listPatientAppointments = tool({
    name: 'mcp_himed-scheduling_list_patient_appointments',
    description: "List a patient's appointments (also the polling primitive for reminders).",
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
    name: 'mcp_himed-scheduling_cancel_appointment',
    description: "Cancel a patient's appointment.",
    input: z
      .object({
        idCita: z.string().min(1),
        // Verified in sandbox: cancelarCita succeeds with idCita alone; idPaciente is optional.
        idPaciente: z.string().min(4).max(20).optional(),
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
    patientExists,
    listLocations,
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
