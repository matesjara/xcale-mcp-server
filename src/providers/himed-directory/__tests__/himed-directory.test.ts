import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { FetchLike } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import { createHimedDirectoryProvider } from '../provider';

interface Captured {
  url: string;
  body: string | undefined;
}

function fakeFetch(status: number, jsonBody: unknown, sink?: Captured[]): FetchLike {
  return (async (url: string, init: { body?: string }) => {
    sink?.push({ url, body: init.body });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => jsonBody,
      text: async () => JSON.stringify(jsonBody),
    } as Response;
  }) as unknown as FetchLike;
}

const cred = () => ({ credential: { secret: new SecretString('SVC_TOKEN') } });

describe('HiMed Directory provider', () => {
  it('passes provider conformance', async () => {
    await runProviderConformance(
      createHimedDirectoryProvider({ fetchImpl: fakeFetch(200, []) })
    );
  });

  it('declares list_locations as its connectionProbe (a cheap read proves the Token de Servicio)', () => {
    const provider = createHimedDirectoryProvider({ fetchImpl: fakeFetch(200, []) });
    expect(provider.manifest.connectionProbe).toEqual({
      tool: 'mcp_himed-directory_list_locations',
    });
    expect(provider.listTools().map((t) => t.name).sort()).toEqual([
      'mcp_himed-directory_list_doctors',
      'mcp_himed-directory_list_locations',
    ]);
  });

  it('list_doctors posts to Usuarios/consultarUsuarios.php, injects the api_key, curates out PHI', async () => {
    const sink: Captured[] = [];
    const provider = createHimedDirectoryProvider({
      fetchImpl: fakeFetch(
        200,
        {
          estado: 'success',
          mensaje: 'ok',
          usuarios: [
            {
              id_usuario: '12333',
              nombres: 'Médico pruebas',
              apellidos: 'del Río',
              rol: 'Médico Especialista',
              id_especialidad: '232',
              email: 'xxx@xxx.com',
              celular: '3209872211',
              direccion: 'El Poblado',
              fecha_nacimiento: '1992-06-09',
            },
          ],
        },
        sink
      ),
    });
    const result = await provider.callTool(
      'mcp_himed-directory_list_doctors',
      { idEspecialidad: '232' },
      cred()
    );
    expect(result.kind).toBe('success');
    const body = JSON.parse(sink[0]!.body ?? '{}') as Record<string, unknown>;
    expect(sink[0]!.url).toContain('/Usuarios/consultarUsuarios.php');
    expect(body.api_key).toBe('SVC_TOKEN');
    if (result.kind === 'success') {
      expect(result.data).toEqual([
        {
          idUsuario: '12333',
          nombres: 'Médico pruebas',
          apellidos: 'del Río',
          rol: 'Médico Especialista',
          idEspecialidad: '232',
        },
      ]);
      expect(JSON.stringify(result.data)).not.toContain('xxx@xxx.com');
      expect(JSON.stringify(result.data)).not.toContain('1992-06-09');
    }
  });

  it('list_locations posts to Sedes/consultarSedes.php and returns curated sede rows', async () => {
    const provider = createHimedDirectoryProvider({
      fetchImpl: fakeFetch(200, {
        estado: 'success',
        mensaje: 'ok',
        info_sede: [
          {
            id_sede: '1',
            sede: 'Medellín',
            codigo_prestador: '0502515201',
            direccion: 'Calle 10 # 12-28',
            telefono: '5405960',
            celular: '3209872211',
            email: 'medellin@himed.com',
            municipio: '001',
          },
        ],
      }),
    });
    const result = await provider.callTool(
      'mcp_himed-directory_list_locations',
      {},
      cred()
    );
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.data).toEqual([
        {
          idSede: '1',
          sede: 'Medellín',
          direccion: 'Calle 10 # 12-28',
          telefono: '5405960',
          municipio: '001',
        },
      ]);
    }
  });

  it('maps a 401 (wrong token) to PROVIDER_AUTH_EXPIRED', async () => {
    const provider = createHimedDirectoryProvider({
      fetchImpl: fakeFetch(401, { estado: 'error', mensaje: 'El token no es válido' }),
    });
    const result = await provider.callTool(
      'mcp_himed-directory_list_locations',
      {},
      cred()
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe(ProviderErrorCode.AUTH_EXPIRED);
  });
});
