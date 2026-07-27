import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { FetchLike } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import createPayByLink from '../__fixtures__/createPayByLink.json';
import getPayByLinkStatus from '../__fixtures__/getPayByLinkStatus.json';
import { createCloudbedsProvider } from '../provider';

const ctx = (metadata: Record<string, unknown> = { propertyID: 'PROP1' }) => ({
  credential: { secret: new SecretString('tok') },
  metadata,
});

/** Capture the outgoing request — url, method, headers, body — to assert what went on the wire. */
function capture(status = 200, body: unknown = createPayByLink) {
  const seen: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    seen.push({
      url: url.toString(),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? String(init.body) : '',
    });
    return new Response(JSON.stringify(body), { status });
  }) as FetchLike;
  return { seen, fetchImpl };
}

describe('cloudbeds pay-by-link tools', () => {
  it('adds NO new scope — pay-by-link authenticates by Bearer + role, not a nominal OAuth scope', () => {
    // Cloudbeds Payments v2 does not use the v1.3 scope model. Declaring a `write:payment` scope would
    // fail the scopes guard (it is unregistered) and inject an unrequestable scope into the authorize
    // URL — a costly reconnect + a consent-screen move. `requiredScopes: []` is the honest answer.
    const auth = createCloudbedsProvider().auth;
    if (auth.type !== 'oauth2') throw new Error('expected oauth2');
    expect(auth.scopes).not.toContain('write:payment');
    expect(auth.scopes).not.toContain('create:payment');
  });

  describe('create_payment_link', () => {
    it('POSTs to Payments v2 with JSON body, X-Property-Id, and the contract inventoryObject', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_create_payment_link',
        { reservationID: 'RES-123', amount: 120, description: 'Reserva 3 noches' },
        ctx(),
      );
      const req = seen[0]!;
      expect(req.method).toBe('POST');
      expect(req.url).toBe('https://api.cloudbeds.com/payments/v2/pay-by-link');
      expect(req.headers['content-type']).toBe('application/json');
      expect(req.headers['X-Property-Id']).toBe('PROP1');
      expect(req.headers['authorization']).toBe('Bearer tok'); // materialized by the core, not the tool
      const body = JSON.parse(req.body);
      expect(body).toMatchObject({
        paid: 120,
        propertyId: 'PROP1',
        description: 'Reserva 3 noches',
        auth_payment: false, // default — a charge, not a hold
        expires_after: 7, // default
        inventoryObject: { type: 'confirmation_number', id: 'RES-123' },
      });
    });

    it('passes authOnly and expiresAfterDays through to the hold / expiry fields', async () => {
      const { seen, fetchImpl } = capture();
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_create_payment_link',
        { reservationID: 'RES-9', amount: 50, authOnly: true, expiresAfterDays: 3 },
        ctx(),
      );
      const body = JSON.parse(seen[0]!.body);
      expect(body.auth_payment).toBe(true);
      expect(body.expires_after).toBe(3);
      // An omitted optional (description) must be absent, never sent as null/"undefined".
      expect('description' in body).toBe(false);
    });

    it('returns the hosted url + tracking id verbatim from the v2 response', async () => {
      const provider = createCloudbedsProvider({ fetchImpl: capture().fetchImpl });
      const res = await provider.callTool(
        'mcp_cloudbeds_create_payment_link',
        { reservationID: 'RES-123', amount: 120 },
        ctx(),
      );
      expect(res.kind).toBe('success');
      if (res.kind !== 'success') return;
      expect(res.data).toMatchObject({
        url: createPayByLink.url,
        id: createPayByLink.id,
        expires_at: createPayByLink.expires_at,
      });
    });

    it('rejects amount <= 0 at the schema — never sends a zero-value charge', async () => {
      const provider = createCloudbedsProvider({ fetchImpl: capture().fetchImpl });
      const res = await provider.callTool(
        'mcp_cloudbeds_create_payment_link',
        { reservationID: 'RES-1', amount: 0 },
        ctx(),
      );
      expect(res.kind).toBe('error'); // rejected by the input schema, never hits the wire
    });

    it('maps a provider 401 to AUTH_EXPIRED — the reconnect signal, not an opaque error', async () => {
      const { fetchImpl } = capture(401, { message: 'Unauthorized' });
      const provider = createCloudbedsProvider({ fetchImpl });
      const res = await provider.callTool(
        'mcp_cloudbeds_create_payment_link',
        { reservationID: 'RES-1', amount: 10 },
        ctx(),
      );
      expect(res).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
    });
  });

  describe('get_payment_link_status', () => {
    it('GETs the status by link id with the X-Property-Id header', async () => {
      const { seen, fetchImpl } = capture(200, getPayByLinkStatus);
      const provider = createCloudbedsProvider({ fetchImpl });
      await provider.callTool(
        'mcp_cloudbeds_get_payment_link_status',
        { linkId: 'abc-123' },
        ctx(),
      );
      const req = seen[0]!;
      expect(req.method).toBe('GET');
      expect(req.url).toBe('https://api.cloudbeds.com/payments/v2/pay-by-link/abc-123');
      expect(req.headers['X-Property-Id']).toBe('PROP1');
    });

    it('returns the payByLinkStatus + paid flags for the guardrail to read', async () => {
      const provider = createCloudbedsProvider({
        fetchImpl: capture(200, getPayByLinkStatus).fetchImpl,
      });
      const res = await provider.callTool(
        'mcp_cloudbeds_get_payment_link_status',
        { linkId: 'abc-123' },
        ctx(),
      );
      expect(res.kind).toBe('success');
      if (res.kind !== 'success') return;
      expect(res.data).toMatchObject({
        payByLinkStatus: 'PAID',
        paid: true,
        readyForPayment: false,
      });
    });

    it('maps a provider 403 to AUTH_EXPIRED', async () => {
      const { fetchImpl } = capture(403, { message: 'Forbidden' });
      const provider = createCloudbedsProvider({ fetchImpl });
      const res = await provider.callTool(
        'mcp_cloudbeds_get_payment_link_status',
        { linkId: 'x' },
        ctx(),
      );
      expect(res).toMatchObject({ kind: 'error', code: ProviderErrorCode.AUTH_EXPIRED });
    });
  });
});
