import { describe, expect, it, vi } from 'vitest';

import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { SLUG } from '../manifest';
import { createDentalinkProvider } from '../provider';

/** A Dentalink API token, forwarded and revealed only at the core materializer. */
const TOKEN = 'super-secret-dentalink-token';

const CTX: ProviderCallContext = { credential: { secret: new SecretString(TOKEN) } };

/** A fetch double that records (url, init) and answers with a body at a given status. */
function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { impl: impl as unknown as typeof globalThis.fetch, calls };
}

function provider(body: unknown, status = 200) {
  const { impl, calls } = fakeFetch(body, status);
  return { provider: createDentalinkProvider({ fetchImpl: impl }), calls };
}

function successData(result: ToolResult): unknown {
  if (result.kind !== 'success') throw new Error(`expected success, got: ${result.message}`);
  return result.data;
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

describe('dentalink provider — conformance', () => {
  it('satisfies the generic provider contract', async () => {
    await runProviderConformance(createDentalinkProvider());
  });
});

describe('dentalink provider — catalog surface', () => {
  it('publishes an api_key descriptor that carries the Token scheme in the Authorization header', () => {
    const p = createDentalinkProvider();
    expect(p.auth.type).toBe('api_key');
    if (p.auth.type === 'api_key') {
      expect(p.auth.credentialDelivery).toBe('forwarded');
      expect(p.auth.fields).toEqual([
        { key: 'Authorization', label: 'API Token', placement: 'header', scheme: 'Token' },
      ]);
    }
  });

  it('declares NO contextSchema — one token = one clinic, id_sucursal is a per-call argument', () => {
    expect(createDentalinkProvider().contextSchema).toBeUndefined();
  });

  it('declares list_branches as the connection probe, and that tool exists', () => {
    const p = createDentalinkProvider();
    expect(p.manifest.connectionProbe).toEqual({ tool: `mcp_${SLUG}_list_branches` });
    expect(p.routableToolNames()).toContain(`mcp_${SLUG}_list_branches`);
  });
});

describe('dentalink provider — list_branches (tracer)', () => {
  it('GETs /sucursales with Authorization: Token <token> and returns the records verbatim', async () => {
    const branches = [{ id: 1, nombre: 'Sede Centro', habilitada: true }];
    const { provider: p, calls } = provider(branches);

    const result = await p.callTool(`mcp_${SLUG}_list_branches`, {}, CTX);

    expect(successData(result)).toEqual(branches);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.dentalink.healthatom.com/api/v1/sucursales');
    expect(headerOf(calls[0]!.init, 'Authorization')).toBe(`Token ${TOKEN}`);
  });

  it('maps a transport failure to an error result without leaking the token', async () => {
    const { provider: p, calls } = provider({ message: 'nope' }, 401);

    const result = await p.callTool(`mcp_${SLUG}_list_branches`, {}, CTX);

    expect(result.kind).toBe('error');
    // The token never appears in the surfaced message (Credential-in-Transit-Only).
    if (result.kind === 'error') expect(result.message).not.toContain(TOKEN);
    expect(calls).toHaveLength(1);
  });
});
