import { describe, expect, it, vi } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { createCloudbedsProvider } from '../provider';
import { SecretString } from '../../../core/secret-string';

/**
 * PARTNER-ONLY endpoints answered with a property-level API key.
 *
 * Cloudbeds serves some endpoints exclusively to partner integrations. Asked with a property key
 * they answer **HTTP 403** and `"This call is restricted to third-party integrations."` — measured
 * 2026-08-20 against Bio Habitat (property 20064) on `getEmailTemplates` and `getEmailSchedule`.
 *
 * The core maps every 403 to `AUTH_EXPIRED`, which is correct for a dead credential and wrong here:
 * the credential is valid and 20 other reads succeed with it. Left alone, ONE call to an email tool
 * flips a healthy connection to EXPIRED and asks the hotel to reconnect — which fixes nothing,
 * because the next call refuses identically. That is a reconnect loop pointed at a customer.
 *
 * So this is a correctness test about a signal, not about an endpoint: `AUTH_EXPIRED` means "your
 * credential needs renewing". It must not be raised when the credential is fine.
 */
describe('a partner-only endpoint refused with 403 is not a dead credential', () => {
  const ctx = {
    credential: { secret: new SecretString('cbat_test0000000000000000000000000') },
    metadata: { propertyID: '20064' },
    request: {},
  } as never;

  const refuse403 = () =>
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            message: 'This call is restricted to third-party integrations.',
          }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
    );

  it('does NOT ask the hotel to reconnect (the reconnect loop this prevents)', async () => {
    const provider = createCloudbedsProvider({ fetchImpl: refuse403() as never });
    const res = (await provider.callTool('mcp_cloudbeds_list_email_templates', {}, ctx)) as {
      kind: string;
      code?: string;
    };

    expect(res.kind).toBe('error');
    expect(res.code).not.toBe(ProviderErrorCode.AUTH_EXPIRED);
  });

  it('still fails, and says why, rather than pretending it worked', async () => {
    const provider = createCloudbedsProvider({ fetchImpl: refuse403() as never });
    const res = (await provider.callTool('mcp_cloudbeds_list_email_templates', {}, ctx)) as {
      kind: string;
      code?: string;
      message?: string;
    };

    expect(res.kind).toBe('error');
    expect(res.code).toBe(ProviderErrorCode.PROVIDER_ERROR);
    expect(res.message).toMatch(/third-party integrations/i);
  });

  it('a 403 that is NOT the partner-only refusal still means reconnect', async () => {
    // The guard must stay narrow: a genuinely revoked or expired credential also answers 403, and
    // that one MUST keep raising AUTH_EXPIRED or a dead connection would look like a provider hiccup.
    const revoked = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: false, message: 'Invalid token' }), { status: 403 }),
    );
    const provider = createCloudbedsProvider({ fetchImpl: revoked as never });
    const res = (await provider.callTool('mcp_cloudbeds_list_email_templates', {}, ctx)) as {
      code?: string;
    };

    expect(res.code).toBe(ProviderErrorCode.AUTH_EXPIRED);
  });
});
