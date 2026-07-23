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
});
