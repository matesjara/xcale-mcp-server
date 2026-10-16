import type { SecretString } from '../secret-string';

/**
 * The uniform runtime representation a `CredentialResolver` returns and that Authentication
 * Materialization consumes — the convergence point of both delivery strategies (ADR:
 * credential-delivery-strategies).
 *
 * Its CONCRETE representation is an implementation detail: today one secret suffices (bearer /
 * api_key / basic), so it wraps a single `SecretString`. The concept is "the material needed to
 * authenticate"; if imperative auth (HMAC/SigV4) ever lands it generalizes to richer material — a
 * change confined to the resolver + materializer, never the transport. Do NOT couple the transport
 * or a provider to `SecretString` — they see only `ResolvedCredential`.
 */
export interface ResolvedCredential {
  readonly secret: SecretString;
  /**
   * Named-secret bundle for multi-credential providers (ADR: himed-multi-credential-provider): keyed by
   * `CredentialGroup.key`. The materializer, given a tool's `credentialGroup`, reveals `secrets[group]`
   * instead of `secret`. Absent ⇒ single-secret providers (the sole `secret`), unchanged.
   */
  readonly secrets?: Readonly<Record<string, SecretString>>;
}
