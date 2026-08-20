import { describe, expect, it } from 'vitest';

import { PROVIDERS } from '../../providers';
import { materialize } from '../auth/authentication-materializer';
import type { RequestSpec } from '../auth/http-request';
import type { ResolvedCredential } from '../credential/resolved-credential';
import type { ProviderAuthDescriptor } from '../provider-port';
import { SecretString } from '../secret-string';

/**
 * The invariant behind ADR `multiple-connect-methods-per-provider`.
 *
 * A provider may publish more than one way to CONNECT, but only one way to AUTHENTICATE: `auth` is
 * the single descriptor `materialize()` ever receives at runtime. That is only safe while every
 * ADDITIONAL descriptor would have produced the same request — otherwise a credential obtained
 * through the second method gets signed as if it came from the first, and the failure is a silently
 * mis-signed request, not a type error.
 *
 * So the parity is asserted, not assumed. A provider whose alternative method genuinely needs a
 * different placement fails here by design: it needs a per-connection descriptor selector, which is
 * a different design and a different ADR.
 */
describe('auth materialization parity across a provider’s connect methods', () => {
  const spec: RequestSpec = {
    method: 'GET',
    url: 'https://example.test/api/v1.3/getHotels',
    headers: { accept: 'application/json' },
  };

  const materializeWith = (auth: ProviderAuthDescriptor, secret: string) => {
    const resolved: ResolvedCredential = { secret: new SecretString(secret) };
    return materialize(auth, resolved, spec);
  };

  const withAlternatives = PROVIDERS.filter((p) => (p.additionalAuth?.length ?? 0) > 0);

  it('is exercised by at least one provider (the test would pass vacuously otherwise)', () => {
    expect(withAlternatives.map((p) => p.manifest.slug)).toContain('cloudbeds');
  });

  it.each(withAlternatives.map((p) => [p.manifest.slug, p] as const))(
    '%s: every additional descriptor materializes identically to the primary',
    (_slug, provider) => {
      const secret = 'cbat_TESTSECRET0000000000000000000000';
      const primary = materializeWith(provider.auth, secret);

      for (const alternative of provider.additionalAuth ?? []) {
        expect(materializeWith(alternative, secret)).toEqual(primary);
      }
    },
  );

  it('a differently-placed descriptor would FAIL this check (the guard is real, not decorative)', () => {
    const secret = 'cbat_TESTSECRET0000000000000000000000';
    const bearer: ProviderAuthDescriptor = {
      type: 'bearer',
      fields: [{ key: 'apiKey', label: 'API key', placement: 'header' }],
    };
    const headerKey: ProviderAuthDescriptor = {
      type: 'api_key',
      fields: [{ key: 'x-api-key', label: 'API key', placement: 'header' }],
    };

    expect(materializeWith(headerKey, secret)).not.toEqual(materializeWith(bearer, secret));
  });
});
