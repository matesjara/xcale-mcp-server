/**
 * The mint relay (ADR credential-exchange-response-path-and-token-ttl): xcale-backend keeps custody,
 * cache and single-flight of a provider's token, but for a provider that binds the token to the login
 * IP (Avirato) its login request goes out through this server, whose egress IPs are dedicated.
 * Tested at the HTTP seam, with the provider's network stubbed.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../config';
import { createAviratoProvider } from '../providers/avirato/provider';
import { buildApp } from '../server';

const SECRET = 'hop-b-secret-value';
const AUTH = { authorization: `Bearer ${SECRET}` };
const AVIRATO_LOGIN = 'https://apiv3.avirato.com/v3/token/login';
const PASSWORD = 'p4ssw0rd-durable-credential';
const TOKEN = 'eyJ.minted.token';

const config: Config = {
  port: 0,
  nodeEnv: 'test',
  logLevel: 'info',
  serverSecret: SECRET,
  credentialResolveUrl: '',
  credentialResolveSecret: '',
  siigoPartnerId: '',
  himedBaseUrl: '',
  himedSchedulingBaseUrl: '',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(fetchImpl: typeof fetch) {
  const lines: string[] = [];
  const app = buildApp(config, {
    fetchImpl,
    logStream: { write: (line: string) => void lines.push(line) },
  });
  return { app, lines };
}

const relay = (app: ReturnType<typeof buildApp>, payload: unknown, headers = AUTH) =>
  app.inject({
    method: 'POST',
    url: '/credential-exchange/relay',
    headers,
    payload: payload as never,
  });

const login = { provider: 'avirato', body: { email: 'api@hotel.test', password: PASSWORD } };

describe('POST /credential-exchange/relay', () => {
  it('is behind the Hop-B guard: 401 without the secret, and nothing is sent', async () => {
    const fetchImpl = vi.fn();
    const { app } = setup(fetchImpl as never);
    const res = await relay(app, login, {} as never);
    expect(res.statusCode).toBe(401);
    const wrong = await relay(app, login, { authorization: 'Bearer nope' });
    expect(wrong.statusCode).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ['no provider', { body: {} }],
    ['empty provider', { provider: '', body: {} }],
    ['non-string provider', { provider: 7, body: {} }],
    ['no body', { provider: 'avirato' }],
    ['array body', { provider: 'avirato', body: [] }],
    ['string body', { provider: 'avirato', body: 'x' }],
    ['null body', { provider: 'avirato', body: null }],
  ])('400 invalid_request: %s', async (_name, payload) => {
    const fetchImpl = vi.fn();
    const { app } = setup(fetchImpl as never);
    const res = await relay(app, payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });

  it('404 relay_not_allowed for an unknown provider and for a credential_exchange provider that did not opt in', async () => {
    const fetchImpl = vi.fn();
    const { app } = setup(fetchImpl as never);
    for (const provider of ['no-such-provider', 'siigo', 'erbon', 'cloudbeds']) {
      const res = await relay(app, { provider, body: { a: 1 } });
      expect(res.statusCode, provider).toBe(404);
      expect(res.json()).toEqual({ error: 'relay_not_allowed' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });

  it("relays Avirato's login to its declared endpoint and returns the provider's status and body", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { status: 'success', data: { token: TOKEN, web_codes: ['W1'] } }),
    );
    const { app } = setup(fetchImpl as never);
    const res = await relay(app, login);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 201,
      body: { status: 'success', data: { token: TOKEN, web_codes: ['W1'] } },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(AVIRATO_LOGIN);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(login.body);
    await app.close();
  });

  it("relays a provider refusal as 200 with the provider's status", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { status: 'error', message: 'bad login' }),
    );
    const { app } = setup(fetchImpl as never);
    const res = await relay(app, login);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 401, body: { status: 'error', message: 'bad login' } });
    await app.close();
  });

  it('body is null when the provider did not answer JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>gateway</html>', { status: 502 }));
    const { app } = setup(fetchImpl as never);
    const res = await relay(app, login);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 502, body: null });
    await app.close();
  });

  it('502 provider_unreachable when the network call fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const { app } = setup(fetchImpl as never);
    const res = await relay(app, login);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'provider_unreachable' });
    await app.close();
  });

  it('502 provider_unreachable when the provider does not answer within the timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      const { app } = setup(fetchImpl as never);
      const pending = relay(app, login);
      await vi.advanceTimersByTimeAsync(16_000);
      const res = await pending;
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'provider_unreachable' });
      await app.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the caller cannot choose the URL: extra fields never reach the request target', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { data: { token: TOKEN } }));
    const { app } = setup(fetchImpl as never);
    const res = await relay(app, {
      provider: 'avirato',
      url: 'https://evil.test/steal',
      tokenEndpoint: 'https://evil.test/steal',
      body: { ...login.body, url: 'https://evil.test/steal', tokenEndpoint: 'https://evil.test' },
    });
    expect(res.statusCode).toBe(200);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(AVIRATO_LOGIN);
    await app.close();
  });

  it('logs nothing of the request or the response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { data: { token: TOKEN } }));
    const failing = vi.fn(async () => {
      throw new Error(`fetch failed ${PASSWORD}`);
    });
    for (const impl of [fetchImpl, failing]) {
      const { app, lines } = setup(impl as never);
      await relay(app, login);
      await app.close();
      const all = lines.join('\n');
      expect(all).not.toContain(PASSWORD);
      expect(all).not.toContain('api@hotel.test');
      expect(all).not.toContain(TOKEN);
    }
  });
});

describe('Avirato token endpoint follows the data base URL', () => {
  it('is the declared production endpoint by default', () => {
    const auth = createAviratoProvider().auth;
    expect(auth.type === 'credential_exchange' && auth.tokenEndpoint).toBe(AVIRATO_LOGIN);
    expect(auth.type === 'credential_exchange' && auth.relayMint).toBe(true);
  });

  it('follows the sandbox base when one is configured', () => {
    const auth = createAviratoProvider({ baseUrl: 'https://sandbox.avirato.com/v3/' }).auth;
    expect(auth.type === 'credential_exchange' && auth.tokenEndpoint).toBe(
      'https://sandbox.avirato.com/v3/token/login',
    );
  });
});
