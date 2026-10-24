import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import { createCloudbedsProvider } from '../provider';

/**
 * How every Cloudbeds tool reads an answer (`unwrap`), through one plain read (`get_guest`).
 *
 * #71 — a failed call carries what Cloudbeds said, so the agent has something to correct.
 * #72 — a 200 whose body is not an object is answered, never thrown on.
 */
const ctx = {
  credential: { secret: new SecretString('cbat_test0000000000000000000000000') },
  metadata: { propertyID: '20064' },
  request: {},
} as never;

function answering(status: number, body: string, contentType = 'application/json') {
  return createCloudbedsProvider({
    fetchImpl: (async () =>
      new Response(body, { status, headers: { 'content-type': contentType } })) as never,
  });
}

async function getGuest(provider: ReturnType<typeof createCloudbedsProvider>) {
  return (await provider.callTool('mcp_cloudbeds_get_guest', { guestID: 'G-1' }, ctx)) as {
    kind: string;
    code?: string;
    message?: string;
    data?: unknown;
  };
}

describe('a failed call carries what Cloudbeds said (#71)', () => {
  it('takes `message` from a JSON error body, and keeps the code the status maps to', async () => {
    const res = await getGuest(
      answering(400, JSON.stringify({ success: false, message: 'Parameter guestID is invalid' })),
    );
    expect(res.kind).toBe('error');
    expect(res.code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(res.message).toBe('Cloudbeds getGuest failed (HTTP 400): Parameter guestID is invalid');
  });

  it('takes `error` when that is the field Cloudbeds used', async () => {
    const res = await getGuest(
      answering(404, JSON.stringify({ status: false, error: 'Unknown method.' })),
    );
    expect(res.message).toBe('Cloudbeds getGuest failed (HTTP 404): Unknown method.');
  });

  it('keeps a plain-text body as it is', async () => {
    const res = await getGuest(answering(429, 'Too many requests', 'text/plain'));
    expect(res.message).toBe('Cloudbeds getGuest failed (HTTP 429): Too many requests');
  });

  it('leaves out an HTML error page — noise in the agent prompt, nothing the status does not say', async () => {
    const res = await getGuest(
      answering(502, '<html><body><h1>502 Bad Gateway</h1></body></html>', 'text/html'),
    );
    expect(res.message).toBe('Cloudbeds getGuest failed (HTTP 502)');
  });

  it('says only the status when the body is empty', async () => {
    const res = await getGuest(answering(500, ''));
    expect(res.message).toBe('Cloudbeds getGuest failed (HTTP 500)');
  });

  it('a revoked credential still raises AUTH_EXPIRED, now with the reason', async () => {
    const res = await getGuest(
      answering(401, JSON.stringify({ success: false, message: 'Invalid token' })),
    );
    expect(res.code).toBe(ProviderErrorCode.AUTH_EXPIRED);
    expect(res.message).toContain('Invalid token');
  });
});

describe('a 200 that is not an object is answered, not thrown on (#72)', () => {
  it.each([
    ['a bare string', '"ok"', 'ok'],
    ['a number', '42', 42],
    ['a boolean', 'true', true],
  ])('%s passes through as the data', async (_label, body, expected) => {
    const res = await getGuest(answering(200, body));
    expect(res.kind).toBe('success');
    expect(res.data).toEqual(expected);
  });

  it('the envelope is still unwrapped', async () => {
    const res = await getGuest(
      answering(200, JSON.stringify({ success: true, data: { guestID: 'G-1' } })),
    );
    expect(res.data).toEqual({ guestID: 'G-1' });
  });
});
