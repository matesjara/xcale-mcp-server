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

  it('folds a multi-line message to one line and caps its length', async () => {
    const long = `Parameter\n  checkinDate is required. ${'x'.repeat(400)}`;
    const res = await getGuest(answering(400, JSON.stringify({ success: false, message: long })));
    expect(res.message).toMatch(
      /^Cloudbeds getGuest failed \(HTTP 400\): Parameter checkinDate is required\. x+…$/,
    );
    expect(res.message).not.toContain('\n');
    expect((res.message ?? '').length).toBeLessThan(400);
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

describe('nothing but the parsed message reaches the error text — never the raw body', () => {
  const guest = 'maria.perez@example.com';
  const phone = '+57 300 123 4567';

  it.each([
    [
      'JSON without a message',
      JSON.stringify({ success: false, guestEmail: guest, guestPhone: phone }),
      'application/json',
    ],
    ['a JSON array', JSON.stringify([{ guestEmail: guest }, 'Invalid guest']), 'application/json'],
    [
      'an object-valued message',
      JSON.stringify({ success: false, message: { guestEmail: guest, guestPhone: phone } }),
      'application/json',
    ],
    [
      'a JSON body cut at 500 chars',
      JSON.stringify({
        success: false,
        guestEmail: guest,
        guestPhone: phone,
        notes: 'n'.repeat(600),
        message: 'Invalid guest',
      }),
      'application/json',
    ],
    [
      'plain text carrying an email and a token',
      `Bad request for ${guest}, token cbat_live1234567890abcdef`,
      'text/plain',
    ],
    ['plain text', 'Too many requests', 'text/plain'],
  ])('%s → only the status', async (_label, body, contentType) => {
    const res = await getGuest(answering(400, body, contentType));
    expect(res.kind).toBe('error');
    expect(res.code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(res.message).toBe('Cloudbeds getGuest failed (HTTP 400)');
    expect(res.message).not.toContain(guest);
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
