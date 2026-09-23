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
  app = buildApp({
    port: 0,
    nodeEnv: 'test',
    logLevel: 'silent',
    serverSecret: SECRET,
    credentialResolveUrl: '',
    credentialResolveSecret: '',
    siigoPartnerId: '',
  });
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

  it('tools/list carries each tool’s identityPolicy onto the WIRE', async () => {
    /*
     * REGRESSION, and the field's whole reason to exist.
     *
     * #101 added `identityPolicy` to `ToolDefinition`, forwarded it through `provider-factory` and
     * `definePaginatedList`, and pinned it with tests that read `provider.listTools()` — the
     * in-process object. The protocol mapping, the only place a tool becomes something a consumer can
     * see, dropped it. Every declaration was true and none of it left the building; a PHI provider's
     * round-trip proof is what noticed.
     *
     * Asserted over RAW JSON-RPC on purpose. The SDK's own `ToolSchema` is a plain `z.object`, so its
     * typed client strips any field the spec does not name — a test written through `client.listTools()`
     * would report this absent even once it is present, and "fixing" that would mean deleting the fix.
     * xcale-backend reads raw JSON (`modules/mcp/mcp-client.ts`), which is the view that matters.
     */
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${SECRET}`,
        'x-provider-token': 'provider-token',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });

    const sse = res.body.match(/data: (\{[\s\S]*\})/);
    const body = JSON.parse(sse ? sse[1]! : res.body) as {
      result: { tools: Array<{ name: string; identityPolicy?: { mode: string } }> };
    };
    const byName = new Map(body.result.tools.map((t) => [t.name, t]));

    // A tool that reaches a named person says so.
    expect(byName.get('mcp_cloudbeds_search_guests')?.identityPolicy).toEqual({
      mode: 'subject-bound',
      identityFields: expect.any(Array),
    });
    // A tool that returns other people's records without taking an identifier says that instead.
    expect(byName.get('mcp_cloudbeds_list_reservations')?.identityPolicy).toEqual({
      mode: 'subject-scoped',
    });
    // And the majority, which reach nobody, still publish nothing — absence is meaningful.
    expect(byName.get('mcp_echo_say')?.identityPolicy).toBeUndefined();
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

  it('maps a provider auth failure to a typed PROVIDER_AUTH_EXPIRED result over the wire', async () => {
    const client = await connect();
    const res = await client.callTool({ name: 'mcp_echo_reconnect_required', arguments: {} });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ ok: false, code: 'PROVIDER_AUTH_EXPIRED' });
    await client.close();
  });
});
