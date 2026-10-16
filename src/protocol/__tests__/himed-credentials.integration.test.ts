import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The wire path every HiMed call depends on, end to end: a consumer sends the per-group secrets in
 * `X-Provider-Credentials` and the routing data in `X-Provider-Metadata`; `extractProviderCredentials`
 * parses the bundle, the protocol wraps each value in a `SecretString`, the forwarded resolver carries
 * them as `ResolvedCredential.secrets`, and the materializer injects the CALLED tool's group secret into
 * the JSON body. A harness that imports `createHimedProvider` directly skips all of that — this one goes
 * through `/mcp` over a real MCP client, against a fake HiMed that records what reached it.
 */

const SECRET = 'test-secret';
const DEMO_TOKEN = 'demo-secret-value';
const SCHED_TOKEN = 'sched-secret-value';
const SERVICE_CODE = 'SVC-0001';

interface Received {
  readonly path: string;
  readonly body: Record<string, unknown>;
}
const received: Received[] = [];
let fakeHimed: Server;
let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  fakeHimed = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      received.push({ path: req.url ?? '', body: JSON.parse(raw || '{}') });
      res.setHeader('content-type', 'application/json');
      if (req.url?.startsWith('/sched')) {
        res.statusCode = 201;
        res.end(JSON.stringify([{ cantidad: 1, nombre: 'PACIENTE PRUEBA', idEntidad: 'E1' }]));
        return;
      }
      res.statusCode = 201;
      res.end(JSON.stringify({ estado: 'success', mensaje: 'Paciente creado' }));
    });
  });
  await new Promise<void>((resolve) => fakeHimed.listen(0, '127.0.0.1', resolve));
  const himedUrl = `http://127.0.0.1:${(fakeHimed.address() as AddressInfo).port}`;

  // The provider reads its hosts from deployment config when its module loads, so the env is set
  // before the server (and with it the provider registry) is imported.
  vi.stubEnv('HIMED_BASE_URL', `${himedUrl}/demo`);
  vi.stubEnv('HIMED_SCHEDULING_BASE_URL', `${himedUrl}/sched`);
  const { buildApp } = await import('../../server');
  app = buildApp({
    port: 0,
    nodeEnv: 'test',
    logLevel: 'silent',
    serverSecret: SECRET,
    credentialResolveUrl: '',
    credentialResolveSecret: '',
    siigoPartnerId: '',
    himedBaseUrl: '',
    himedSchedulingBaseUrl: '',
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((resolve) => fakeHimed.close(() => resolve()));
  vi.unstubAllEnvs();
});

beforeEach(() => {
  received.length = 0;
});

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');

async function connect(credentials: Record<string, string>) {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: {
        authorization: `Bearer ${SECRET}`,
        // A multi-credential provider reads the bundle; the single token is not what it injects.
        'x-provider-token': 'unused-single-token',
        'x-provider-metadata': b64({ codigo_servicio: SERVICE_CODE }),
        'x-provider-credentials': b64(credentials),
      },
    },
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

describe('HiMed credentials over the wire (X-Provider-Credentials → materializer)', () => {
  it("injects the Demográficos group's secret into a patient write, and only that one", async () => {
    const client = await connect({ demograficos: DEMO_TOKEN, autoagendamiento: SCHED_TOKEN });
    const result = await client.callTool({
      name: 'mcp_himed_create_patient',
      arguments: {
        tipoDocumento: 'CC',
        idPaciente: '11111111',
        primerNombre: 'Prueba',
        primerApellido: 'Paciente',
        fechaNacimiento: '1990-01-01',
      },
    });
    await client.close();

    expect(result.isError).toBe(false);
    expect(received).toHaveLength(1);
    expect(received[0]!.path).toBe('/demo/Demograficos/crearPaciente.php');
    expect(received[0]!.body.api_key).toBe(DEMO_TOKEN);
    expect(JSON.stringify(received[0]!.body)).not.toContain(SCHED_TOKEN);
  });

  it("injects the Autoagendamiento group's secret and the service code into a scheduling call", async () => {
    const client = await connect({ demograficos: DEMO_TOKEN, autoagendamiento: SCHED_TOKEN });
    const result = await client.callTool({
      name: 'mcp_himed_patient_exists',
      arguments: { idPaciente: '11111111' },
    });
    await client.close();

    expect(result.isError).toBe(false);
    expect(received).toHaveLength(1);
    expect(received[0]!.path).toBe('/sched');
    expect(received[0]!.body).toMatchObject({
      accion: 'existePaciente',
      token: SCHED_TOKEN,
      codigo_servicio: SERVICE_CODE,
    });
    expect(JSON.stringify(received[0]!.body)).not.toContain(DEMO_TOKEN);
  });

  it('answers a typed, reconnectable error when the called group has no secret — and calls nobody', async () => {
    const client = await connect({ demograficos: DEMO_TOKEN });
    const result = await client.callTool({ name: 'mcp_himed_list_locations', arguments: {} });
    await client.close();

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'PROVIDER_AUTH_EXPIRED' });
    expect(received).toHaveLength(0);
  });

  it('never echoes a forwarded secret back to the consumer', async () => {
    const client = await connect({ demograficos: DEMO_TOKEN, autoagendamiento: SCHED_TOKEN });
    const result = await client.callTool({
      name: 'mcp_himed_patient_exists',
      arguments: { idPaciente: '11111111' },
    });
    await client.close();

    const echoed = JSON.stringify(result);
    expect(echoed).not.toContain(DEMO_TOKEN);
    expect(echoed).not.toContain(SCHED_TOKEN);
  });
});
