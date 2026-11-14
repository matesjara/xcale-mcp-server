import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import { PROVIDERS } from '../..';
import { autocoreProvider, createAutocoreProvider } from '..';

const TOOLS = [
  'mcp_autocore_check_credentials',
  'mcp_autocore_create_payment_link',
  'mcp_autocore_deactivate_payment_link',
] as const;

/** Visibly fake keys, composed as the consumer stores them. */
const CTX = {
  credential: { secret: new SecretString('AK123:SK456') },
  metadata: { hotelId: 5, environment: 'staging', source: 'xcale' },
};

const rejecting = (async () =>
  new Response('{}', { status: 401 })) as unknown as typeof globalThis.fetch;

describe('autocore provider — conformance', () => {
  it('is registered, so the server serves it and the catalog lists it', () => {
    expect(PROVIDERS.map((p) => p.manifest.slug)).toContain('autocore');
  });

  it('publishes its auth, context and probe to the catalog, with no secret in them', () => {
    expect(autocoreProvider.auth).toEqual({
      type: 'timestamped_hash_token',
      header: 'Auth-Token',
      credentialDelivery: 'reference',
      fields: [
        { key: 'access_key', label: 'Autocore access key' },
        { key: 'secret_key', label: 'Autocore secret key' },
      ],
    });
    expect(autocoreProvider.manifest.connectionProbe).toEqual({
      tool: 'mcp_autocore_check_credentials',
    });
    expect(autocoreProvider.manifest.accountContextKeys).toEqual(['hotelId', 'environment']);
    expect(autocoreProvider.manifest.logoUrl).toBe('/assets/autocore.svg');
    expect(autocoreProvider.contextSchema).toMatchObject({ type: 'object' });
  });

  // Every tool moves money or proves keys: an agent reaches a payment only through the consumer's
  // guarded flow, never by picking one of these from its menu.
  it('publishes none of its tools to an agent, yet answers every one by name', async () => {
    const provider = createAutocoreProvider({ fetchImpl: rejecting });

    expect(provider.listTools()).toEqual([]);
    for (const name of TOOLS) {
      const result = await provider.callTool(name, {}, CTX);
      // Dispatched (not UNKNOWN_TOOL): invalid input or Autocore's 401, never "no such tool".
      expect(result, name).toMatchObject({ kind: 'error' });
      expect((result as { code: string }).code, name).not.toBe(ProviderErrorCode.UNKNOWN_TOOL);
    }
  });

  it('reports rejected keys as an expired credential through the full call path', async () => {
    const result = await createAutocoreProvider({ fetchImpl: rejecting }).callTool(
      'mcp_autocore_check_credentials',
      {},
      CTX,
    );
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
  });

  it('answers a malformed stored credential as reconnect-required, sending nothing', async () => {
    let calls = 0;
    const counting = (async () => {
      calls++;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const result = await createAutocoreProvider({ fetchImpl: counting }).callTool(
      'mcp_autocore_check_credentials',
      {},
      { ...CTX, credential: { secret: new SecretString('no-separator') } },
    );
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
    expect(calls).toBe(0);
  });
});
