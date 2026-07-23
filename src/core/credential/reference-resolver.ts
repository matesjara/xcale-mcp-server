import { SecretString } from '../secret-string';
import type { CredentialResolver } from './credential-resolver';
import type { ResolvedCredential } from './resolved-credential';

/**
 * `reference` delivery resolver (ADR: credential-delivery-strategies).
 *
 * Unwraps the inbound REFERENCE nonce — a single-use, short-TTL, non-secret pointer, NOT a credential
 * — and resolves it just-in-time via a Hop-B callback to the Credential Authority (the backend). The
 * resolved credential comes back and is wrapped in a fresh `SecretString`; it is only ever revealed
 * later, at the materializer (the single credential-egress point).
 *
 * The nonce is `.reveal()`ed HERE (the only other reveal site besides the materializer): it is the
 * reference, not the credential — see docs/security/credential-boundary-review.md.
 */
export interface ReferenceResolverDeps {
  /** Backend resolve endpoint (`POST {resolveUrl}` → `{ token }`). */
  readonly resolveUrl: string;
  /** Shared Hop-B secret the backend verifies (server → backend). */
  readonly hopBSecret: string;
  /** Injectable for deterministic tests (default: global fetch). */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Durable credential behind the reference is revoked/invalid — PROVIDER-owned (→ PROVIDER_AUTH_EXPIRED). */
export class ReferenceAuthExpiredError extends Error {
  constructor(message = 'reconnect required') {
    super(message);
    this.name = 'ReferenceAuthExpiredError';
  }
}

/** Reference unusable (unknown/expired/consumed) or the callback failed — TRANSPORT-owned (never a ToolResult). */
export class ReferenceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceResolutionError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function createReferenceCredentialResolver(deps: ReferenceResolverDeps): CredentialResolver {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return {
    async resolve(inbound: SecretString): Promise<ResolvedCredential> {
      const reference = inbound.reveal(); // the reference nonce (non-secret), unwrapped only here
      if (reference.length === 0) {
        throw new ReferenceResolutionError('no reference provided');
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetchImpl(deps.resolveUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${deps.hopBSecret}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({ reference }),
          signal: controller.signal,
        });
      } catch (e) {
        throw new ReferenceResolutionError(
          e instanceof Error ? `resolve callback failed: ${e.message}` : 'resolve callback failed',
        );
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 200) {
        const body = (await res.json()) as { token?: unknown };
        if (typeof body.token !== 'string' || body.token.length === 0) {
          throw new ReferenceResolutionError('resolve returned no token');
        }
        return { secret: new SecretString(body.token) };
      }
      if (res.status === 422) {
        throw new ReferenceAuthExpiredError();
      }
      // 410 (reference invalid), 401 (Hop-B), 5xx, … → transport-owned; the emitter retries once.
      throw new ReferenceResolutionError(`resolve failed (HTTP ${res.status})`);
    },
  };
}
