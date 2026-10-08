import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AUDIENCE_META_KEY, IDENTITY_POLICY_META_KEY } from '../../../core/types';
import { buildApp } from '../../../server';
import { cloudbedsProvider } from '../index';
import { cloudbedsManifest } from '../manifest';

/**
 * Who each Cloudbeds tool may serve (ADR `tool-audience-gate-on-guest-channels`, xcale#1243).
 *
 * A consumer cannot tell, from a name and a schema, that `list_reservations` returns the whole
 * property's book while `get_availability` returns nothing about anybody. The provider says it, and
 * the consumer refuses `operator` tools when a guest is on the other end of the conversation.
 *
 * The customer set is pinned EXACTLY, in both directions: a tool silently promoted to `customer` is a
 * guest-facing read of other people's data, and a tool silently demoted to `operator` breaks the
 * booking path for every hotel. Either change has to be a deliberate edit of this list.
 */
const CUSTOMER_TOOLS = [
  'get_availability',
  'get_room_calendar',
  'get_rate_plans',
  'list_room_types',
  'get_hotel_details',
  'list_properties',
  'list_items',
  'get_payment_options',
  'list_addons',
].map((verb) => `mcp_cloudbeds_${verb}`);

describe('cloudbeds publishes who each tool may serve', () => {
  const published = cloudbedsProvider.listTools();

  it('declares an audience on every published tool', () => {
    // A provider that classifies some tools and not others leaves the unmarked ones to the
    // consumer's fail-closed fallback — correct, but silent. Here it is a failing test instead.
    const unmarked = published.filter((t) => t.audience === undefined).map((t) => t.name);
    expect(unmarked).toEqual([]);
  });

  it('serves the guest only through the reads that touch nobody else', () => {
    const customer = published
      .filter((t) => t.audience === 'customer')
      .map((t) => t.name)
      .sort();
    expect(customer).toEqual([...CUSTOMER_TOOLS].sort());
  });

  it('marks every other published tool operator', () => {
    const operator = published.filter((t) => t.audience === 'operator');
    expect(operator).toHaveLength(published.length - CUSTOMER_TOOLS.length);
    expect(published).toHaveLength(39);
  });

  it('never marks a person-bound or property-wide read customer', () => {
    // The two declarations answer different questions, but a tool that reaches someone's records
    // can never be one the guest may run — the identity gate is not a substitute for this one.
    for (const tool of published) {
      if (tool.identityPolicy !== undefined) {
        expect(tool.audience, tool.name).toBe('operator');
      }
    }
  });

  it('declares the version bump that a changed tools/list requires', () => {
    expect(cloudbedsManifest.schemaVersion).toBe('2026-10-07');
    expect(cloudbedsManifest.providerVersion).toBe('0.11.0');
  });
});

/**
 * Over the wire, through the real `tools/list` handler. The handler rebuilds every tool field by
 * field — that is how `identityPolicy` first shipped and never arrived (review of #101) — so a
 * provider-level assertion alone proves nothing about what a consumer receives.
 */
describe('audience reaches the consumer over the wire', () => {
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

  async function listTools() {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: { authorization: `Bearer ${SECRET}`, 'x-provider-token': 'provider-token' },
      },
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    await client.close();
    return tools;
  }

  it('carries BOTH keys on a tool that declares both', async () => {
    // `search_guests` is the case a single-key `_meta` builder would get wrong: whichever key it
    // wrote last would overwrite the other.
    const tools = await listTools();
    const search = tools.find((t) => t.name === 'mcp_cloudbeds_search_guests');

    expect(search?._meta?.[AUDIENCE_META_KEY]).toBe('operator');
    expect(search?._meta?.[IDENTITY_POLICY_META_KEY]).toEqual({
      mode: 'subject-bound',
      identityFields: ['guestPhone', 'guestEmail', 'guestFirstName', 'guestLastName'],
    });
  });

  it('carries the audience alone on a tool with no identity policy', async () => {
    const tools = await listTools();
    const rooms = tools.find((t) => t.name === 'mcp_cloudbeds_list_room_types');

    expect(rooms?._meta?.[AUDIENCE_META_KEY]).toBe('customer');
    expect(rooms?._meta?.[IDENTITY_POLICY_META_KEY]).toBeUndefined();
  });

  it('publishes every Cloudbeds audience, not just the ones a test names', async () => {
    const tools = await listTools();
    const cloudbeds = tools.filter((t) => t.name.startsWith('mcp_cloudbeds_'));

    expect(cloudbeds).toHaveLength(39);
    for (const tool of cloudbeds) {
      expect(['customer', 'operator'], tool.name).toContain(tool._meta?.[AUDIENCE_META_KEY]);
    }
  });

  it('adds no `_meta` to a tool of a provider that does not classify', async () => {
    // Untouched providers stay byte-identical on the wire.
    const tools = await listTools();
    const echo = tools.find((t) => t.name.startsWith('mcp_echo_'));

    expect(echo, 'the echo provider must publish a tool').toBeDefined();
    expect(echo?._meta).toBeUndefined();
  });
});
