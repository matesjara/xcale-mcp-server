import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import { PROVIDERS } from '../..';
import { createWompiProvider } from '../provider';

const TOOLS = [
  'mcp_wompi_check_credentials',
  'mcp_wompi_create_payment_link',
  'mcp_wompi_deactivate_payment_link',
  'mcp_wompi_list_transactions',
] as const;

describe('wompi provider — conformance', () => {
  it('is registered, so the server serves it and the catalog lists it', () => {
    expect(PROVIDERS.map((p) => p.manifest.slug)).toContain('wompi');
  });

  // Every tool moves money or proves a key: an agent reaches a payment only through the consumer's
  // guarded flow, never by picking one of these from its menu.
  it('publishes none of its tools to an agent, yet answers every one by name', async () => {
    const provider = createWompiProvider({
      fetchImpl: (async () =>
        new Response('{}', { status: 401 })) as unknown as typeof globalThis.fetch,
    });

    expect(provider.listTools()).toEqual([]);
    for (const name of TOOLS) {
      const result = await provider.callTool(
        name,
        {},
        {
          credential: { secret: new SecretString('prv_test_FAKEKEYFORCONFORMANCE000') },
          metadata: { publicKey: 'pub_test_FAKE' },
        },
      );
      // Dispatched (not UNKNOWN_TOOL): invalid input or Wompi's 401, never "no such tool".
      expect(result, name).toMatchObject({ kind: 'error' });
      expect((result as { code: string }).code, name).not.toBe(ProviderErrorCode.UNKNOWN_TOOL);
    }
  });

  it('reports a rejected key as an expired credential through the full call path', async () => {
    const provider = createWompiProvider({
      fetchImpl: (async () =>
        new Response('{}', { status: 401 })) as unknown as typeof globalThis.fetch,
    });

    const result = await provider.callTool(
      'mcp_wompi_check_credentials',
      {},
      {
        credential: { secret: new SecretString('prv_test_FAKEKEYFORCONFORMANCE000') },
        metadata: { publicKey: 'pub_test_FAKE' },
      },
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
  });
});
