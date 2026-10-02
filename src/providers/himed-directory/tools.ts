import { z } from 'zod';

import { defineTool, err, ok, type ToolDefinition } from '../../core/tool';

import type { HimedDirectoryClient } from './client';
import { envelopeRows, unwrapHimedDirectory } from './errors';

/**
 * HiMed directory tools (read-only): the clinic's doctors (Usuarios) and sedes (Sedes). Inputs are
 * camelCase; handlers map to HiMed's snake_case wire fields. The `api_key` is never in these bodies —
 * the materializer injects it (placement:'body'). Reads return a `{ estado, <named array> }` envelope;
 * the handler pulls the array and curates fields (PHI allow-list).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildHimedDirectoryTools(
  client: HimedDirectoryClient,
): ReadonlyArray<ToolDefinition<any>> {
  const listDoctors = defineTool({
    name: 'mcp_himed-directory_list_doctors',
    description:
      'List active health professionals (full directory), optionally filtered by specialty or user. ' +
      'Richer than the scheduling list; use for professional info beyond booking.',
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
      const out = unwrapHimedDirectory(res, 'list_doctors');
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

  const listLocations = defineTool({
    name: 'mcp_himed-directory_list_locations',
    description:
      'List active clinic sedes (full directory) with address, optionally filtered by area.',
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
      const out = unwrapHimedDirectory(res, 'list_locations');
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

  return [listLocations, listDoctors];
}
