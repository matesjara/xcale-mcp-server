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
