import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import type { FetchLike } from '../../../core/http';
import { SecretString } from '../../../core/secret-string';
import { createCloudbedsProvider } from '../provider';

const ctx = (metadata: Record<string, unknown> = { propertyID: 'PROP1' }) => ({
  credential: { secret: new SecretString('tok') },
  metadata,
});

/** Capture the outgoing requests — url, method, body — to assert what went on the wire. */
function capture(bodies: readonly unknown[]) {
  const seen: { url: string; method: string; body: string }[] = [];
  let call = 0;
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    seen.push({
      url: url.toString(),
      method: init?.method ?? 'GET',
      body: init?.body ? String(init.body) : '',
    });
    const body = bodies[Math.min(call, bodies.length - 1)];
    call += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as FetchLike;
  return { seen, fetchImpl };
}

const okEnvelope = { success: true, data: {} };

const CONTROL_PLANE_TOOLS = [
  'mcp_cloudbeds_get_app_state',
  'mcp_cloudbeds_set_app_state',
  'mcp_cloudbeds_ensure_webhook_subscription',
  'mcp_cloudbeds_remove_webhook_subscriptions',
] as const;

describe('cloudbeds control plane — the boundary itself', () => {
  it('withdraws every control-plane tool from tools/list', () => {
    // tools/list IS the agent's menu: the consumer builds its catalog from it, so a tool absent here
    // cannot be chosen by a model, hallucinated into a plan, or reached through prompt injection.
    // This is the whole reason the flag exists — if it ever regresses, the webhook endpointUrl (a
    // bearer credential) and a one-way `disabled` switch become agent surface again.
    const published = createCloudbedsProvider()
      .listTools()
      .map((t) => t.name);
    for (const name of CONTROL_PLANE_TOOLS) {
      expect(published, name).not.toContain(name);
    }
    // …and the agent surface is still there: this must not have hidden the whole provider.
    expect(published).toContain('mcp_cloudbeds_list_reservations');
  });

  it('keeps them callable by name — hidden from the agent, reachable by the consumer', async () => {
    const { fetchImpl } = capture([okEnvelope]);
    const result = await createCloudbedsProvider({ fetchImpl }).callTool(
      'mcp_cloudbeds_get_app_state',
      {},
      ctx(),
    );
    // The point of the asymmetry: not published, still dispatched. UNKNOWN_TOOL here would mean the
    // consumer's control plane lost its only path to Cloudbeds' connect/disconnect contract.
    expect(result.kind).toBe('success');
  });

  it('adds NO scope to the authorize URL — the consent screen is unchanged', () => {
    // The spec declares these methods `OAuth2: []`. If any of them declared a nominal scope it would
    // land in every hotel's consent screen and force a reconnect (which has a human cost) — and a new
    // WRITE scope would additionally trigger Cloudbeds re-certification.
    const auth = createCloudbedsProvider().auth;
    if (auth.type !== 'oauth2') throw new Error('expected oauth2');
    expect(auth.scopes).not.toContain('write:app');
    expect(auth.scopes).not.toContain('read:app');
    expect(auth.scopes).not.toContain('write:webhook');
    expect(auth.scopes).toHaveLength(22); // 17 read + 5 write — the set declared to Cloudbeds
  });
});

describe('set_app_state', () => {
  it('POSTs postAppState with the wire field app_state', async () => {
    const { seen, fetchImpl } = capture([okEnvelope]);
    const result = await createCloudbedsProvider({ fetchImpl }).callTool(
      'mcp_cloudbeds_set_app_state',
      { appState: 'disabled' },
      ctx(),
    );

    expect(result.kind).toBe('success');
    const req = seen[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://hotels.cloudbeds.com/api/v1.3/postAppState');
    // Cloudbeds spells it `app_state`; our input spells it `appState`. The adapter is the translator —
    // send `appState` and the call is a silent no-op that leaves the app listed in Manage Apps.
    expect(req.body).toContain('app_state=disabled');
    expect(req.body).toContain('propertyID=PROP1');
  });

  it('rejects any state Cloudbeds does not define', async () => {
    const { seen, fetchImpl } = capture([okEnvelope]);
    const result = await createCloudbedsProvider({ fetchImpl }).callTool(
      'mcp_cloudbeds_set_app_state',
      { appState: 'off' },
      ctx(),
    );

    expect(result.kind).toBe('error');
    expect(seen).toHaveLength(0); // never reached the provider
  });
});

describe('ensure_webhook_subscription', () => {
  it('subscribes an https receiver to an object/action', async () => {
    const { seen, fetchImpl } = capture([okEnvelope]);
    const result = await createCloudbedsProvider({ fetchImpl }).callTool(
      'mcp_cloudbeds_ensure_webhook_subscription',
      {
        endpointUrl: 'https://api.xcale.app/api/webhooks/cloudbeds/s3cr3t',
        object: 'integration',
        action: 'appstate_changed',
      },
      ctx(),
    );

    expect(result.kind).toBe('success');
    const req = seen[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://hotels.cloudbeds.com/api/v1.3/postWebhook');
    expect(req.body).toContain('object=integration');
    expect(req.body).toContain('action=appstate_changed');
  });

  it('refuses a plaintext endpoint — the event stream carries guest data and a path secret', async () => {
    const { seen, fetchImpl } = capture([okEnvelope]);
    const result = await createCloudbedsProvider({ fetchImpl }).callTool(
      'mcp_cloudbeds_ensure_webhook_subscription',
      {
        endpointUrl: 'http://api.xcale.app/api/webhooks/cloudbeds/s3cr3t',
        object: 'x',
        action: 'y',
      },
      ctx(),
    );

    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('unreachable');
    expect(result.code).toBe(ProviderErrorCode.INVALID_INPUT);
    expect(seen).toHaveLength(0);
  });
});

describe('remove_webhook_subscriptions', () => {
  const url = 'https://api.xcale.app/api/webhooks/cloudbeds/mine';

  /**
   * The shape `getWebhooks` ACTUALLY returns — copied from a live response on 2026-08-05, not from
   * the write contract. That distinction is the whole reason this test exists: the fixture used to
   * carry `endpointUrl` (the name `postWebhook` TAKES), the filter read the same invented name, and
   * both agreed with each other while disagreeing with Cloudbeds. A real disconnect removed 0 of 2
   * subscriptions and reported success.
   *
   * The last row keeps the written spelling on purpose: if Cloudbeds ever returns it that way too,
   * the tool must still match rather than silently skip.
   */
  const listing = {
    success: true,
    data: [
      {
        id: '0a2fd65c8ecf1d46d0f1576192acf66b',
        subscriptionData: { url },
        event: { entity: 'reservation', action: 'status_changed' },
      },
      {
        id: 'b3410e5ea394d67141e6017d7b6b686b',
        subscriptionData: { url },
        event: { entity: 'integration', action: 'appstate_changed' },
      },
      {
        id: 'sub-other',
        subscriptionData: { url: 'https://api.xcale.app/api/webhooks/cloudbeds/someone-else' },
        event: { entity: 'reservation', action: 'status_changed' },
      },
    ],
  };

  it('deletes only the subscriptions pointing at OUR url', async () => {
    const { seen, fetchImpl } = capture([listing, okEnvelope, okEnvelope]);
    const result = await createCloudbedsProvider({ fetchImpl }).callTool(
      'mcp_cloudbeds_remove_webhook_subscriptions',
      { endpointUrl: url },
      ctx(),
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('unreachable');
    expect(result.data).toEqual({ deleted: 2, matched: 2 });

    const deletes = seen.filter((r) => r.url.includes('deleteWebhook'));
    expect(deletes).toHaveLength(2);
    // The secret lives in the path. Another connection's subscription on the same property must
    // survive — a prefix match here would silently unhook a tenant that never disconnected.
    expect(deletes.some((r) => r.url.includes('sub-other'))).toBe(false);
    expect(deletes.every((r) => r.method === 'DELETE')).toBe(true);
    // DELETE params ride the query string: Cloudbeds does not parse a DELETE body.
    // The id also comes back under `id`, not the `subscriptionID` that `postWebhook` returns.
    expect(deletes[0]!.url).toContain('subscriptionID=0a2fd65c8ecf1d46d0f1576192acf66b');
    expect(deletes[0]!.url).toContain('propertyID=PROP1');
  });

  it('reports a partial delete as a failure, and never echoes the url', async () => {
    const denied = { success: false, message: 'Subscription not found' };
    const { fetchImpl } = capture([listing, okEnvelope, denied]);
    const result = await createCloudbedsProvider({ fetchImpl }).callTool(
      'mcp_cloudbeds_remove_webhook_subscriptions',
      { endpointUrl: url },
      ctx(),
    );

    // A caller tearing down must learn that something survived; "deleted 1" alone reads like success.
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('unreachable');
    expect(result.message).toContain('deleted 1 of 2');
    expect(result.message).not.toContain(url); // the url is the delivery credential
  });

  it('is a no-op when nothing points at the url', async () => {
    const { seen, fetchImpl } = capture([{ success: true, data: [] }]);
    const result = await createCloudbedsProvider({ fetchImpl }).callTool(
      'mcp_cloudbeds_remove_webhook_subscriptions',
      { endpointUrl: url },
      ctx(),
    );

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') throw new Error('unreachable');
    expect(result.data).toEqual({ deleted: 0, matched: 0 });
    expect(seen.filter((r) => r.url.includes('deleteWebhook'))).toHaveLength(0);
  });
});
