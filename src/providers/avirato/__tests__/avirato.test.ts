import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../../../core/catalog';
import { ProviderErrorCode } from '../../../core/errors';
import { createRegistry } from '../../../core/registry';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import type { ProviderCallContext } from '../../../core/types';
import { aviratoProvider, createAviratoProvider } from '../provider';
import availability from '../__fixtures__/availability.json';
import errorInvalidToken from '../__fixtures__/error-invalid-token.json';
import errorRetrieving from '../__fixtures__/error-retrieving.json';
import errorValidation from '../__fixtures__/error-validation.json';
import establishment from '../__fixtures__/establishment.json';
import extra from '../__fixtures__/extra.json';
import promoUnknown from '../__fixtures__/promo-unknown.json';
import rate from '../__fixtures__/rate.json';
import regime from '../__fixtures__/regime.json';
import space from '../__fixtures__/space.json';

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

// ---------------------------------------------------------------------------
// S2 — catalog reads
// ---------------------------------------------------------------------------

/** Calls one tool against a canned Avirato answer and returns the result and the request it sent. */
async function callWith(name: string, args: Record<string, unknown>, body: unknown, status = 200) {
  const capture: Captured[] = [];
  const provider = createAviratoProvider({ fetchImpl: fakeFetch({ body, status, capture }) });
  const result = await provider.callTool(name, args, ctx);
  return { result, capture };
}

describe('avirato provider — S2 catalog reads', () => {
  it.each([
    ['mcp_avirato_list_room_types', 'space', space],
    ['mcp_avirato_list_rates', 'rate', rate],
    ['mcp_avirato_list_regimes', 'regime', regime],
    ['mcp_avirato_list_extras', 'extra', extra],
  ])(
    '%s reads /%s of the context web_code and returns the array verbatim',
    async (name, path, body) => {
      const { result, capture } = await callWith(name, {}, body);

      expect(result).toMatchObject({ kind: 'success', data: body.data });
      expect(capture[0]?.init.method).toBe('GET');
      expect(capture[0]?.url).toBe(`https://apiv3.avirato.com/v3/${path}?web_code=1234`);
    },
  );

  it('check_availability sends the stay window and returns the subtypes day by day', async () => {
    const { result, capture } = await callWith(
      'mcp_avirato_check_availability',
      { start_date: '2027-02-16', end_date: '2027-02-17' },
      availability,
    );

    expect(result).toMatchObject({ kind: 'success', data: availability.data });
    expect(capture[0]?.url).toBe(
      'https://apiv3.avirato.com/v3/availability?web_code=1234&start_date=2027-02-16&end_date=2027-02-17',
    );
  });

  it('check_availability narrows to one subtype when asked', async () => {
    const { capture } = await callWith(
      'mcp_avirato_check_availability',
      { start_date: '2027-02-16', end_date: '2027-02-16', space_subtype_id: 2 },
      availability,
    );

    expect(capture[0]?.url).toContain('&space_subtype_id=2');
  });

  it.each([
    [{ start_date: '2027-02-30', end_date: '2027-03-01' }, 'a day that does not exist'],
    [{ start_date: '16/02/2027', end_date: '2027-02-17' }, 'a date not in YYYY-MM-DD'],
    [{ start_date: '2027-02-17', end_date: '2027-02-16' }, 'an end before the start'],
  ])('check_availability refuses %j (%s) before reaching Avirato', async (args) => {
    const { result, capture } = await callWith(
      'mcp_avirato_check_availability',
      args,
      availability,
    );

    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    expect(capture).toHaveLength(0);
  });

  it('validate_promotional_code answers { valid: false } when Avirato knows no such code', async () => {
    const { result, capture } = await callWith(
      'mcp_avirato_validate_promotional_code',
      { code: 'VERANO 10' },
      promoUnknown,
    );

    expect(result).toMatchObject({ kind: 'success', data: { valid: false } });
    expect(capture[0]?.url).toBe(
      'https://apiv3.avirato.com/v3/promotional_codes/VERANO%2010?web_code=1234',
    );
  });

  it('validate_promotional_code passes a known code through as { valid: true, code }', async () => {
    const known = { status: 'success', data: { code: 'VERANO10', discount: 10 } };
    const { result } = await callWith(
      'mcp_avirato_validate_promotional_code',
      { code: 'VERANO10' },
      known,
    );

    expect(result).toMatchObject({ kind: 'success', data: { valid: true, code: known.data } });
  });

  it('marks every catalog read read-only and keeps all of them on the agent menu', () => {
    const listed = aviratoProvider.listTools();
    for (const name of [
      'mcp_avirato_get_establishment',
      'mcp_avirato_list_room_types',
      'mcp_avirato_list_rates',
      'mcp_avirato_list_regimes',
      'mcp_avirato_list_extras',
      'mcp_avirato_check_availability',
      'mcp_avirato_validate_promotional_code',
    ]) {
      const t = listed.find((tool) => tool.name === name);
      expect(t, name).toBeDefined();
      expect(t?.readOnly, name).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// S3 — error mapping (contract §D)
// ---------------------------------------------------------------------------

describe('avirato provider — S3 errors', () => {
  const read = 'mcp_avirato_get_establishment';

  it('a rejected or superseded token (401) asks for a fresh mint: PROVIDER_AUTH_EXPIRED', async () => {
    const { result } = await callWith(read, {}, errorInvalidToken, 401);
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
  });

  it('a missing permission (403) is not a reconnect: PROVIDER_ERROR', async () => {
    const forbidden = { statusCode: 403, errorCode: 'FORBBIDEN', message: 'Forbidden' };
    const { result } = await callWith(read, {}, forbidden, 403);
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
    expect((result as { message: string }).message).toContain('FORBBIDEN');
  });

  it('a burst over the limit (429) is PROVIDER_RATE_LIMITED', async () => {
    const { result } = await callWith(
      read,
      {},
      { statusCode: 429, message: 'Too Many Requests' },
      429,
    );
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.RATE_LIMITED });
  });

  it('Avirato down (5xx) is PROVIDER_UNAVAILABLE', async () => {
    const { result } = await callWith(read, {}, 'Bad Gateway', 502);
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_UNAVAILABLE });
  });

  it('a validation refusal is PROVIDER_INVALID_INPUT and names what Avirato refused', async () => {
    const { result } = await callWith(read, {}, errorValidation, 400);
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.INVALID_INPUT });
    const message = (result as { message: string }).message;
    expect(message).toContain('INPUT_DATA_VALIDATION_FAILED');
    expect(message).toContain('start_date must be a valid ISO 8601 date string');
  });

  it('"not found or cancelled" is PROVIDER_ERROR with a plain reason, not a validation error', async () => {
    const { result } = await callWith(read, {}, errorRetrieving, 400);
    expect(result).toMatchObject({ kind: 'error', code: ProviderErrorCode.PROVIDER_ERROR });
    expect((result as { message: string }).message).toContain('not found or cancelled');
  });

  it('never echoes the request path, the web_code or the token in an error message', async () => {
    for (const [body, status] of [
      [errorRetrieving, 400],
      [errorValidation, 400],
      [errorInvalidToken, 401],
    ] as const) {
      const { result } = await callWith(read, {}, body, status);
      const message = (result as { message: string }).message;
      expect(message).not.toContain('/v3/');
      expect(message).not.toContain('1234');
      expect(message).not.toContain('minted-jwt');
    }
  });
});
