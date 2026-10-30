import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../catalog';
import type { FetchLike } from '../http';
import { createProvider } from '../provider-factory';
import type { ProviderAuthDescriptor, ProviderManifest } from '../provider-port';
import { createRegistry } from '../registry';
import { SecretString } from '../secret-string';
import { runProviderConformance } from '../testing/provider-conformance';
import { ok, toolFactory } from '../tool';

// ADR credential-exchange-session-key-in-body: a session-login provider (HotelSync-shaped) whose minted
// session key and partner token travel in the JSON body of every data call.
const manifest: ProviderManifest = {
  slug: 'sessiondemo',
  displayName: 'Session Demo',
  category: 'test',
  schemaVersion: '1',
  providerVersion: '0.1.0',
};
const auth: ProviderAuthDescriptor = {
  type: 'credential_exchange',
  credentialDelivery: 'reference',
  tokenEndpoint: 'https://pms.test/api/user/auth/login',
  method: 'POST',
  bodyFields: { partnerToken: 'token', username: 'username', password: 'password' },
  responseFields: { token: 'pkey' },
  tokenPlacement: 'body',
  tokenBodyField: 'key',
  bodyCompanions: { partnerToken: 'token' },
};

interface SessionMeta {
  id_properties: string;
}
const tool = toolFactory<SessionMeta>();

function sessionProvider(fetchImpl: FetchLike, descriptor: ProviderAuthDescriptor = auth) {
  return createProvider<SessionMeta>({
    manifest,
    auth: descriptor,
    metadataSchema: z.object({ id_properties: z.string().min(1) }),
    fetchImpl,
    tools: [
      tool({
        name: 'mcp_sessiondemo_list_rooms',
        description: 'list rooms',
        input: z.object({}).strict(),
        handler: async (_args, ctx) => {
          const res = await ctx.request({
            method: 'POST',
            url: 'https://pms.test/api/room/data/rooms',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id_properties: ctx.metadata.id_properties }),
          });
          return res.ok ? ok(res.data) : ok({ failed: res.status });
        },
      }),
    ],
  });
}

function capturingFetch() {
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({
      url,
      headers: { ...(init?.headers as Record<string, string>) },
      body: String(init?.body),
    });
    return new Response(JSON.stringify({ rooms: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as FetchLike;
  return { seen, fetchImpl };
}

describe('credential_exchange with the session key in the body', () => {
  it('a tool call carries the session key and the partner token in the body, never a header', async () => {
    const { seen, fetchImpl } = capturingFetch();
    const r = await sessionProvider(fetchImpl).callTool(
      'mcp_sessiondemo_list_rooms',
      {},
      {
        credential: {
          secret: new SecretString('PKEY'),
          companions: { partnerToken: new SecretString('PARTNER') },
        },
        metadata: { id_properties: 'P1' },
      },
    );

    expect(r.kind).toBe('success');
    expect(seen).toHaveLength(1);
    expect(JSON.parse(seen[0]!.body)).toEqual({
      id_properties: 'P1',
      key: 'PKEY',
      token: 'PARTNER',
    });
    expect(JSON.stringify(seen[0]!.headers)).not.toMatch(/PKEY|PARTNER/);
  });

  it('passes provider conformance', async () => {
    await runProviderConformance(sessionProvider(capturingFetch().fetchImpl));
  });

  it("conformance rejects tokenPlacement 'body' without a tokenBodyField", async () => {
    const { tokenBodyField: _omit, ...rest } = auth as typeof auth & { tokenBodyField?: string };
    const p = sessionProvider(capturingFetch().fetchImpl, rest as ProviderAuthDescriptor);
    await expect(runProviderConformance(p)).rejects.toThrow(/tokenBodyField/);
  });

  it('conformance rejects a body companion that is not a durable credential field', async () => {
    const p = sessionProvider(capturingFetch().fetchImpl, {
      ...auth,
      bodyCompanions: { apiSecret: 'token' },
    } as ProviderAuthDescriptor);
    await expect(runProviderConformance(p)).rejects.toThrow(/bodyCompanions "apiSecret"/);
  });

  it('the catalog publishes the new fields as names only', () => {
    const [entry] = buildCatalog(createRegistry([sessionProvider(capturingFetch().fetchImpl)]));
    expect(entry?.authDescriptor).toMatchObject({
      tokenPlacement: 'body',
      tokenBodyField: 'key',
      bodyCompanions: { partnerToken: 'token' },
    });
  });
});
