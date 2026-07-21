import { ProviderErrorCode } from './errors';
import type { SecretString } from './secret-string';

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

export interface RequestOptions {
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  readonly body?: string | URLSearchParams;
  /** Applied as `Authorization: Bearer <token>` at this single egress point; NEVER logged. */
  readonly token?: SecretString;
  readonly timeoutMs?: number;
  /** Injectable for deterministic tests (default: global fetch). */
  readonly fetchImpl?: FetchLike;
}

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
 * Minimal JSON request helper: timeout, token applied at egress (never logged), non-2xx mapped to a
 * typed error result. NOT a generic HTTP framework — provider-specific request shaping stays in the
 * provider's client (red line in the ADR).
 */
export async function requestJson(url: string, opts: RequestOptions = {}): Promise<RequestResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  if (opts.token !== undefined) {
    headers.authorization = `Bearer ${opts.token.reveal()}`;
  }

  try {
    const res = await fetchImpl(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await safeText(res);
      return {
        ok: false,
        status: res.status,
        errorCode: mapHttpStatusToErrorCode(res.status),
        body: body.slice(0, MAX_ERROR_BODY),
      };
    }
    const data = (await res.json()) as unknown;
    return { ok: true, status: res.status, data };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      errorCode: ProviderErrorCode.PROVIDER_UNAVAILABLE,
      body: e instanceof Error ? e.message : 'request failed',
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
