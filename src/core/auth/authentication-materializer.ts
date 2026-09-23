import type { ResolvedCredential } from '../credential/resolved-credential';
import { assertNever } from '../errors';
import type { ProviderAuthDescriptor } from '../provider-port';
import type { HttpRequest, RequestSpec } from './http-request';

/**
 * Authentication Materialization (ADR: credential-delivery-strategies).
 *
 * Consumes an `AuthDescriptor` + a `ResolvedCredential`, REVEALS the secret (the single `.reveal()`
 * site in the whole runtime — the CI-grep control in credential-boundary-review.md keeps it here),
 * and produces a fully materialized, PLAIN `HttpRequest`. The HTTP transport that runs the request
 * knows nothing of `SecretString`, `ResolvedCredential`, or any auth scheme.
 *
 * The `switch (auth.type)` is exhaustive with an `assertNever` default: a new auth variant is a
 * COMPILE error until its materialization is implemented (the closed-vocabulary enforcement). The
 * descriptor's values are used VERBATIM — never interpolated or evaluated.
 */
export function materialize(
  auth: ProviderAuthDescriptor,
  resolved: ResolvedCredential,
  spec: RequestSpec,
): HttpRequest {
  const headers: Record<string, string> = { ...(spec.headers ?? {}) };
  let url = spec.url;
  let body = spec.body;
  const secret = resolved.secret.reveal(); // ← the ONLY reveal in the runtime

  switch (auth.type) {
    case 'bearer':
      headers.authorization = `Bearer ${secret}`;
      break;
    case 'api_key': {
      // A single resolved secret placed per the (first) declared field. Multiple distinct secrets
      // are not expressible with today's single-secret ResolvedCredential (that is the imperative /
      // multi-material future, ADR-gated).
      const field = auth.fields[0];
      if (field === undefined) {
        throw new Error('api_key auth descriptor declares no fields');
      }
      if (field.placement === 'header') {
        headers[field.key] = secret;
      } else if (field.placement === 'json_body') {
        body = setJsonBodyField(spec.body, field.key, secret);
      } else {
        url = appendQueryParam(url, field.key, secret);
      }
      break;
    }
    case 'oauth2':
    case 'credential_exchange':
      if (auth.tokenPlacement === 'bearer_header') {
        headers.authorization = `Bearer ${secret}`;
      } else {
        // oauth2 'custom_header' is modeled but has no declared header name — unused by any provider
        // today. Reaching here is a descriptor bug, surfaced loudly rather than sent unauthenticated.
        throw new Error(`Unsupported tokenPlacement: ${String(auth.tokenPlacement)}`);
      }
      break;
    default:
      return assertNever(auth);
  }

  return {
    method: spec.method,
    url,
    headers,
    ...(body !== undefined ? { body } : {}),
  };
}

/**
 * ADR 0018: the secret becomes a top-level property of the client's JSON object body. Anything else
 * is a client or descriptor bug and throws — never a request sent without its credential. A key the
 * client already filled throws too: overwriting it would hide the bug that put it there.
 */
function setJsonBodyField(body: RequestSpec['body'], key: string, secret: string): string {
  let parsed: unknown;
  try {
    parsed = typeof body === 'string' ? JSON.parse(body) : undefined;
  } catch {
    parsed = undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('json_body credential placement needs a JSON object body');
  }
  if (Object.prototype.hasOwnProperty.call(parsed, key)) {
    throw new Error(`request body already carries the credential field "${key}"`);
  }
  return JSON.stringify({ ...(parsed as Record<string, unknown>), [key]: secret });
}

function appendQueryParam(url: string, key: string, value: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}
