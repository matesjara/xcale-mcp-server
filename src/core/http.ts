import type { HttpRequest } from './auth/http-request';
import { ProviderErrorCode } from './errors';

/**
 * Universal HTTP-status → ProviderErrorCode policy (the typed-error contract). Centralized so it is
 * IDENTICAL for every provider — "share policies, not assumptions" (ADR: canonical-provider-pattern).
 */
export function mapHttpStatusToErrorCode(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return ProviderErrorCode.AUTH_EXPIRED;
  if (status === 429) return ProviderErrorCode.RATE_LIMITED;
  if (status >= 500) return ProviderErrorCode.PROVIDER_UNAVAILABLE;
  if (status === 400 || status === 422) return ProviderErrorCode.INVALID_INPUT;
  return ProviderErrorCode.PROVIDER_ERROR;
}

export type FetchLike = typeof globalThis.fetch;

export type RequestResult =
  | { readonly ok: true; readonly status: number; readonly data: unknown }
  | {
      readonly ok: false;
      readonly status: number;
      readonly errorCode: ProviderErrorCode;
      readonly body: string;
    };

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ERROR_BODY = 500;

/**
 * Mask every query-parameter VALUE in a piece of text.
 *
 * Some providers place their credential in the query string rather than a header (Toteat sends
 * `xapitoken` that way; the `api_key` descriptor has always allowed `placement: 'query'`). For those,
 * **the URL is a credential**, and `fetch` failures routinely carry the request URL in their message
 * — a `TypeError: fetch failed` or an abort whose text includes the full target. That message
 * becomes the tool's error text, which reaches the consumer, the agent's prompt and the end user's
 * chat.
 *
 * `credential-boundary-review.md` reasons about a credential in a *header* and lists the surfaces it
 * can escape through; this closes the one that document did not anticipate. Generic on purpose — it
 * masks every value, so no provider has to remember to opt in, and a future query-credential
 * provider inherits the protection instead of re-discovering the leak.
 *
 * Parameter NAMES are kept: `?xir=[REDACTED]&xapitoken=[REDACTED]` still says which call failed.
 */
export function redactQueryValues(text: string): string {
  return text.replace(/([?&])([^=&\s]+)=([^&\s]*)/g, (_m, sep: string, key: string) => {
    return `${sep}${key}=[REDACTED]`;
  });
}

export interface TransportOptions {
  readonly timeoutMs?: number;
  /** Injectable for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
}

/**
 * Auth-blind HTTP transport: send a fully materialized `HttpRequest` (headers already built by the
 * AuthenticationMaterializer — no credential here) with a timeout, map non-2xx to a typed error
 * result. Knows nothing of `SecretString` or any auth scheme. NOT a generic framework —
 * provider-specific request shaping stays in the provider's client (red line in the ADR).
 */
export async function sendRequest(
  req: HttpRequest,
  opts: TransportOptions = {},
): Promise<RequestResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const headers: Record<string, string> = { accept: 'application/json', ...req.headers };

  try {
    const res = await fetchImpl(req.url, {
      method: req.method,
      headers,
      body: req.body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await safeText(res);
      return {
        ok: false,
        status: res.status,
        errorCode: mapHttpStatusToErrorCode(res.status),
        // The provider's own error body, redacted: a provider that echoes request context back
        // (Toteat's order responses echo the caller IP and payload state) would otherwise hand the
        // credential straight out through the error path.
        body: redactQueryValues(body.slice(0, MAX_ERROR_BODY)),
      };
    }
    const data = (await res.json()) as unknown;
    return { ok: true, status: res.status, data };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      errorCode: ProviderErrorCode.PROVIDER_UNAVAILABLE,
      // Undici puts the request URL in fetch-failure messages. For a query-credential provider that
      // URL IS the credential, so this text is redacted before it can reach a tool result.
      body: redactQueryValues(e instanceof Error ? e.message : 'request failed'),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
