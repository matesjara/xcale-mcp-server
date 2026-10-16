import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { buildCatalog } from '../catalog';
import type { FetchLike } from '../http';
import { createProvider } from '../provider-factory';
import type { ProviderAuthDescriptor, ProviderManifest } from '../provider-port';
import { createRegistry } from '../registry';
import { SecretString } from '../secret-string';
import { runProviderConformance } from '../testing/provider-conformance';
import { ok, toolFactory } from '../tool';

// ADR credential-less-provider-auth: a provider whose API takes no secret declares `none`; its
// target account travels as non-secret routing data in the call context.
const manifest: ProviderManifest = {
  slug: 'opendemo',
  displayName: 'Open Demo',
  category: 'test',
  schemaVersion: '1',
  providerVersion: '0.1.0',
};
const auth: ProviderAuthDescriptor = { type: 'none' };

interface OpenMeta {
  siteKey: string;
}
const tool = toolFactory<OpenMeta>();

function openProvider(fetchImpl: FetchLike) {
  return createProvider<OpenMeta>({
    manifest,
    auth,
    metadataSchema: z.object({ siteKey: z.string().min(1) }),
    fetchImpl,
    tools: [
      tool({
        name: 'mcp_opendemo_read',
        description: 'read',
        input: z.object({}).strict(),
        handler: async (_args, ctx) => {
          const res = await ctx.request({
            method: 'GET',
            url: `https://open.test/api/${ctx.metadata.siteKey}/details`,
            headers: { 'x-requested-with': 'XMLHttpRequest' },
          });
          return res.ok ? ok(res.data) : ok({ failed: res.status });
        },
      }),
    ],
  });
}

function capturingFetch() {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    return new Response(JSON.stringify({ name: 'Hotel' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as FetchLike;
  return { seen, fetchImpl };
}

describe('credential-less provider (auth none)', () => {
  it('sends its requests untouched — no auth header, no credential in the URL', async () => {
    const { seen, fetchImpl } = capturingFetch();
    const r = await openProvider(fetchImpl).callTool(
      'mcp_opendemo_read',
      {},
      { credential: { secret: new SecretString('') }, metadata: { siteKey: 'hotel-a' } },
    );

    expect(r).toMatchObject({ kind: 'success', data: { name: 'Hotel' } });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://open.test/api/hotel-a/details');
    // Only the handler's own header plus the transport's `accept` — nothing auth-shaped is added.
    expect(Object.keys(seen[0]?.headers ?? {}).sort()).toEqual(['accept', 'x-requested-with']);
  });

  it('never reveals whatever arrived in the credential slot', async () => {
    const { seen, fetchImpl } = capturingFetch();
    const inbound = new SecretString('stray-token');
    const reveal = vi.spyOn(inbound, 'reveal');

    await openProvider(fetchImpl).callTool(
      'mcp_opendemo_read',
      {},
      { credential: { secret: inbound }, metadata: { siteKey: 'hotel-a' } },
    );

    expect(reveal).not.toHaveBeenCalled();
    expect(JSON.stringify(seen)).not.toContain('stray-token');
  });

  it('passes provider conformance', async () => {
    await runProviderConformance(openProvider(capturingFetch().fetchImpl));
  });

  it('is published in the catalog as { type: none } — no fields, no secret, context only', () => {
    const [entry] = buildCatalog(createRegistry([openProvider(capturingFetch().fetchImpl)]));

    expect(entry?.authDescriptor).toEqual({ type: 'none' });
    expect(entry?.contextSchema).toMatchObject({ properties: { siteKey: { type: 'string' } } });
  });
});
