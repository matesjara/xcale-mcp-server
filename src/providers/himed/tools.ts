import { z } from 'zod';

import { defineTool, err, ok, type ToolDefinition } from '../../core/tool';

import type { HimedClient } from './client';
import { unwrapHimed } from './errors';

/**
 * HiMed Demográficos tools — patient writes. Inputs are camelCase (our convention); handlers map to
 * HiMed's snake_case wire fields. The `api_key` is never in these bodies — the materializer injects
 * it (placement:'body'). Field/date formats are doc-derived and pending sandbox confirmation on the
 * write path (R-2 in the api-contract).
 */
// `any` for the input type holds a heterogeneous tool collection (each tool's zod input differs);
// per-tool types stay sound at each defineTool call site. Same pattern as every provider here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildHimedTools(client: HimedClient): ReadonlyArray<ToolDefinition<any>> {
  const createPatient = defineTool({
    name: 'mcp_himed_create_patient',
    description:
      'Create a patient in HiMed (idempotent: also confirms an existing patient). Required by the ' +
      'scheduling flow, which can only book patients that already exist.',
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
          .describe('Birth date, DD-MM-YYYY (pending sandbox confirm)'),
      })
      .strict(),
    handler: async (args, ctx) => {
      const res = await client.post('crearPaciente.php', ctx.request, {
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

  const updatePatient = defineTool({
    name: 'mcp_himed_update_patient',
    description:
      "Update a patient's modifiable demographic fields. tipoDocumento + idPaciente identify the " +
      'patient and cannot be changed here (use change_patient_document for that).',
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
      const res = await client.post('modificarPaciente.php', ctx.request, {
        tipo_documento: args.tipoDocumento,
        id_paciente: args.idPaciente,
        ...args.fields,
      });
      const out = unwrapHimed(res, 'update_patient');
      return out.ok ? ok(out.data) : err(out.code, out.message);
    },
  });

  const changePatientDocument = defineTool({
    name: 'mcp_himed_change_patient_document',
    description: "Change a patient's document type and/or number, with an audit reason.",
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
      const res = await client.post('modificarIdTipoIdPaciente.php', ctx.request, {
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

  return [createPatient, updatePatient, changePatientDocument];
}
