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

const ctx = (metadata?: Record<string, unknown>) => ({ token: new SecretString('t'), metadata });

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
