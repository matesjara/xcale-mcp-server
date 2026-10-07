import { SecretString } from '../core/secret-string';

/**
 * Hop A — extract the forwarded provider credential from the request header into a SecretString.
 * Never logged or persisted. A missing header yields an empty SecretString (adapters treat that
 * as "no credential" and return PROVIDER_AUTH_EXPIRED where they require one).
 */
export function extractProviderToken(headerValue: string | undefined): SecretString {
  return new SecretString(headerValue ?? '');
}

/**
 * Extract opaque, provider-scoped routing metadata (e.g. `propertyID`) forwarded by the consumer in
 * the `X-Provider-Metadata` header. Consumer-agnostic: the server does not interpret it — the
 * provider's `metadataSchema` validates the keys it needs. Accepts a JSON string or base64-encoded
 * JSON (the latter is header-safe). Fail-soft: malformed/absent → undefined (the adapter's schema
 * then rejects if it required something).
 */
export function extractProviderMetadata(
  headerValue: string | undefined,
): Record<string, unknown> | undefined {
  if (headerValue === undefined || headerValue.length === 0) return undefined;
  const parse = (raw: string): Record<string, unknown> | undefined => {
    try {
      const value: unknown = JSON.parse(raw);
      return typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  };
  return parse(headerValue) ?? parse(Buffer.from(headerValue, 'base64').toString('utf8'));
}

/**
 * Hop A — extract a multi-credential provider's named-secret bundle from the `X-Provider-Credentials`
 * header (a JSON object of `{ groupKey: secretValue }`, JSON or base64-JSON like metadata). The raw
 * string values are wrapped into `SecretString`s downstream (the protocol), so parsing here touches no
 * secret material through a `SecretString`. Fail-soft: malformed/absent → undefined (single-secret).
 */
export function extractProviderCredentials(
  headerValue: string | undefined,
): Record<string, string> | undefined {
  const obj = extractProviderMetadata(headerValue);
  if (obj === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') out[k] = v;
  return Object.keys(out).length > 0 ? out : undefined;
}
