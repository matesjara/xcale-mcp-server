import { lookup as dnsLookup } from 'dns/promises';
import { BlockList, isIP } from 'net';

import { Agent, fetch as undiciFetch } from 'undici';

import type { FetchLike } from '../../core/http';

/**
 * SSRF-safe egress for WooCommerce.
 *
 * WooCommerce is the first provider whose base URL is the tenant's own `storeUrl` (self-hosted), so
 * the gateway must not fetch it blindly. On every request (and every redirect hop) this: requires
 * `https`, rejects internal IP literals (loopback / RFC1918 / CGNAT / link-local, and IPv6
 * equivalents), resolves the hostname, rejects if ANY resolved address is internal, and **pins those
 * checked addresses into the socket** so there is no second, unchecked DNS resolution between the
 * check and the connect. That pin is what closes DNS rebinding down to nothing.
 *
 * Because we follow redirects MANUALLY (to re-validate each hop for SSRF), the Fetch spec's own
 * cross-origin `Authorization`-stripping does NOT run — so we replicate it here: credential headers
 * are dropped the moment a redirect leaves the initial origin, or a store that 302s to an
 * attacker-controlled public host would receive the tenant's `consumer_key:consumer_secret`.
 *
 * Why undici and not global fetch: the pin is a dispatcher, and Node's global `fetch` silently
 * ignores an undici dispatcher — the pinned lookup would never run and the request would go out
 * unpinned. Same package for both halves, or the pin is decorative.
 *
 * Provider-self-contained on purpose: WooCommerce is the only user-supplied-host provider today, so
 * the guard lives in its folder (prove-don't-pre-abstract). A second such provider extracts it to a
 * shared home under an ADR.
 */

export class UnsafeHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeHostError';
  }
}

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

/** Narrow DNS seam, injectable in tests. */
export type LookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

/** The Node-style `lookup` a socket calls; answers with pre-validated addresses (no re-resolution). */
type PinnedLookup = (
  hostname: string,
  options: { all?: boolean } | undefined,
  callback: {
    (err: null, addresses: ResolvedAddress[]): void;
    (err: null, address: string, family: number): void;
  },
) => void;

const MAX_REDIRECTS = 3;
/**
 * Bound the DNS phase so a slow/hostile nameserver for a tenant's storeUrl can't hang the call.
 * Applied PER HOP — a full redirect chain can spend up to (MAX_REDIRECTS + 1) × this in DNS.
 */
const DNS_TIMEOUT_MS = 5000;
/** Credential-bearing headers stripped on a cross-origin redirect (Fetch-spec parity). */
const CREDENTIAL_HEADER = /^(authorization|cookie|proxy-authorization)$/i;

const blockList = new BlockList();

/** Internal IPv4 ranges — blocked natively AND via their IPv6 embeddings (see the loop below). */
const PRIVATE_V4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local / cloud metadata
  ['172.16.0.0', 12], // RFC1918
  ['192.168.0.0', 16], // RFC1918
];

for (const [net, prefix] of PRIVATE_V4) {
  blockList.addSubnet(net, prefix, 'ipv4');
  // Block the same range when it arrives embedded in an IPv6 address, in ANY textual form (dotted or
  // hex) — Node parses both to the same bytes, so one subnet per form covers all spellings:
  //   - IPv4-mapped `::ffff:<v4>/96+p`
  //   - NAT64 well-known prefix `64:ff9b::<v4>/96+p` (RFC 6052)
  blockList.addSubnet(`::ffff:${net}`, 96 + prefix, 'ipv6');
  blockList.addSubnet(`64:ff9b::${net}`, 96 + prefix, 'ipv6');
}

// IPv6-native ranges
blockList.addAddress('::', 'ipv6'); // unspecified
blockList.addAddress('::1', 'ipv6'); // loopback
blockList.addSubnet('fc00::', 7, 'ipv6'); // unique local
blockList.addSubnet('fe80::', 10, 'ipv6'); // link-local

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/** True for any address in a blocked range (fail-closed on an unparseable value). */
export function isBlockedIp(ip: string): boolean {
  let candidate = stripBrackets(ip).toLowerCase();
  // Fast path for dotted IPv4-mapped IPv6 (::ffff:a.b.c.d) — re-check as IPv4. Belt-and-suspenders:
  // internal ranges embedded in IPv6 (IPv4-mapped `::ffff:` AND NAT64 `64:ff9b::`, dotted OR hex) are
  // also covered by the blockList subnets above, which Node matches on canonical bytes across every
  // textual spelling.
  if (candidate.startsWith('::ffff:') && candidate.includes('.')) {
    candidate = candidate.slice('::ffff:'.length);
  }
  const family = isIP(candidate);
  if (family === 0) return true; // not a parseable IP — fail closed
  return blockList.check(candidate, family === 6 ? 'ipv6' : 'ipv4');
}

function urlOf(input: Parameters<FetchLike>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

/**
 * Normalize the request headers into a mutable plain record so we can strip keys per hop. The only
 * production caller (`core/http.ts` `sendRequest`) passes a plain object; an array of pairs is also
 * handled. A `Headers` instance is duck-typed via `forEach` to avoid depending on the DOM lib.
 */
function normalizeHeaders(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h || typeof h !== 'object') return out;
  if (typeof (h as { forEach?: unknown }).forEach === 'function' && !Array.isArray(h)) {
    (h as { forEach: (cb: (v: string, k: string) => void) => void }).forEach((v, k) => {
      out[k] = String(v);
    });
  } else if (Array.isArray(h)) {
    for (const [k, v] of h as Array<[string, string]>) out[k] = String(v);
  } else {
    for (const [k, v] of Object.entries(h as Record<string, unknown>)) out[k] = String(v);
  }
  return out;
}

function stripCredentialHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (!CREDENTIAL_HEADER.test(k)) out[k] = v;
  }
  return out;
}

/** Parse + synchronous checks: valid URL, https only, no internal IP literal. Returns the URL. */
function parseAndAssert(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeHostError(`Invalid store URL: "${rawUrl}"`);
  }
  if (url.protocol !== 'https:') {
    throw new UnsafeHostError(`Blocked non-https store URL scheme "${url.protocol}"`);
  }
  const host = stripBrackets(url.hostname).toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new UnsafeHostError(`Blocked loopback host "${host}"`);
  }
  if (isIP(host) !== 0 && isBlockedIp(host)) {
    throw new UnsafeHostError(`Blocked internal IP literal "${host}"`);
  }
  return url;
}

/** Race the DNS lookup against a timeout so a stalled resolver fails fast instead of hanging. */
async function lookupWithTimeout(host: string, lookupImpl: LookupFn): Promise<ResolvedAddress[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lookupPromise = lookupImpl(host);
  // If the timeout wins the race, the lookup promise may still reject later with nothing awaiting it.
  // An unhandled rejection would crash the process (Node ≥15 default), so swallow a late loss here —
  // a hostile/slow resolver must not be able to take the whole gateway down.
  lookupPromise.catch(() => {});
  try {
    return await Promise.race([
      lookupPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new UnsafeHostError(`DNS resolution timed out for "${host}"`)),
          DNS_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the host and reject if any address is internal; returns the checked addresses to pin.
 * `null` for an IP literal — nothing to re-resolve, so no pin needed.
 */
async function resolveAndCheck(url: URL, lookupImpl: LookupFn): Promise<ResolvedAddress[] | null> {
  const host = stripBrackets(url.hostname);
  if (isIP(host) !== 0) return null;
  let addresses: ResolvedAddress[];
  try {
    addresses = await lookupWithTimeout(host, lookupImpl);
  } catch (error) {
    if (error instanceof UnsafeHostError) throw error;
    throw new UnsafeHostError(`DNS resolution failed for "${host}"`);
  }
  if (addresses.length === 0) {
    throw new UnsafeHostError(`Host "${host}" did not resolve to any address`);
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new UnsafeHostError(`Host "${host}" resolves to blocked address ${address}`);
    }
  }
  return addresses;
}

/**
 * A `lookup` that ignores DNS and answers with the addresses we already validated — closing the
 * rebinding window between the check and the connect. The hostname stays in the URL (TLS SNI + Host),
 * only name resolution is overridden.
 */
function createPinnedLookup(addresses: ResolvedAddress[]): PinnedLookup {
  return (_hostname, options, callback) => {
    if (options?.all) {
      callback(null, addresses);
      return;
    }
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  };
}

/**
 * A `fetch` that SSRF-validates and pins the target host before delegating, re-validating every
 * redirect hop and stripping credential headers on any cross-origin hop. Drop-in for the provider's
 * `fetchImpl`. `lookupImpl`/`fetchImpl` are test seams; when `fetchImpl` is injected the socket pin is
 * skipped (no real socket), but every host check, redirect re-validation and header strip still runs.
 */
export function createSafeFetch(
  opts: { lookupImpl?: LookupFn; fetchImpl?: FetchLike } = {},
): FetchLike {
  const doLookup: LookupFn = opts.lookupImpl ?? ((host) => dnsLookup(host, { all: true }));
  const injectedFetch = opts.fetchImpl;

  return (async (input, init) => {
    const originalUrl = urlOf(input);
    let currentUrl = originalUrl;
    let headers = normalizeHeaders(init?.headers);
    const method = init?.method;
    const body = init?.body;
    let initialOrigin: string | undefined;

    for (let hop = 0; ; hop++) {
      const url = parseAndAssert(currentUrl);
      if (hop === 0) {
        initialOrigin = url.origin;
      } else if (url.origin !== initialOrigin) {
        // Once we leave the initial origin, credentials never travel again (conservative even if a
        // later hop bounces back) — this is the cross-origin Authorization strip a manual follow owes.
        headers = stripCredentialHeaders(headers);
      }
      const pinned = await resolveAndCheck(url, doLookup);
      const hopInit = { ...init, method, body, headers, redirect: 'manual' as const };

      let response: Response;
      if (injectedFetch) {
        response = await injectedFetch(url.toString(), hopInit);
      } else {
        const agent = pinned
          ? new Agent({ connect: { lookup: createPinnedLookup(pinned) } })
          : undefined;
        try {
          response = (await undiciFetch(url.toString(), {
            ...(hopInit as Parameters<typeof undiciFetch>[1]),
            dispatcher: agent,
          })) as unknown as Response;
        } finally {
          // The agent owns a connection pool; each hop makes its own, so close it or leak sockets.
          void agent?.close().catch(() => {});
        }
      }

      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get('location');
      if (!location) return response; // 3xx without Location — nothing to follow
      void response.body?.cancel().catch(() => {});
      if (hop >= MAX_REDIRECTS) {
        throw new UnsafeHostError(`Too many redirects fetching "${originalUrl}"`);
      }
      // A redirect on a WRITE is never safe to auto-follow. Replaying the body (307/308) could
      // double-apply a non-idempotent write like create_order — a second order carrying the SAME
      // `_xcale_order_ref`, invisible to reconcile_order (it would report found:true for one and
      // mask the duplicate). And silently downgrading the write to a bodyless GET (the Fetch spec's
      // 301/302/303 behavior) would return ok() for a write that never happened. WooCommerce REST
      // does not legitimately redirect a write, so fail closed and let the caller reconcile/retry
      // deliberately. Reads (GET/HEAD, no body) follow redirects normally, re-validated per hop.
      const m = (method ?? 'GET').toUpperCase();
      if (m !== 'GET' && m !== 'HEAD') {
        throw new UnsafeHostError(
          `Refusing to follow a ${response.status} redirect for a ${m} request to "${originalUrl}" — a redirected write cannot be replayed safely`,
        );
      }
      currentUrl = new URL(location, url).toString();
    }
  }) as FetchLike;
}
