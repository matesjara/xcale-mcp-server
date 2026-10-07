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

/** HiMed has no default host; every test that expects a request to leave configures one. */
const HOSTS = {
  baseUrl: 'https://himed.test/interoperabilidad/Api/Controllers',
  schedulingBaseUrl: 'https://himed-scheduling.test/envioConsumoAutoagendamiento',
};

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
    await runProviderConformance(createHimedProvider({ ...HOSTS, fetchImpl: fakeFetch(200, []) }));
  });

  it('declares one provider with all 14 tools and list_locations as the probe', () => {
    const provider = createHimedProvider({ ...HOSTS, fetchImpl: fakeFetch(200, []) });
    expect(provider.manifest.connectionProbe).toEqual({ tool: 'mcp_himed_list_locations' });
    expect(provider.listTools()).toHaveLength(14);
    expect(provider.listTools().map((t) => t.name)).toContain('mcp_himed_create_appointment');
    // The scheduling list_locations was dropped — only the directory one remains (OQ-1).
    expect(provider.listTools().filter((t) => t.name === 'mcp_himed_list_locations')).toHaveLength(
      1,
    );
  });

  it('publishes subject-scoped identityPolicy on the patient-exposing scheduling reads', () => {
    const provider = createHimedProvider({ ...HOSTS, fetchImpl: fakeFetch(200, []) });
    const byName = Object.fromEntries(provider.listTools().map((t) => [t.name, t]));
    expect(byName['mcp_himed_patient_exists']?.identityPolicy).toEqual({ mode: 'subject-scoped' });
    expect(byName['mcp_himed_list_patient_appointments']?.identityPolicy).toEqual({
      mode: 'subject-scoped',
    });
  });

  it('create_patient (demograficos group) injects the Demográficos secret as body.api_key', async () => {
    const sink: Captured[] = [];
    const provider = createHimedProvider({
      ...HOSTS,
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
      ...HOSTS,
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
      ...HOSTS,
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
    const provider = createHimedProvider({ ...HOSTS, fetchImpl: fakeFetch(200, [], sink) });
    await provider.callTool(
      'mcp_himed_get_availability',
      { idUsuario: '42', idSede: '1', fechaInicial: '14-10-2026' },
      ctx(),
    );
    const body = JSON.parse(sink[0]!.body ?? '{}') as Record<string, unknown>;
    expect(body.idEspecialista).toBe('42');
    expect(body.idUsuario).toBeUndefined();
  });

  it('get_availability sends idSede as a string — HiMed answers 400 to a numeric one', async () => {
    // Sandbox-verified 2026-10-06: list_locations hands the agent `idSede: 1` (a number), the agent
    // passes it straight on, and consultarDisponibilidad rejects it; `"1"` returns the real slots.
    const sink: Captured[] = [];
    const provider = createHimedProvider({ ...HOSTS, fetchImpl: fakeFetch(200, [], sink) });
    await provider.callTool(
      'mcp_himed_get_availability',
      { idUsuario: '42', idSede: 1, fechaInicial: '14-10-2026' },
      ctx(),
    );
    const body = JSON.parse(sink[0]!.body ?? '{}') as Record<string, unknown>;
    expect(body.idSede).toBe('1');
  });

  it('get_availability returns each slot once — HiMed repeats rows', async () => {
    const slot = {
      disponibilidad: 'Martes, 06 de Octubre - 11:00 AM',
      fecha: '06-10-2026',
      hora: '11:00:00',
    };
    const other = {
      disponibilidad: 'Miércoles, 07 de Octubre - 11:00 AM',
      fecha: '07-10-2026',
      hora: '11:00:00',
    };
    const provider = createHimedProvider({
      ...HOSTS,
      now: () => new Date('2026-10-01T12:00:00Z'), // before every slot, so only the dedupe is under test
      fetchImpl: fakeFetch(200, [slot, slot, slot, other]),
    });
    const res = await provider.callTool(
      'mcp_himed_get_availability',
      { idUsuario: '42', idSede: '1', fechaInicial: '06-10-2026' },
      ctx(),
    );
    expect(res.kind).toBe('success');
    if (res.kind === 'success') {
      expect(
        (res.data as Array<{ fecha: string; hora: string }>).map((s) => `${s.fecha} ${s.hora}`),
      ).toEqual(['06-10-2026 11:00:00', '07-10-2026 11:00:00']);
    }
  });

  it('get_availability drops slots that already started, in clinic (Colombia) time', async () => {
    // Live 2026-10-06 12:36 COT: HiMed still listed today 11:00 and the agent offered it.
    const now = () => new Date('2026-10-06T17:36:00Z'); // 12:36 in Bogotá (UTC-5, no DST)
    const provider = createHimedProvider({
      ...HOSTS,
      now,
      fetchImpl: fakeFetch(200, [
        { disponibilidad: 'past', fecha: '06-10-2026', hora: '11:00:00' },
        { disponibilidad: 'later today', fecha: '06-10-2026', hora: '15:00:00' },
        { disponibilidad: 'tomorrow', fecha: '07-10-2026', hora: '11:00:00' },
      ]),
    });
    const res = await provider.callTool(
      'mcp_himed_get_availability',
      { idUsuario: '42', idSede: '1', fechaInicial: '06-10-2026' },
      ctx(),
    );
    expect(res.kind).toBe('success');
    if (res.kind === 'success') {
      expect((res.data as Array<{ disponibilidad: string }>).map((s) => s.disponibilidad)).toEqual([
        'later today',
        'tomorrow',
      ]);
    }
  });

  it('with no host configured, HiMed fails closed — no request leaves, PROVIDER_UNAVAILABLE', async () => {
    // There is no default host any more: the old one was HiMed's TEST endpoint, so a production deploy
    // without HIMED_SCHEDULING_BASE_URL would have booked real patients into the sandbox.
    const sink: Captured[] = [];
    const provider = createHimedProvider({ fetchImpl: fakeFetch(200, [], sink) });
    for (const [tool, args] of [
      ['mcp_himed_list_locations', {}],
      ['mcp_himed_patient_exists', { idPaciente: '11111111' }],
    ] as const) {
      const res = await provider.callTool(tool, args, ctx());
      expect(res.kind).toBe('error');
      if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.PROVIDER_UNAVAILABLE);
    }
    expect(sink).toHaveLength(0);
  });

  it('get_availability for a single day widens to the next day on the wire and returns only that day', async () => {
    // Live 2026-10-07: fechaInicial = fechaFinal ("el lunes 12") → HiMed 400. A one-day request is the
    // most natural one a patient makes, so the provider asks for [day, day+1] and keeps only the day.
    const sink: Captured[] = [];
    const provider = createHimedProvider({
      ...HOSTS,
      now: () => new Date('2026-10-01T12:00:00Z'),
      fetchImpl: fakeFetch(
        200,
        [
          { disponibilidad: 'mon 11', fecha: '12-10-2026', hora: '11:00:00' },
          { disponibilidad: 'mon 17', fecha: '12-10-2026', hora: '17:00:00' },
          { disponibilidad: 'tue 11', fecha: '13-10-2026', hora: '11:00:00' },
        ],
        sink,
      ),
    });
    const res = await provider.callTool(
      'mcp_himed_get_availability',
      { idUsuario: '42', idSede: '1', fechaInicial: '12-10-2026', fechaFinal: '12-10-2026' },
      ctx(),
    );
    const body = JSON.parse(sink[0]!.body ?? '{}') as Record<string, unknown>;
    expect(body.fechaInicial).toBe('12-10-2026');
    expect(body.fechaFinal).toBe('13-10-2026');
    expect(res.kind).toBe('success');
    if (res.kind === 'success') {
      expect((res.data as Array<{ disponibilidad: string }>).map((s) => s.disponibilidad)).toEqual([
        'mon 11',
        'mon 17',
      ]);
    }
  });

  it('get_availability crosses a month end when widening a single day', async () => {
    const sink: Captured[] = [];
    const provider = createHimedProvider({
      ...HOSTS,
      now: () => new Date('2026-10-01T12:00:00Z'),
      fetchImpl: fakeFetch(200, [], sink),
    });
    await provider.callTool(
      'mcp_himed_get_availability',
      { idUsuario: '42', idSede: '1', fechaInicial: '31-10-2026', fechaFinal: '31-10-2026' },
      ctx(),
    );
    const body = JSON.parse(sink[0]!.body ?? '{}') as Record<string, unknown>;
    expect(body.fechaFinal).toBe('01-11-2026');
  });

  it('cancel_appointment requires idPaciente', async () => {
    const provider = createHimedProvider({
      ...HOSTS,
      fetchImpl: fakeFetch(200, { success: true }),
    });
    const res = await provider.callTool('mcp_himed_cancel_appointment', { idCita: '25' }, ctx());
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.INVALID_INPUT);
  });

  it('maps a Demográficos 401 to PROVIDER_AUTH_EXPIRED', async () => {
    const provider = createHimedProvider({
      ...HOSTS,
      fetchImpl: fakeFetch(401, { mensaje: 'token' }),
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
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.AUTH_EXPIRED);
  });

  it('create_patient treats "patient already exists" (HTTP 400) as idempotent success, without echoing PHI', async () => {
    // Sandbox-verified 2026-10-05: an existing patient comes back 400 + estado:error + the full
    // datos_paciente record — well past the transport's 500-char error-body cap, so the body the
    // provider sees is truncated (invalid) JSON. The padding reproduces that.
    const provider = createHimedProvider({
      ...HOSTS,
      fetchImpl: fakeFetch(400, {
        estado: 'error',
        mensaje: 'El paciente ya existe en HiMed Web',
        datos_paciente: {
          id_paciente: '11111111',
          primer_nombre: 'P',
          fecha_nacimiento: '1990-01-01',
          direccion: 'x'.repeat(600),
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

  it('create_patient tells the agent WHICH field HiMed rejected, so it can ask for that one', async () => {
    // Live 2026-10-06: a surname with a digit came back 400 + campos_fallidos.primer_apellido. With
    // only "HTTP 400" the agent guessed the birth date, retried, and escalated.
    const provider = createHimedProvider({
      ...HOSTS,
      fetchImpl: fakeFetch(400, {
        estado: 'error',
        mensaje: 'Los datos no son validos',
        campos_fallidos: {
          primer_apellido: 'El primer apellido del paciente no cumple parámetros ',
        },
      }),
    });
    const res = await provider.callTool(
      'mcp_himed_create_patient',
      {
        tipoDocumento: 'CC',
        idPaciente: '11111111',
        primerNombre: 'P',
        primerApellido: 'X1',
        fechaNacimiento: '1990-01-01',
      },
      ctx(),
    );
    expect(res.kind).toBe('error');
    if (res.kind === 'error') {
      expect(res.code).toBe(ProviderErrorCode.INVALID_INPUT);
      expect(res.message).toContain('primer_apellido');
      expect(res.message).toContain('El primer apellido del paciente no cumple parámetros');
    }
  });

  it('"ya existe" is success ONLY for create_patient — a document change onto a taken number is an error', async () => {
    // Code review 2026-10-06: the idempotency rule lived in the shared unwrap, so change_patient_document
    // onto another patient's number reported success while HiMed changed nothing.
    const provider = createHimedProvider({
      ...HOSTS,
      fetchImpl: fakeFetch(400, { estado: 'error', mensaje: 'El paciente ya existe en HiMed Web' }),
    });
    const res = await provider.callTool(
      'mcp_himed_change_patient_document',
      {
        tipoIdActual: 'CC',
        idPacienteActual: '11111111',
        tipoIdNuevo: 'CC',
        idPacienteNuevo: '22222222',
        motivoCambio: 'typo',
      },
      ctx(),
    );
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.INVALID_INPUT);
  });

  it('update_patient refuses identity keys inside `fields` — they would retarget another patient', async () => {
    const sink: Captured[] = [];
    const provider = createHimedProvider({
      ...HOSTS,
      fetchImpl: fakeFetch(200, { estado: 'ok' }, sink),
    });
    const res = await provider.callTool(
      'mcp_himed_update_patient',
      {
        tipoDocumento: 'CC',
        idPaciente: '11111111',
        fields: { id_paciente: '22222222', telefono: '3000000000' },
      },
      ctx(),
    );
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(sink).toHaveLength(0); // nothing left the building
  });

  it('create_patient keeps any other 400 as PROVIDER_INVALID_INPUT', async () => {
    const provider = createHimedProvider({
      ...HOSTS,
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

describe('HiMed per-group credential probes (connect verifies EVERY token)', () => {
  // A connect that proved only the directory token stored a mistyped Demográficos or Autoagendamiento
  // token as CONNECTED; the clinic found out mid-booking, in front of a patient (code review
  // 2026-10-07). Each group now names a probe the consumer runs before it stores the bundle.
  it('every credential group declares a probe tool', () => {
    const provider = createHimedProvider({ ...HOSTS, fetchImpl: fakeFetch(200, []) });
    const groups =
      (provider.auth as { groups?: Array<{ key: string; probe?: string }> }).groups ?? [];
    expect(Object.fromEntries(groups.map((g) => [g.key, g.probe]))).toEqual({
      demograficos: 'mcp_himed_verify_demograficos',
      directorio: 'mcp_himed_list_locations',
      autoagendamiento: 'mcp_himed_verify_autoagendamiento',
    });
  });

  it('the probes are control-plane: callable by name, never on the agent menu', async () => {
    const provider = createHimedProvider({
      ...HOSTS,
      fetchImpl: fakeFetch(400, { estado: 'error' }),
    });
    const listed = provider.listTools().map((t) => t.name);
    expect(listed).not.toContain('mcp_himed_verify_demograficos');
    expect(listed).not.toContain('mcp_himed_verify_autoagendamiento');
    const res = await provider.callTool('mcp_himed_verify_demograficos', {}, ctx());
    expect(res.kind).toBe('success');
  });

  it('verify_demograficos writes nothing: it sends only the token, and a 400 means the token is good', async () => {
    // Sandbox 2026-10-07: crearPaciente with an empty body → 400 "Los datos no son validos" with a
    // valid token (nothing created), 401 "El token no es válido" with a bad one.
    const sink: Captured[] = [];
    const provider = createHimedProvider({
      ...HOSTS,
      fetchImpl: fakeFetch(400, { estado: 'error', mensaje: 'Los datos no son validos' }, sink),
    });
    const res = await provider.callTool('mcp_himed_verify_demograficos', {}, ctx());
    expect(res.kind).toBe('success');
    expect(Object.keys(JSON.parse(sink[0]!.body ?? '{}'))).toEqual(['api_key']);
    expect(sink[0]!.url).toContain('/Demograficos/crearPaciente.php');
  });

  it('verify_demograficos maps a bad token to PROVIDER_AUTH_EXPIRED', async () => {
    const provider = createHimedProvider({
      ...HOSTS,
      fetchImpl: fakeFetch(401, { estado: 'error', mensaje: 'El token no es válido' }),
    });
    const res = await provider.callTool('mcp_himed_verify_demograficos', {}, ctx());
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.AUTH_EXPIRED);
  });

  it('verify_demograficos cannot vouch for a token when HiMed is down', async () => {
    const provider = createHimedProvider({ ...HOSTS, fetchImpl: fakeFetch(503, {}) });
    const res = await provider.callTool('mcp_himed_verify_demograficos', {}, ctx());
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.PROVIDER_UNAVAILABLE);
  });

  it('verify_autoagendamiento is a read: a good token answers, a bad one is AUTH_EXPIRED', async () => {
    const ok = createHimedProvider({ ...HOSTS, fetchImpl: fakeFetch(200, [{ cantidad: 0 }]) });
    expect((await ok.callTool('mcp_himed_verify_autoagendamiento', {}, ctx())).kind).toBe(
      'success',
    );

    const bad = createHimedProvider({
      ...HOSTS,
      fetchImpl: fakeFetch(401, { success: false, mensaje: 'El token no es valido' }),
    });
    const res = await bad.callTool('mcp_himed_verify_autoagendamiento', {}, ctx());
    expect(res.kind).toBe('error');
    if (res.kind === 'error') expect(res.code).toBe(ProviderErrorCode.AUTH_EXPIRED);
  });
});
