import { describe, expect, it } from 'vitest';

import type { RequestSpec } from '../../../core/auth/http-request';
import type { RequestResult } from '../../../core/http';
import { createCloudbedsClient } from '../client';

/**
 * Slice 1 — the Cloudbeds **Payments v2** request path.
 *
 * Pay-by-link is a DIFFERENT API surface from the v1.3 one every other tool uses: base
 * `https://api.cloudbeds.com/payments/v2`, JSON body (not form-encoding), and a mandatory
 * `X-Property-Id` header. This test pins the shaping the client owns; auth (the Bearer) is added
 * later by the core materializer, not here.
 */
function captureSpec() {
  const seen: RequestSpec[] = [];
  const request = async (spec: RequestSpec): Promise<RequestResult> => {
    seen.push(spec);
    return { ok: true, status: 200, data: {} };
  };
  return { seen, request };
}

describe('cloudbeds payments client (v2 path)', () => {
  it('postPayments hits the v2 base with JSON body + X-Property-Id, not the v1.3 form path', async () => {
    const client = createCloudbedsClient({});
    const { seen, request } = captureSpec();
    await client.postPayments(
      'pay-by-link',
      request,
      { paid: 120, propertyId: 'PROP1' },
      { 'X-Property-Id': 'PROP1' },
    );
    const spec = seen[0]!;
    expect(spec.method).toBe('POST');
    expect(spec.url).toBe('https://api.cloudbeds.com/payments/v2/pay-by-link');
    expect(spec.headers?.['content-type']).toBe('application/json');
    expect(spec.headers?.['X-Property-Id']).toBe('PROP1');
    // JSON string, NOT a URLSearchParams form body.
    expect(typeof spec.body).toBe('string');
    expect(JSON.parse(spec.body as string)).toEqual({ paid: 120, propertyId: 'PROP1' });
  });

  it('getPayments hits the v2 base with the X-Property-Id header and no body', async () => {
    const client = createCloudbedsClient({});
    const { seen, request } = captureSpec();
    await client.getPayments('pay-by-link/abc-123', request, { 'X-Property-Id': 'PROP1' });
    const spec = seen[0]!;
    expect(spec.method).toBe('GET');
    expect(spec.url).toBe('https://api.cloudbeds.com/payments/v2/pay-by-link/abc-123');
    expect(spec.headers?.['X-Property-Id']).toBe('PROP1');
    expect(spec.body).toBeUndefined();
  });

  it('the v2 base is independent of a v1.3 baseUrl override', async () => {
    // A test/staging override of the v1.3 host must not accidentally redirect the payments call.
    const client = createCloudbedsClient({ baseUrl: 'https://staging.example/api/v1.3' });
    const { seen, request } = captureSpec();
    await client.getPayments('pay-by-link/x', request, { 'X-Property-Id': 'P' });
    expect(seen[0]!.url).toBe('https://api.cloudbeds.com/payments/v2/pay-by-link/x');
  });
});
