import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { FetchLike } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import { createHimedProvider } from '../provider';

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

/** A context carrying the three-group credential bundle + the codigo_servicio service context. */
const ctx = () => ({
  credential: {
    secret: new SecretString('IGNORED'),
    secrets: {
      demograficos: new SecretString('DEMO_SEC'),
      directorio: new SecretString('DIR_SEC'),
      autoagendamiento: new SecretString('SCHED_SEC'),
    },
  },
  metadata: { codigo_servicio: 'CS1' },
});

describe('HiMed unified provider — credential groups', () => {
  it('passes provider conformance', async () => {
    await runProviderConformance(createHimedProvider({ fetchImpl: fakeFetch(200, []) }));
  });

  it('declares one provider with all 14 tools and list_locations as the probe', () => {
    const provider = createHimedProvider({ fetchImpl: fakeFetch(200, []) });
    expect(provider.manifest.connectionProbe).toEqual({ tool: 'mcp_himed_list_locations' });
    expect(provider.listTools()).toHaveLength(14);
    expect(provider.listTools().map((t) => t.name)).toContain('mcp_himed_create_appointment');
    // The scheduling list_locations was dropped — only the directory one remains (OQ-1).
    expect(provider.listTools().filter((t) => t.name === 'mcp_himed_list_locations')).toHaveLength(
      1,
    );
  });

  it('publishes subject-scoped identityPolicy on the patient-exposing scheduling reads', () => {
    const provider = createHimedProvider({ fetchImpl: fakeFetch(200, []) });
    const byName = Object.fromEntries(provider.listTools().map((t) => [t.name, t]));
    expect(byName['mcp_himed_patient_exists']?.identityPolicy).toEqual({ mode: 'subject-scoped' });
    expect(byName['mcp_himed_list_patient_appointments']?.identityPolicy).toEqual({
      mode: 'subject-scoped',
    });
  });

  it('create_patient (demograficos group) injects the Demográficos secret as body.api_key', async () => {
    const sink: Captured[] = [];
    const provider = createHimedProvider({
      fetchImpl: fakeFetch(201, { estado: 'success' }, sink),
    });
    const res = await provider.callTool(
      'mcp_himed_create_patient',
      {
        tipoDocumento: 'CC',
        idPaciente: '11111111',
        primerNombre: 'P',
        primerApellido: 'X',
        fechaNacimiento: '1990-01-01',
      },
      ctx(),
    );
    expect(res.kind).toBe('success');
    const req = sink[0]!;
    expect(req.url).toContain('/Demograficos/crearPaciente.php');
    const body = JSON.parse(req.body ?? '{}') as Record<string, unknown>;
    expect(body.api_key).toBe('DEMO_SEC');
    expect(body.fecha_nacimiento).toBe('1990-01-01');
  });

  it('list_locations (directorio group, the probe) injects the Service secret as body.api_key', async () => {
    const sink: Captured[] = [];
    const provider = createHimedProvider({
      fetchImpl: fakeFetch(
        200,
        { estado: 'success', info_sede: [{ id_sede: '1', sede: 'Poblado', email: 'x@x.com' }] },
        sink,
      ),
    });
    const res = await provider.callTool('mcp_himed_list_locations', {}, ctx());
    expect(res.kind).toBe('success');
    const req = sink[0]!;
    expect(req.url).toContain('/Sedes/consultarSedes.php');
    expect((JSON.parse(req.body ?? '{}') as Record<string, unknown>).api_key).toBe('DIR_SEC');
    if (res.kind === 'success') {
      expect(res.data).toEqual([
        {
          idSede: '1',
          sede: 'Poblado',
          direccion: undefined,
          telefono: undefined,
          municipio: undefined,
        },
      ]);
      expect(JSON.stringify(res.data)).not.toContain('x@x.com'); // PHI curated out
    }
  });

  it('create_appointment (autoagendamiento group) injects the scheduling token + codigo_servicio', async () => {
    const sink: Captured[] = [];
    const provider = createHimedProvider({
      fetchImpl: fakeFetch(200, { success: true, idCita: 1029 }, sink),
    });
    const res = await provider.callTool(
      'mcp_himed_create_appointment',
      {
        idPaciente: '11111111',
        idSede: 1,
        idUsuario: '42',
        fechaCita: '08-10-2026',
        horaInicioCita: '09:00:00',
        modalidadAtencion: 1,
      },
      ctx(),
    );
    expect(res.kind).toBe('success');
    const body = JSON.parse(sink[0]!.body ?? '{}') as Record<string, unknown>;
    expect(body.token).toBe('SCHED_SEC');
    expect(body.codigo_servicio).toBe('CS1');
    expect(body.accion).toBe('CrearCita');
    expect(body.parentescoPideCita).toBe('15');
  });

  it('get_availability sends the professional as idEspecialista (not idUsuario)', async () => {
    const sink: Captured[] = [];
    const provider = createHimedProvider({ fetchImpl: fakeFetch(200, [], sink) });
    await provider.callTool(
      'mcp_himed_get_availability',
      { idUsuario: '42', idSede: '1', fechaInicial: '14-10-2026' },
      ctx(),
    );
    const body = JSON.parse(sink[0]!.body ?? '{}') as Record<string, unknown>;
    expect(body.idEspecialista).toBe('42');
    expect(body.idUsuario).toBeUndefined();
  });

  it('cancel_appointment requires idPaciente', async () => {
    const provider = createHimedProvider({ fetchImpl: fakeFetch(200, { success: true }) });
    const res = await provider.callTool('mcp_himed_cancel_appointment', { idCita: '25' }, ctx());
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.INVALID_INPUT);
  });

  it('maps a Demográficos 401 to PROVIDER_AUTH_EXPIRED', async () => {
    const provider = createHimedProvider({ fetchImpl: fakeFetch(401, { mensaje: 'token' }) });
    const res = await provider.callTool(
      'mcp_himed_create_patient',
      {
        tipoDocumento: 'CC',
        idPaciente: '11111111',
        primerNombre: 'P',
        primerApellido: 'X',
        fechaNacimiento: '1990-01-01',
      },
      ctx(),
    );
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.AUTH_EXPIRED);
  });

  it('create_patient treats "patient already exists" (HTTP 400) as idempotent success, without echoing PHI', async () => {
    // Sandbox-verified 2026-10-05: an existing patient comes back 400 + estado:error + datos_paciente.
    const provider = createHimedProvider({
      fetchImpl: fakeFetch(400, {
        estado: 'error',
        mensaje: 'El paciente ya existe en HiMed Web',
        datos_paciente: {
          id_paciente: '11111111',
          primer_nombre: 'P',
          fecha_nacimiento: '1990-01-01',
        },
      }),
    });
    const res = await provider.callTool(
      'mcp_himed_create_patient',
      {
        tipoDocumento: 'CC',
        idPaciente: '11111111',
        primerNombre: 'P',
        primerApellido: 'X',
        fechaNacimiento: '1990-01-01',
      },
      ctx(),
    );
    expect(res.kind).toBe('success');
    if (res.kind === 'success') {
      expect(res.data).toEqual({ estado: 'exists', mensaje: 'El paciente ya existe en HiMed Web' });
    }
  });

  it('create_patient keeps any other 400 as PROVIDER_INVALID_INPUT', async () => {
    const provider = createHimedProvider({
      fetchImpl: fakeFetch(400, { estado: 'error', mensaje: 'Fecha de nacimiento inválida' }),
    });
    const res = await provider.callTool(
      'mcp_himed_create_patient',
      {
        tipoDocumento: 'CC',
        idPaciente: '11111111',
        primerNombre: 'P',
        primerApellido: 'X',
        fechaNacimiento: '1990-01-01',
      },
      ctx(),
    );
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.INVALID_INPUT);
  });
});
