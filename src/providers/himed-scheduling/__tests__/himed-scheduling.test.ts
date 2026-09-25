import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { FetchLike } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import { createHimedSchedulingProvider } from '../provider';

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

const ctx = () => ({
  credential: { secret: new SecretString('TOK') },
  metadata: { codigo_servicio: 'CS1' },
});

describe('HiMed scheduling (Autoagendamiento) provider', () => {
  it('passes provider conformance', async () => {
    await runProviderConformance(createHimedSchedulingProvider({ fetchImpl: fakeFetch(200, []) }));
  });

  it('injects the token AND codigo_servicio into the body; token never in the URL; output is curated', async () => {
    const sink: Captured[] = [];
    const provider = createHimedSchedulingProvider({
      fetchImpl: fakeFetch(
        200,
        [{ idSede: 1, sede: 'Medellín', telefono: '111', celular: '222' }],
        sink,
      ),
    });

    const result = await provider.callTool('mcp_himed-scheduling_list_locations', {}, ctx());

    expect(result.kind).toBe('success');
    const req = sink[0]!;
    expect(req.url).not.toContain('TOK');
    const body = JSON.parse(req.body ?? '{}') as Record<string, unknown>;
    expect(body.token).toBe('TOK'); // materializer injected the secret into the body
    expect(body.codigo_servicio).toBe('CS1'); // handler injected the non-secret context
    expect(body.accion).toBe('listarSedes');
    // curated: telefono/celular dropped
    if (result.kind === 'success') {
      expect(result.data).toEqual([{ idSede: 1, sede: 'Medellín' }]);
    }
  });

  it('patient_exists → found when cantidad > 0, else not found', async () => {
    const found = createHimedSchedulingProvider({
      fetchImpl: fakeFetch(201, [{ cantidad: 1, nombre: 'Paciente HM', idEntidad: '13-18' }]),
    });
    const r1 = await found.callTool(
      'mcp_himed-scheduling_patient_exists',
      { idPaciente: '11111111' },
      ctx(),
    );
    expect(r1.kind).toBe('success');
    if (r1.kind === 'success') {
      expect(r1.data).toEqual({ found: true, nombre: 'Paciente HM', idEntidad: '13-18' });
    }

    const missing = createHimedSchedulingProvider({
      fetchImpl: fakeFetch(200, { mensaje: 'no existe', cantidad: 0 }),
    });
    const r2 = await missing.callTool(
      'mcp_himed-scheduling_patient_exists',
      { idPaciente: '00000000' },
      ctx(),
    );
    expect(r2.kind).toBe('success');
    if (r2.kind === 'success') expect(r2.data).toEqual({ found: false });
  });

  it('maps a 401 to PROVIDER_AUTH_EXPIRED', async () => {
    const provider = createHimedSchedulingProvider({
      fetchImpl: fakeFetch(401, { mensaje: 'token' }),
    });
    const result = await provider.callTool('mcp_himed-scheduling_list_locations', {}, ctx());
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe(ProviderErrorCode.AUTH_EXPIRED);
  });

  it('rejects a call missing codigo_servicio with INVALID_INPUT (metadata validation)', async () => {
    const provider = createHimedSchedulingProvider({ fetchImpl: fakeFetch(200, []) });
    const result = await provider.callTool(
      'mcp_himed-scheduling_list_locations',
      {},
      {
        credential: { secret: new SecretString('TOK') },
        metadata: {},
      },
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.code).toBe(ProviderErrorCode.INVALID_INPUT);
  });
});
