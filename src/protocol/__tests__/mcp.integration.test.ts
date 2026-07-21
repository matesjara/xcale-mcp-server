import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server';

const SECRET = 'test-secret';
let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  app = buildApp({ port: 0, nodeEnv: 'test', logLevel: 'silent', serverSecret: SECRET });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await app.close();
});

async function connect(providerToken = 'provider-token', metadata?: Record<string, unknown>) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${SECRET}`,
    'x-provider-token': providerToken,
  };
  if (metadata) {
    headers['x-provider-metadata'] = Buffer.from(JSON.stringify(metadata)).toString('base64');
  }
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers },
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

describe('MCP protocol (e2e over Streamable HTTP, stateless)', () => {
  it('tools/list returns the flat, namespaced tool set across providers', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('mcp_echo_say');
    expect(names).toContain('mcp_echo_auth_check');
    // a real provider's tools are exposed through the protocol too (not just the registry)
    expect(names).toContain('mcp_cloudbeds_list_reservations');
    await client.close();
  });

  it('tools/call executes a tool and returns a success result', async () => {
    const client = await connect();
    const res = await client.callTool({ name: 'mcp_echo_say', arguments: { message: 'hola' } });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ ok: true, data: { echoed: 'hola' } });
    await client.close();
  });

  it('enforces the metadata channel: a context-requiring tool with no X-Provider-Metadata → INVALID_INPUT', async () => {
    // No metadata header → the provider's metadataSchema (propertyID) rejects BEFORE any provider
    // API call (no network). Proves the metadata gate is active over the wire.
    const client = await connect();
    const res = await client.callTool({
      name: 'mcp_cloudbeds_get_hotel_details',
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ code: 'PROVIDER_INVALID_INPUT' });
    await client.close();
  });

  it('maps a provider auth failure to a typed PROVIDER_AUTH_EXPIRED result', async () => {
    const client = await connect(''); // no provider credential forwarded
    const res = await client.callTool({ name: 'mcp_echo_auth_check', arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ ok: false, code: 'PROVIDER_AUTH_EXPIRED' });
    await client.close();
  });
});
