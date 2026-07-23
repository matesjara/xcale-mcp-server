import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server';

const SECRET = 'test-secret';
let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp({
    port: 0,
    nodeEnv: 'test',
    logLevel: 'silent',
    serverSecret: SECRET,
    credentialResolveUrl: '',
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('HTTP surface', () => {
  it('GET /health is public', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /discover requires Hop B', async () => {
    const res = await app.inject({ method: 'GET', url: '/discover' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /discover returns the capability catalog with Hop B', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/discover',
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      providers: Array<{ slug: string; authDescriptor: { type: string } }>;
    };
    const echo = body.providers.find((p) => p.slug === 'echo');
    expect(echo).toBeDefined();
    expect(echo?.authDescriptor.type).toBe('api_key');
  });

  it('POST /mcp requires Hop B', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(res.statusCode).toBe(401);
  });
});
