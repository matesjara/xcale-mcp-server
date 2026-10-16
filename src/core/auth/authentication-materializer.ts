import type { ResolvedCredential } from '../credential/resolved-credential';
import type { SecretString } from '../secret-string';
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
  /**
   * The called tool's `credentialGroup` (multi-credential providers). When set, the secret comes from
   * `resolved.secrets[group]` and — for `api_key` — the field comes from `auth.groups[group]`. Absent ⇒
   * single-secret (the sole `resolved.secret` + `fields[0]`), byte-identical to before.
   */
  group?: string,
): HttpRequest {
  const headers: Record<string, string> = { ...(spec.headers ?? {}) };
  let url = spec.url;
  let body = spec.body;
  const secret = secretFor(resolved, group).reveal(); // ← the ONLY reveal in the runtime

  switch (auth.type) {
    case 'bearer':
      headers.authorization = `Bearer ${secret}`;
      break;
    case 'api_key': {
      // Single-secret: the one declared field. Multi-credential: the field of the called tool's group.
      const field =
        group !== undefined && auth.groups
          ? auth.groups.find((g) => g.key === group)?.field
          : auth.fields[0];
      if (field === undefined) {
        throw new Error('api_key auth descriptor declares no fields');
      }
      if (field.placement === 'header') {
        headers[field.key] = secret;
      } else if (field.placement === 'query') {
        url = appendQueryParam(url, field.key, secret);
      } else {
        // 'body' (ADR: body-placement-for-api-key): inject the secret as a field of the JSON body.
        body = injectBodyParam(body, field.key, secret);
      }
      break;
    }
    case 'basic':
      // A single composed `key:secret` (joined by the consumer, e.g. WooCommerce ck:cs) →
      // HTTP Basic. Stays single-secret; the server only encodes. ADR 0018.
      headers.authorization = `Basic ${Buffer.from(secret).toString('base64')}`;
      break;
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
 * The secret to reveal for this call: a multi-credential provider's call carries a `group`, so the
 * secret comes from the named bundle (`resolved.secrets[group]`) — fail closed if the bundle has none.
 * Without a group it is the provider's single `resolved.secret`. Keeps the single `.reveal()` site in
 * `materialize` (this returns the SecretString; it never reveals).
 */
function secretFor(resolved: ResolvedCredential, group?: string): SecretString {
  if (group !== undefined) {
    const s = resolved.secrets?.[group];
    if (s === undefined) {
      throw new Error(`no resolved secret for credential group "${group}"`);
    }
    return s;
  }
  return resolved.secret;
}

function appendQueryParam(url: string, key: string, value: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

/**
 * Inject the credential as a field of the JSON request body (ADR: body-placement-for-api-key). Requires
 * a JSON object string body; a URLSearchParams or absent body with placement:'body' is a descriptor bug,
 * surfaced loudly rather than sent unauthenticated. The value is placed verbatim, never interpolated.
 */
function injectBodyParam(
  body: string | URLSearchParams | undefined,
  key: string,
  value: string,
): string {
  if (typeof body !== 'string') {
    throw new Error("api_key placement 'body' requires a JSON string request body");
  }
  const parsed: unknown = JSON.parse(body);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error("api_key placement 'body' requires a JSON object body");
  }
  return JSON.stringify({ ...(parsed as Record<string, unknown>), [key]: value });
}
