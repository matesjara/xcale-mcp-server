import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../../../core/catalog';
import { ProviderErrorCode } from '../../../core/errors';
import { createRegistry } from '../../../core/registry';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import type { ProviderCallContext } from '../../../core/types';
import { aviratoProvider, createAviratoProvider } from '../provider';
import establishment from '../__fixtures__/establishment.json';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface Captured {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
}

/** A fake `fetch` that records each request and answers with a canned JSON body and status. */
function fakeFetch(opts: { status?: number; body?: unknown; capture?: Captured[] }): typeof fetch {
  const status = opts.status ?? 200;
  return (async (url: string, init: Captured['init']) => {
    opts.capture?.push({ url, init });
    const text = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? '');
    return new Response(text, { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const ctx: ProviderCallContext = {
  credential: { secret: new SecretString('minted-jwt') },
  metadata: { web_code: 1234 },
};

// ---------------------------------------------------------------------------
// S1 — skeleton, discovery and the first read
// ---------------------------------------------------------------------------

describe('avirato provider — S1 discovery', () => {
  it('passes provider conformance', async () => {
    await runProviderConformance(aviratoProvider);
  });

  it('is the avirato hospitality provider', () => {
    expect(aviratoProvider.manifest.slug).toBe('avirato');
    expect(aviratoProvider.manifest.displayName).toBe('Avirato');
    expect(aviratoProvider.manifest.category).toBe('hospitality');
    expect(aviratoProvider.manifest.connectionProbe).toBeUndefined();
    expect(aviratoProvider.manifest.contextDiscovery).toBeUndefined();
  });

  it('publishes a credential_exchange mint at /v3/token/login, the token nested at data.token, reused 15 minutes', () => {
    const [entry] = buildCatalog(createRegistry([aviratoProvider]));
    expect(entry?.authDescriptor).toEqual({
      type: 'credential_exchange',
      credentialDelivery: 'reference',
      tokenEndpoint: 'https://apiv3.avirato.com/v3/token/login',
      method: 'POST',
      bodyFields: { email: 'email', password: 'password' },
      responseFields: { token: 'data.token' },
      tokenTtlSeconds: 900,
      tokenPlacement: 'bearer_header',
    });
  });

  it('names the establishment by a required numeric web_code in the call context', () => {
    const schema = aviratoProvider.contextSchema as
      | { properties?: Record<string, { type?: string }>; required?: readonly string[] }
      | undefined;
    expect(schema?.required).toEqual(['web_code']);
    expect(schema?.properties?.web_code?.type).toBe('integer');
  });
});

describe('avirato provider — S1 get_establishment', () => {
  it('reads the establishment of the context web_code, bearer-authenticated, and returns Avirato data unwrapped', async () => {
    const capture: Captured[] = [];
    const provider = createAviratoProvider({
      fetchImpl: fakeFetch({ body: establishment, capture }),
    });

    const r = await provider.callTool('mcp_avirato_get_establishment', {}, ctx);

    expect(r).toMatchObject({ kind: 'success', data: establishment.data });
    expect(capture).toHaveLength(1);
    expect(capture[0]?.init.method).toBe('GET');
    expect(capture[0]?.url).toBe('https://apiv3.avirato.com/v3/establishment?web_code=1234');
    expect(capture[0]?.init.headers?.authorization ?? capture[0]?.init.headers?.Authorization).toBe(
      'Bearer minted-jwt',
    );
  });

  it('honours a base URL override (the sandbox)', async () => {
    const capture: Captured[] = [];
    const provider = createAviratoProvider({
      baseUrl: 'https://sandbox.avirato.com/v3/',
      fetchImpl: fakeFetch({ body: establishment, capture }),
    });

    await provider.callTool('mcp_avirato_get_establishment', {}, ctx);

    expect(capture[0]?.url).toBe('https://sandbox.avirato.com/v3/establishment?web_code=1234');
  });

  it('refuses a call without a web_code before reaching Avirato', async () => {
    const capture: Captured[] = [];
    const provider = createAviratoProvider({ fetchImpl: fakeFetch({ capture }) });

    const r = await provider.callTool(
      'mcp_avirato_get_establishment',
      {},
      {
        credential: ctx.credential,
        metadata: {},
      },
    );

    expect(r).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(0);
  });
});
