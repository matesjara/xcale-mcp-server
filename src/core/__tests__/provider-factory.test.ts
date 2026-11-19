import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../errors';
import { createProvider } from '../provider-factory';
import type { ProviderAuthDescriptor, ProviderManifest } from '../provider-port';
import { SecretString } from '../secret-string';
import { ok, toolFactory } from '../tool';

const manifest: ProviderManifest = {
  slug: 'demo',
  displayName: 'Demo',
  category: 'test',
  schemaVersion: '1',
  providerVersion: '0.1.0',
};
const auth: ProviderAuthDescriptor = {
  type: 'api_key',
  fields: [{ key: 'k', label: 'K', placement: 'header' }],
};

interface DemoMeta {
  accountId: string;
}

const tool = toolFactory<DemoMeta>();

const provider = createProvider<DemoMeta>({
  manifest,
  auth,
  metadataSchema: z.object({ accountId: z.string().min(1) }),
  tools: [
    tool({
      name: 'mcp_demo_greet',
      description: 'greet',
      input: z.object({ name: z.string().min(1) }).strict(),
      // args and ctx.metadata are both typed (z.infer + DemoMeta) — no casts.
      handler: async (args, ctx) => ok({ hi: args.name, account: ctx.metadata.accountId }),
    }),
  ],
});

const ctx = (metadata?: Record<string, unknown>) => ({
  credential: { secret: new SecretString('t') },
  metadata,
});

describe('createProvider dispatcher', () => {
  it('generates inputSchema (JSON Schema) for tools/list from the zod input', () => {
    expect(provider.listTools()[0]?.inputSchema).toMatchObject({ type: 'object' });
  });

  it('publishes contextSchema from metadataSchema (Explicit Context discovery)', () => {
    expect(provider.contextSchema).toMatchObject({ type: 'object' });
  });

  it('unknown tool → UNKNOWN_TOOL', async () => {
    const r = await provider.callTool('nope', {}, ctx({ accountId: 'a' }));
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.UNKNOWN_TOOL });
  });

  it('invalid/missing metadata → INVALID_INPUT', async () => {
    const r = await provider.callTool('mcp_demo_greet', { name: 'x' }, ctx({}));
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
  });

  it('invalid args → INVALID_INPUT', async () => {
    const r = await provider.callTool('mcp_demo_greet', { name: '' }, ctx({ accountId: 'a' }));
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
  });

  it('success → handler receives validated, typed args + metadata', async () => {
    const r = await provider.callTool(
      'mcp_demo_greet',
      { name: 'Ana' },
      ctx({ accountId: 'acc1' }),
    );
    expect(r).toMatchObject({ kind: 'success', data: { hi: 'Ana', account: 'acc1' } });
  });
});

describe('createProvider — timestamped_hash_token', () => {
  // ADR timestamped-hash-token-auth-scheme. Dummy keys only.
  const tokenAuth: ProviderAuthDescriptor = {
    type: 'timestamped_hash_token',
    header: 'Auth-Token',
    fields: [
      { key: 'access_key', label: 'Access key' },
      { key: 'secret_key', label: 'Secret key' },
    ],
  };
  const seen: Array<Record<string, string>> = [];
  const fakeFetch: typeof globalThis.fetch = async (_url, init) => {
    seen.push({ ...((init?.headers ?? {}) as Record<string, string>) });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const tokenProvider = createProvider({
    manifest,
    auth: tokenAuth,
    tools: [
      toolFactory<unknown>()({
        name: 'mcp_demo_ping',
        description: 'two requests in one call',
        input: z.object({}).strict(),
        handler: async (_args, toolCtx) => {
          await toolCtx.request({ method: 'GET', url: 'https://api.test/a' });
          await toolCtx.request({ method: 'GET', url: 'https://api.test/b' });
          return ok({ done: true });
        },
      }),
    ],
    fetchImpl: fakeFetch,
    clock: () => 1_700_000_000_000,
  });
  const secretCtx = (secret: string) => ({ credential: { secret: new SecretString(secret) } });

  it('passes the injected clock to materialization: every request carries the token for that time', async () => {
    seen.length = 0;
    const r = await tokenProvider.callTool('mcp_demo_ping', {}, secretCtx('AK123:SK456'));
    expect(r).toMatchObject({ kind: 'success' });
    expect(seen).toHaveLength(2);
    for (const headers of seen) {
      expect(headers['Auth-Token']).toBe(
        'QUsxMjM7MTcwMDAwMDAwMDs2ZjA4ODc5N2FkOWM1MGQyNTYzZTQwOTNiODhhZjI2NzMyMzMxOGM1OWIxYzI2OWNlNDBhYjQwNDliNjMzMzEz',
      );
    }
  });

  it('a malformed composed secret → AUTH_EXPIRED as a typed outcome, with no request sent and no secret in it', async () => {
    seen.length = 0;
    const r = await tokenProvider.callTool('mcp_demo_ping', {}, secretCtx('nocolonsecret'));
    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
    expect(seen).toHaveLength(0);
    expect(JSON.stringify(r)).not.toContain('nocolonsecret');
  });
});
