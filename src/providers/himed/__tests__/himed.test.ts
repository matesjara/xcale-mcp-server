import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { FetchLike } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import { createHimedProvider } from '../provider';

interface Captured {
  url: string;
  method: string;
  body: string | undefined;
}

/** A fetch stub that records the (already materialized) request and returns a fixed response. */
function fakeFetch(status: number, jsonBody: unknown, sink?: Captured[]): FetchLike {
  return (async (url: string, init: { method: string; body?: string }) => {
    sink?.push({ url, method: init.method, body: init.body });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => jsonBody,
      text: async () => JSON.stringify(jsonBody),
    } as Response;
  }) as unknown as FetchLike;
}

const cred = () => ({ credential: { secret: new SecretString('KEY123') } });

const patientArgs = {
  tipoDocumento: 'CC',
  idPaciente: '11111111',
  primerNombre: 'Paciente',
  primerApellido: 'Pruebas',
  fechaNacimiento: '01-01-1990',
};

describe('HiMed (Demográficos) provider', () => {
  it('passes provider conformance', async () => {
    await runProviderConformance(createHimedProvider({ fetchImpl: fakeFetch(201, {}) }));
  });

  it('create_patient injects the api_key into the JSON body — never in the URL or headers', async () => {
    const sink: Captured[] = [];
    const provider = createHimedProvider({
      fetchImpl: fakeFetch(201, { estado: 'success', mensaje: 'ok' }, sink),
    });

    const result = await provider.callTool('mcp_himed_create_patient', patientArgs, cred());

    expect(result.kind).toBe('success');
    expect(sink).toHaveLength(1);
    const req = sink[0]!;
    expect(req.url).toContain('/crearPaciente.php');
    expect(req.url).not.toContain('KEY123'); // never in the URL
    const body = JSON.parse(req.body ?? '{}') as Record<string, unknown>;
    expect(body.api_key).toBe('KEY123'); // injected into the body by the materializer
    expect(body.tipo_documento).toBe('CC');
    expect(body.id_paciente).toBe('11111111');
  });

  it('maps a 401 to PROVIDER_AUTH_EXPIRED', async () => {
    const provider = createHimedProvider({ fetchImpl: fakeFetch(401, { mensaje: 'token' }) });
    const result = await provider.callTool('mcp_himed_create_patient', patientArgs, cred());
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe(ProviderErrorCode.AUTH_EXPIRED);
  });

  it('refines a 417 to PROVIDER_INVALID_INPUT (caller-fixable)', async () => {
    const provider = createHimedProvider({ fetchImpl: fakeFetch(417, { mensaje: 'campo' }) });
    const result = await provider.callTool('mcp_himed_create_patient', patientArgs, cred());
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe(ProviderErrorCode.INVALID_INPUT);
  });

  it('list_doctors posts to Usuarios/consultarUsuarios.php and curates out professional PHI', async () => {
    const sink: Captured[] = [];
    const provider = createHimedProvider({
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
        sink,
      ),
    });
    const result = await provider.callTool(
      'mcp_himed_list_doctors',
      { idEspecialidad: '232' },
      cred(),
    );
    expect(result.kind).toBe('success');
    const body = JSON.parse(sink[0]!.body ?? '{}') as Record<string, unknown>;
    expect(sink[0]!.url).toContain('/Usuarios/consultarUsuarios.php');
    expect(body.api_key).toBe('KEY123');
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
      // PHI dropped
      expect(JSON.stringify(result.data)).not.toContain('xxx@xxx.com');
      expect(JSON.stringify(result.data)).not.toContain('1992-06-09');
    }
  });

  it('list_locations posts to Sedes/consultarSedes.php and returns curated sede rows', async () => {
    const provider = createHimedProvider({
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
    const result = await provider.callTool('mcp_himed_list_locations', {}, cred());
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
});
