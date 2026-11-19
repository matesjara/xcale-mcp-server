import type { FetchLike } from '../http';
import type { ProviderRegistry } from '../registry';

/**
 * The mint relay (ADR: credential-exchange-response-path-and-token-ttl). A provider that binds its
 * token to the IP that logged in declares `relayMint` on its `credential_exchange` descriptor; the
 * consumer then sends its login here and this server makes the request from its dedicated egress IPs.
 *
 * Boundaries, all deliberate:
 * - the target is ALWAYS the provider's own declared `tokenEndpoint`, never anything the caller sends;
 * - the request and the response are not logged, not stored, not inspected — they transit once;
 * - whatever status the provider answers is relayed as data; only "could not reach it" is an error.
 */
export type RelayResult =
  | { readonly code: 200; readonly body: { status: number; body: unknown } }
  | { readonly code: 400; readonly body: { error: 'invalid_request' } }
  | { readonly code: 404; readonly body: { error: 'relay_not_allowed' } }
  | { readonly code: 502; readonly body: { error: 'provider_unreachable' } };

const RELAY_TIMEOUT_MS = 15_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface MintRelayDeps {
  readonly registry: ProviderRegistry;
  readonly fetchImpl?: FetchLike;
  /** Receives the provider slug and the status only — never a body. */
  readonly onRelayed?: (info: { provider: string; status: number | 'unreachable' }) => void;
}

export function createMintRelay(deps: MintRelayDeps): (payload: unknown) => Promise<RelayResult> {
  return async (payload) => {
    const input = isPlainObject(payload) ? payload : {};
    const slug = input.provider;
    const body = input.body;
    if (typeof slug !== 'string' || slug.length === 0 || !isPlainObject(body)) {
      return { code: 400, body: { error: 'invalid_request' } };
    }

    const auth = deps.registry.getProvider(slug)?.auth;
    if (auth?.type !== 'credential_exchange' || auth.relayMint !== true) {
      return { code: 404, body: { error: 'relay_not_allowed' } };
    }

    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);
    try {
      const response = await fetchImpl(auth.tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        // Never follow a redirect: the body carries the durable credential.
        redirect: 'error',
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      deps.onRelayed?.({ provider: slug, status: response.status });
      return { code: 200, body: { status: response.status, body: parsed } };
    } catch {
      // The error text can carry the request body or URL; say only that the provider was unreachable.
      deps.onRelayed?.({ provider: slug, status: 'unreachable' });
      return { code: 502, body: { error: 'provider_unreachable' } };
    } finally {
      clearTimeout(timer);
    }
  };
}
