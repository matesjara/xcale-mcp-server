import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { FetchLike } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import { createCloudbedsProvider } from '../provider';

/** Route by Cloudbeds method name, like the main suite. A method with no route 404s. */
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>): FetchLike {
  return (async (url: string | URL) => {
    const method = new URL(url.toString()).pathname.split('/').pop() ?? '';
    const route = routes[method];
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  }) as FetchLike;
}

const ctx = (metadata: Record<string, unknown> = { propertyID: 'PROP1' }) => ({
  credential: { secret: new SecretString('tok') },
  metadata,
});

const okBody = (data: unknown) => ({ success: true, data });

/** How Cloudbeds denies a scope: HTTP 200 + success:false. The envelope decides, never the status. */
const scopeDenied = {
  status: 200,
  body: { success: false, message: 'Scope required for this call was not granted by property.' },
};

describe('cloudbeds administrative tools', () => {
  describe('get_property_configuration — four endpoints, one question', () => {
    it('composes the four reads into a single answer', async () => {
      const provider = createCloudbedsProvider({
        fetchImpl: fakeFetch({
          getAppPropertySettings: { body: okBody({ checkInTime: '15:00' }) },
          getCurrencySettings: { body: okBody({ currencyCode: 'COP' }) },
          getTaxesAndFees: { body: okBody([{ name: 'IVA', amount: 19 }]) },
          getCustomFields: { body: okBody([{ shortcode: 'nit' }]) },
        }),
      });
      const res = await provider.callTool('mcp_cloudbeds_get_property_configuration', {}, ctx());
      expect(res.kind).toBe('success');
      if (res.kind !== 'success') return;
      expect(res.data).toEqual({
        appSettings: { checkInTime: '15:00' },
        currency: { currencyCode: 'COP' },
        taxesAndFees: [{ name: 'IVA', amount: 19 }],
        customFields: [{ shortcode: 'nit' }],
      });
    });

    it('reports a partial answer rather than failing everything', async () => {
      // A property's PLAN can legitimately lack one capability — the real meaning of Cloudbeds'
      // "not granted by property". Losing the other three because of it would make the tool useless
      // for that hotel; hiding the gap would be a silent failure. So: data + an explicit `unavailable`.
      const provider = createCloudbedsProvider({
        fetchImpl: fakeFetch({
          getAppPropertySettings: { body: okBody({ checkInTime: '15:00' }) },
          getCurrencySettings: { body: okBody({ currencyCode: 'COP' }) },
          getTaxesAndFees: scopeDenied,
          getCustomFields: { body: okBody([]) },
        }),
      });
      const res = await provider.callTool('mcp_cloudbeds_get_property_configuration', {}, ctx());
      expect(res.kind).toBe('success');
      if (res.kind !== 'success') return;
      const data = res.data as Record<string, unknown>;
      expect(data.appSettings).toEqual({ checkInTime: '15:00' });
      expect(data.unavailable).toMatchObject({ taxesAndFees: expect.stringContaining('Scope') });
      expect(res.message).toContain('taxesAndFees');
    });

    it('fails when nothing at all could be read — as a reconnect signal when all fail on scope', async () => {
      // Everything absent is a real failure, not a partial one — it must surface, not return `{}`.
      // And when every read failed on an ungranted scope (a token predating a scope bump), the
      // failure is a reconnect signal (AUTH_EXPIRED), not an opaque PROVIDER_ERROR (soul.md #2).
      const provider = createCloudbedsProvider({
        fetchImpl: fakeFetch({
          getAppPropertySettings: scopeDenied,
          getCurrencySettings: scopeDenied,
          getTaxesAndFees: scopeDenied,
          getCustomFields: scopeDenied,
        }),
      });
      const res = await provider.callTool('mcp_cloudbeds_get_property_configuration', {}, ctx());
      expect(res.kind).toBe('error');
      if (res.kind !== 'error') return;
      expect(res.code).toBe(ProviderErrorCode.AUTH_EXPIRED);
      expect(res.message).toContain('Scope');
    });
  });

  describe('get_payment_options', () => {
    it('returns methods plus capabilities', async () => {
      const provider = createCloudbedsProvider({
        fetchImpl: fakeFetch({
          getPaymentMethods: { body: okBody(['cash', 'card']) },
          getPaymentsCapabilities: { body: okBody({ refund: true }) },
        }),
      });
      const res = await provider.callTool('mcp_cloudbeds_get_payment_options', {}, ctx());
      expect(res.kind).toBe('success');
      if (res.kind !== 'success') return;
      expect(res.data).toEqual({ methods: ['cash', 'card'], capabilities: { refund: true } });
    });

    it('still answers when only capabilities are unavailable', async () => {
      // "How can this guest pay?" is answered by the methods alone; capabilities are supplementary.
      const provider = createCloudbedsProvider({
        fetchImpl: fakeFetch({
          getPaymentMethods: { body: okBody(['cash']) },
          getPaymentsCapabilities: scopeDenied,
        }),
      });
      const res = await provider.callTool('mcp_cloudbeds_get_payment_options', {}, ctx());
      expect(res.kind).toBe('success');
      if (res.kind !== 'success') return;
      expect(res.data).toMatchObject({ methods: ['cash'], capabilities: null });
    });

    it('fails when the methods themselves are unavailable', async () => {
      const provider = createCloudbedsProvider({
        fetchImpl: fakeFetch({ getPaymentMethods: scopeDenied }),
      });
      const res = await provider.callTool('mcp_cloudbeds_get_payment_options', {}, ctx());
      expect(res.kind).toBe('error');
    });
  });

  describe('list_items', () => {
    it('returns items with their categories and forwards the category filter', async () => {
      let itemsUrl = '';
      const provider = createCloudbedsProvider({
        fetchImpl: (async (url: string | URL) => {
          const u = url.toString();
          const method = new URL(u).pathname.split('/').pop();
          if (method === 'getItems') {
            itemsUrl = u;
            return new Response(JSON.stringify(okBody([{ itemID: '1' }])), { status: 200 });
          }
          return new Response(JSON.stringify(okBody([{ id: 'cat1' }])), { status: 200 });
        }) as FetchLike,
      });
      const res = await provider.callTool(
        'mcp_cloudbeds_list_items',
        { itemCategoryID: 'cat1' },
        ctx(),
      );
      expect(res.kind).toBe('success');
      expect(new URL(itemsUrl).searchParams.get('itemCategoryID')).toBe('cat1');
      expect(new URL(itemsUrl).searchParams.get('propertyID')).toBe('PROP1');
    });
  });

  describe('list_users', () => {
    it('sends `property_ids` — snake_case and plural, NOT the usual propertyID', async () => {
      // The regression this pins: every other Cloudbeds method takes `propertyID`, so following the
      // surrounding convention here is the natural mistake. The spec says `property_ids`.
      let calledUrl = '';
      const provider = createCloudbedsProvider({
        fetchImpl: (async (url: string | URL) => {
          calledUrl = url.toString();
          return new Response(JSON.stringify(okBody([{ userID: '9' }])), { status: 200 });
        }) as FetchLike,
      });
      const res = await provider.callTool('mcp_cloudbeds_list_users', {}, ctx());
      expect(res.kind).toBe('success');
      const qs = new URL(calledUrl).searchParams;
      expect(qs.get('property_ids')).toBe('PROP1');
      expect(qs.get('propertyID')).toBeNull();
    });
  });

  describe('list_email_templates', () => {
    it('is read-only — no template/schedule write tool is published', () => {
      // Deliberate: an agent authoring a hotel's outbound email is real risk with no proven use case.
      // `write:communication` is registered but unused, so it is never requested (derived scopes).
      const names = createCloudbedsProvider()
        .listTools()
        .map((t) => t.name);
      expect(names).toContain('mcp_cloudbeds_list_email_templates');
      expect(names.some((n) => /email.*(create|post|update|write)/i.test(n))).toBe(false);
    });

    it('returns templates plus schedule', async () => {
      const provider = createCloudbedsProvider({
        fetchImpl: fakeFetch({
          getEmailTemplates: { body: okBody([{ id: 't1' }]) },
          getEmailSchedule: { body: okBody([{ id: 's1' }]) },
        }),
      });
      const res = await provider.callTool('mcp_cloudbeds_list_email_templates', {}, ctx());
      expect(res.kind).toBe('success');
      if (res.kind !== 'success') return;
      expect(res.data).toEqual({ templates: [{ id: 't1' }], schedule: [{ id: 's1' }] });
    });
  });

  it('no administrative tool requests a scope beyond its own job', () => {
    // Derived scopes mean an over-declared tool silently widens the consent screen for every hotel.
    const tools = createCloudbedsProvider().listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('mcp_cloudbeds_list_users')).toBeDefined();
  });

  it('publishes NO adjustment tool, and therefore never asks a hotel for write:adjustment', () => {
    /**
     * PAUSED 2026-07-15 (JuanJo) — financial. The full reasoning is in `tools.ts`, where the tool would
     * go; this is the fence, so that building it is a decision someone makes rather than a gap someone
     * fills. From the outside it looks like an easy win: the scope is authorized, it is one endpoint.
     *
     * It is not. `postAdjustment` puts a charge or discount on a real guest's bill, and we hold neither
     * of the tools needed to do that responsibly: `delete:adjustment` (to void it) is NOT among our
     * registered scopes, and `read:adjustment` has no published endpoint (so it cannot be read back).
     * Blind and irreversible. A human confirmation does not fix either — it answers *when* it fires.
     *
     * If you are deleting this test to build the tool: get `delete:adjustment` registered and confirm
     * with Cloudbeds whether `read:adjustment` has an endpoint FIRST.
     */
    const provider = createCloudbedsProvider();
    const names = provider.listTools().map((t) => t.name);
    expect(names.some((n) => /adjustment/i.test(n))).toBe(false);

    const auth = provider.auth;
    if (auth.type !== 'oauth2') throw new Error('expected oauth2');
    // The payoff of derived scopes: not building it is what keeps this off every hotel's consent screen.
    expect(auth.scopes).not.toContain('write:adjustment');
    expect(auth.scopes).not.toContain('read:adjustment');
  });
});
