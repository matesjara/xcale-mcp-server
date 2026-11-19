import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../../../core/catalog';
import { createRegistry } from '../../../core/registry';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import { createRestofyProvider, restofyProvider } from '../provider';
import businessProfile from '../__fixtures__/businessProfile.json';
import { type Captured, ctx, fakeRestofy, sentBody, sentHeader } from './helpers';

// ---------------------------------------------------------------------------
// S1 — discovery and the first read
// ---------------------------------------------------------------------------

describe('restofy provider — S1 discovery', () => {
  it('passes provider conformance', async () => {
    await runProviderConformance(restofyProvider);
  });

  it('is the restofy restaurant-pos provider, proving its credential by minting', () => {
    expect(restofyProvider.manifest.slug).toBe('restofy');
    expect(restofyProvider.manifest.displayName).toBe('Restofy');
    expect(restofyProvider.manifest.category).toBe('restaurant-pos');
    expect(restofyProvider.manifest.connectionProbe).toBeUndefined();
  });

  it('publishes a credential_exchange mint at create-api-token, the token at data.accessToken, reused one day', () => {
    const [entry] = buildCatalog(createRegistry([restofyProvider]));
    expect(entry?.authDescriptor).toEqual({
      type: 'credential_exchange',
      credentialDelivery: 'reference',
      tokenEndpoint: 'https://restofy.pro/api/auth/create-api-token',
      method: 'POST',
      bodyFields: { apiKey: 'apiKey', tenantKey: 'tenantKey' },
      responseFields: { token: 'data.accessToken' },
      tokenTtlSeconds: 86_400,
      tokenPlacement: 'bearer_header',
    });
  });

  it('declares no call context: one token is one restaurant', () => {
    expect(restofyProvider.contextSchema).toBeUndefined();
  });
});

describe('restofy provider — S1 get_business_profile', () => {
  it('POSTs to the business profile, bearer-authenticated, and returns Restofy data unwrapped', async () => {
    const capture: Captured[] = [];
    const provider = createRestofyProvider({
      fetchImpl: fakeRestofy(
        { 'business-profile/get-business-profile': { body: businessProfile } },
        capture,
      ),
    });

    const r = await provider.callTool('mcp_restofy_get_business_profile', {}, ctx);

    expect(r).toMatchObject({ kind: 'success', data: businessProfile.data });
    expect(capture).toHaveLength(1);
    expect(capture[0]?.init.method).toBe('POST');
    expect(capture[0]?.url).toBe('https://restofy.pro/api/business-profile/get-business-profile');
    expect(sentHeader(capture[0], 'authorization')).toBe('Bearer minted-jwt');
    expect(sentBody(capture[0])).toEqual({});
  });
});
