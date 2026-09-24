import { describe, expect, it, vi } from 'vitest';

import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { SLUG } from '../manifest';
import { createDentalinkProvider } from '../provider';

/** A Dentalink API token, forwarded and revealed only at the core materializer. */
const TOKEN = 'super-secret-dentalink-token';

const CTX: ProviderCallContext = { credential: { secret: new SecretString(TOKEN) } };

/** A fetch double that records (url, init) and answers with a body at a given status. */
function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { impl: impl as unknown as typeof globalThis.fetch, calls };
}

function provider(body: unknown, status = 200) {
  const { impl, calls } = fakeFetch(body, status);
  return { provider: createDentalinkProvider({ fetchImpl: impl }), calls };
}

function successData(result: ToolResult): unknown {
  if (result.kind !== 'success') throw new Error(`expected success, got: ${result.message}`);
  return result.data;
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

function queryOf(url: string, key: string): string | null {
  return new URL(url).searchParams.get(key);
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

describe('dentalink provider — conformance', () => {
  it('satisfies the generic provider contract', async () => {
    await runProviderConformance(createDentalinkProvider());
  });
});

describe('dentalink provider — catalog surface', () => {
  it('publishes an api_key descriptor that carries the Token scheme in the Authorization header', () => {
    const p = createDentalinkProvider();
    expect(p.auth.type).toBe('api_key');
    if (p.auth.type === 'api_key') {
      expect(p.auth.credentialDelivery).toBe('forwarded');
      expect(p.auth.fields).toEqual([
        { key: 'Authorization', label: 'API Token', placement: 'header', scheme: 'Token' },
      ]);
    }
  });

  it('declares NO contextSchema — one token = one clinic, id_sucursal is a per-call argument', () => {
    expect(createDentalinkProvider().contextSchema).toBeUndefined();
  });

  it('declares list_branches as the connection probe, and that tool exists', () => {
    const p = createDentalinkProvider();
    expect(p.manifest.connectionProbe).toEqual({ tool: `mcp_${SLUG}_list_branches` });
    expect(p.routableToolNames()).toContain(`mcp_${SLUG}_list_branches`);
  });
});

describe('dentalink provider — list_branches (tracer)', () => {
  it('GETs /sucursales with Authorization: Token <token> and returns the records verbatim', async () => {
    const branches = [{ id: 1, nombre: 'Sede Centro', habilitada: true }];
    const { provider: p, calls } = provider(branches);

    const result = await p.callTool(`mcp_${SLUG}_list_branches`, {}, CTX);

    expect(successData(result)).toEqual(branches);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.dentalink.healthatom.com/api/v1/sucursales');
    expect(headerOf(calls[0]!.init, 'Authorization')).toBe(`Token ${TOKEN}`);
  });

  it('maps a transport failure to an error result without leaking the token', async () => {
    const { provider: p, calls } = provider({ message: 'nope' }, 401);

    const result = await p.callTool(`mcp_${SLUG}_list_branches`, {}, CTX);

    expect(result.kind).toBe('error');
    // The token never appears in the surfaced message (Credential-in-Transit-Only).
    if (result.kind === 'error') expect(result.message).not.toContain(TOKEN);
    expect(calls).toHaveLength(1);
  });
});

describe('dentalink provider — v1 tool surface (S2/S3)', () => {
  it('publishes the 9 v1 tools, all namespaced and Token-authenticated', () => {
    const names = createDentalinkProvider().routableToolNames();
    expect(names).toEqual(
      expect.arrayContaining(
        [
          'list_branches',
          'list_specialties',
          'list_professionals',
          'list_treatments',
          'list_services',
          'list_available_slots',
          'find_patient',
          'create_patient',
          'create_appointment',
        ].map((v) => `mcp_${SLUG}_${v}`),
      ),
    );
    expect(names).toHaveLength(9);
  });

  it('list_services (no specialty) reads the global reasons catalog', async () => {
    const { provider: p, calls } = provider([]);
    await p.callTool(`mcp_${SLUG}_list_services`, {}, CTX);
    expect(calls[0]!.url).toBe(
      'https://api.dentalink.healthatom.com/api/v1/motivosAtencionEspecialidad',
    );
  });

  it('list_services (with specialty) scopes to that specialty', async () => {
    const { provider: p, calls } = provider([]);
    await p.callTool(`mcp_${SLUG}_list_services`, { idEspecialidad: '5' }, CTX);
    expect(calls[0]!.url).toBe(
      'https://api.dentalink.healthatom.com/api/v1/especialidades/5/motivos',
    );
  });

  it('list_professionals with no args reads /dentistas unfiltered', async () => {
    const { provider: p, calls } = provider([]);
    await p.callTool(`mcp_${SLUG}_list_professionals`, {}, CTX);
    expect(calls[0]!.url).toBe('https://api.dentalink.healthatom.com/api/v1/dentistas');
  });

  it('list_professionals scopes by branch/specialty via the q filter', async () => {
    const { provider: p, calls } = provider([]);
    await p.callTool(
      `mcp_${SLUG}_list_professionals`,
      { idSucursal: '1', idEspecialidad: '5' },
      CTX,
    );
    expect(JSON.parse(queryOf(calls[0]!.url, 'q')!)).toEqual({
      id_sucursal: { eq: '1' },
      id_especialidad: { eq: '5' },
    });
  });

  it('list_available_slots passes the documented GET /agendas params', async () => {
    const { provider: p, calls } = provider([]);
    await p.callTool(
      `mcp_${SLUG}_list_available_slots`,
      { idSucursal: '1', duracion: 30, fecha: '2026-10-01', idDentista: '7' },
      CTX,
    );
    const url = calls[0]!.url;
    expect(url).toContain('/agendas?');
    expect(queryOf(url, 'id_sucursal')).toBe('1');
    expect(queryOf(url, 'duracion')).toBe('30');
    expect(queryOf(url, 'fecha')).toBe('2026-10-01');
    expect(queryOf(url, 'id_dentista')).toBe('7');
  });

  it('find_patient builds the JSON q filter on the document, not the phone', async () => {
    const { provider: p, calls } = provider([]);
    await p.callTool(`mcp_${SLUG}_find_patient`, { documento: '11111111-1' }, CTX);
    const url = calls[0]!.url;
    expect(url).toContain('/pacientes?');
    expect(JSON.parse(queryOf(url, 'q')!)).toEqual({ rut: { eq: '11111111-1' } });
  });

  it('find_patient curates to id-only and never surfaces the patient PII', async () => {
    // Dentalink returns the full record; we curate to existence + id so no personal field reaches the
    // channel (data-privacy). The document resolves the writer's own ficha for the booking flow.
    const { provider: p } = provider({
      objects: [
        { id: 42, nombre: 'Juan', rut: '11111111-1', celular: '3001234567', email: 'j@x.com' },
      ],
    });
    const result = await p.callTool(`mcp_${SLUG}_find_patient`, { documento: '11111111-1' }, CTX);
    const data = successData(result);
    expect(data).toEqual({ exists: true, id_paciente: '42' });
    const asText = JSON.stringify(data);
    expect(asText).not.toContain('Juan');
    expect(asText).not.toContain('3001234567');
    expect(asText).not.toContain('j@x.com');
  });

  it('find_patient reports exists:false when no patient matches', async () => {
    const { provider: p } = provider({ objects: [] });
    const result = await p.callTool(`mcp_${SLUG}_find_patient`, { documento: '999' }, CTX);
    expect(successData(result)).toEqual({ exists: false });
  });

  it('create_patient POSTs to /pacientes with the basic fields and the Token header', async () => {
    const { provider: p, calls } = provider({ id: 42 });
    await p.callTool(
      `mcp_${SLUG}_create_patient`,
      { nombre: 'Juan', apellidos: 'Pérez', documento: '11111111-1', celular: '3001234567' },
      CTX,
    );
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.url).toBe('https://api.dentalink.healthatom.com/api/v1/pacientes');
    expect(headerOf(calls[0]!.init, 'Authorization')).toBe(`Token ${TOKEN}`);
    const body = bodyOf(calls[0]!.init);
    expect(body).toMatchObject({
      nombre: 'Juan',
      apellidos: 'Pérez',
      rut: '11111111-1',
      celular: '3001234567',
    });
  });

  it('create_appointment POSTs the booking body to /citas', async () => {
    const { provider: p, calls } = provider({ id: 99 });
    await p.callTool(
      `mcp_${SLUG}_create_appointment`,
      {
        idPaciente: '42',
        idDentista: '7',
        idSucursal: '1',
        fecha: '2026-10-01',
        horaInicio: '10:00',
        duracion: 30,
        idMotivo: '3',
      },
      CTX,
    );
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.url).toBe('https://api.dentalink.healthatom.com/api/v1/citas');
    expect(bodyOf(calls[0]!.init)).toMatchObject({
      id_paciente: '42',
      id_dentista: '7',
      id_sucursal: '1',
      fecha: '2026-10-01',
      hora_inicio: '10:00',
      duracion: 30,
      id_motivo: '3',
    });
  });
});
