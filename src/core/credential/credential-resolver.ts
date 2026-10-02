import { assertNever } from '../errors';
import type { CredentialDelivery } from '../provider-port';
import type { SecretString } from '../secret-string';
import type { ResolvedCredential } from './resolved-credential';

/**
 * The Credential Resolution seam (ADR: credential-delivery-strategies): turn the inbound wire value
 * (a forwarded credential OR an ephemeral reference) into a uniform `ResolvedCredential`. Both
 * strategies converge here; from the resolved credential onward the pipeline is identical.
 */
export interface CredentialResolver {
  /**
   * `secrets` is the pre-split named-secret bundle for a multi-credential provider (built by the
   * protocol from the wire — already `SecretString`s, never parsed from a revealed value). Absent ⇒
   * single-secret, unchanged.
   */
  resolve(
    inbound: SecretString,
    secrets?: Readonly<Record<string, SecretString>>,
  ): Promise<ResolvedCredential>;
}

/**
 * `forwarded`: the inbound value already IS the usable credential — near-identity. Preserves the
 * existing behavior for Cloudbeds/Nevatal/echo; carries a named-secret bundle through when present.
 */
export const forwardedCredentialResolver: CredentialResolver = {
  resolve: (inbound, secrets) =>
    Promise.resolve(secrets ? { secret: inbound, secrets } : { secret: inbound }),
};

/** Runtime deps for delivery strategies that need more than identity (the reference resolver). */
export interface CredentialResolverDeps {
  /** The `reference` resolver, wired from config. Absent = this server doesn't serve reference providers. */
  readonly reference?: CredentialResolver;
}

/**
 * Dispatch by the provider's declared `credentialDelivery`. Exhaustive (`assertNever`) — a new
 * strategy is a compile error until its resolver exists. No `if forwarded/else` in the runtime.
 */
export async function resolveCredential(
  delivery: CredentialDelivery,
  inbound: SecretString,
  deps: CredentialResolverDeps = {},
  secrets?: Readonly<Record<string, SecretString>>,
): Promise<ResolvedCredential> {
  switch (delivery) {
    case 'forwarded':
      return forwardedCredentialResolver.resolve(inbound, secrets);
    case 'reference':
      if (deps.reference === undefined) {
        throw new Error('reference credential delivery is not configured on this server');
      }
      return deps.reference.resolve(inbound, secrets);
    default:
      return assertNever(delivery);
  }
}
