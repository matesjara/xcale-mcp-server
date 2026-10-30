import { describe, expect, it } from 'vitest';

import { SecretString } from '../../secret-string';
import {
  createReferenceCredentialResolver,
  ReferenceAuthExpiredError,
  ReferenceResolutionError,
} from '../reference-resolver';

function fakeFetch(
  status: number,
  body: unknown,
  capture?: (url: string, init: RequestInit) => void,
): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    capture?.(url, init);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

const deps = (fetchImpl: typeof fetch) => ({
  resolveUrl: 'https://backend/internal/credentials/resolve',
  hopBSecret: 'HOPB',
  fetchImpl,
});

describe('ReferenceCredentialResolver', () => {
  it('resolves a reference to a credential (200) — Hop-B auth + the reference in the body', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const resolver = createReferenceCredentialResolver(
      deps(
        fakeFetch(200, { token: 'JWT' }, (url, init) => {
          seen = { url, init };
        }),
      ),
    );
    const resolved = await resolver.resolve(new SecretString('ref-123'));
    expect(resolved.secret.reveal()).toBe('JWT');
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer HOPB');
    expect(JSON.parse(seen!.init.body as string)).toEqual({ reference: 'ref-123' });
  });

  it('422 (revoked durable credential) → ReferenceAuthExpiredError (provider-owned)', async () => {
    const resolver = createReferenceCredentialResolver(
      deps(fakeFetch(422, { reason: 'reconnect_required' })),
    );
    await expect(resolver.resolve(new SecretString('ref'))).rejects.toBeInstanceOf(
      ReferenceAuthExpiredError,
    );
  });

  it('410 (invalid reference) → ReferenceResolutionError (transport-owned)', async () => {
    const resolver = createReferenceCredentialResolver(
      deps(fakeFetch(410, { reason: 'reference_invalid' })),
    );
    await expect(resolver.resolve(new SecretString('ref'))).rejects.toBeInstanceOf(
      ReferenceResolutionError,
    );
  });

  it('a network failure → ReferenceResolutionError', async () => {
    const resolver = createReferenceCredentialResolver(
      deps((async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch),
    );
    await expect(resolver.resolve(new SecretString('ref'))).rejects.toBeInstanceOf(
      ReferenceResolutionError,
    );
  });

  it('an empty reference → ReferenceResolutionError, without calling the endpoint', async () => {
    let called = false;
    const resolver = createReferenceCredentialResolver(
      deps((async () => {
        called = true;
        return new Response('{}');
      }) as unknown as typeof fetch),
    );
    await expect(resolver.resolve(new SecretString(''))).rejects.toBeInstanceOf(
      ReferenceResolutionError,
    );
    expect(called).toBe(false);
  });

  // ADR credential-exchange-session-key-in-body: the Authority may return body companions beside the token.
  describe('body companions', () => {
    it('wraps each returned companion in a SecretString, keyed by its logical name', async () => {
      const resolver = createReferenceCredentialResolver(
        deps(fakeFetch(200, { token: 'PKEY', companions: { partnerToken: 'PARTNER' } })),
      );
      const resolved = await resolver.resolve(new SecretString('ref'));
      expect(resolved.secret.reveal()).toBe('PKEY');
      expect(resolved.companions?.partnerToken).toBeInstanceOf(SecretString);
      expect(resolved.companions?.partnerToken?.reveal()).toBe('PARTNER');
      // Never readable by accident: a serialized ResolvedCredential carries no companion value.
      expect(JSON.stringify(resolved)).not.toContain('PARTNER');
    });

    it('a token-only response resolves exactly as before — no companions key', async () => {
      const resolver = createReferenceCredentialResolver(deps(fakeFetch(200, { token: 'JWT' })));
      const resolved = await resolver.resolve(new SecretString('ref'));
      expect('companions' in resolved).toBe(false);
    });

    it.each([
      ['not an object', 'PARTNER'],
      ['an array', ['PARTNER']],
      ['a non-string value', { partnerToken: 42 }],
      ['an empty value', { partnerToken: '' }],
    ])(
      'malformed companions (%s) → ReferenceResolutionError, never a half credential',
      async (_, companions) => {
        const resolver = createReferenceCredentialResolver(
          deps(fakeFetch(200, { token: 'PKEY', companions })),
        );
        const err = await resolver.resolve(new SecretString('ref')).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ReferenceResolutionError);
        expect(String((err as Error).message)).not.toContain('PARTNER');
      },
    );
  });
});
