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

const blockList = new BlockList();
// IPv4
blockList.addSubnet('0.0.0.0', 8, 'ipv4'); // "this network"
blockList.addSubnet('10.0.0.0', 8, 'ipv4'); // RFC1918
blockList.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT
blockList.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
blockList.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local / cloud metadata
blockList.addSubnet('172.16.0.0', 12, 'ipv4'); // RFC1918
blockList.addSubnet('192.168.0.0', 16, 'ipv4'); // RFC1918
// IPv6
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
  // Unwrap dotted IPv4-mapped IPv6 (::ffff:a.b.c.d) and re-check as IPv4.
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

/**
 * Resolve the host and reject if any address is internal; returns the checked addresses to pin.
 * `null` for an IP literal — nothing to re-resolve, so no pin needed.
 */
async function resolveAndCheck(url: URL, lookupImpl: LookupFn): Promise<ResolvedAddress[] | null> {
  const host = stripBrackets(url.hostname);
  if (isIP(host) !== 0) return null;
  let addresses: ResolvedAddress[];
  try {
    addresses = await lookupImpl(host);
  } catch {
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
 * redirect hop. Drop-in for the provider's `fetchImpl`. `lookupImpl`/`fetchImpl` are test seams; when
 * `fetchImpl` is injected the socket pin is skipped (there is no real socket), but every host check
 * and redirect re-validation still runs.
 */
export function createSafeFetch(
  opts: { lookupImpl?: LookupFn; fetchImpl?: FetchLike } = {},
): FetchLike {
  const doLookup: LookupFn = opts.lookupImpl ?? ((host) => dnsLookup(host, { all: true }));
  const injectedFetch = opts.fetchImpl;

  return (async (input, init) => {
    let currentUrl = urlOf(input);
    for (let hop = 0; ; hop++) {
      const url = parseAndAssert(currentUrl);
      const pinned = await resolveAndCheck(url, doLookup);

      let response: Response;
      if (injectedFetch) {
        response = await injectedFetch(url.toString(), { ...init, redirect: 'manual' });
      } else {
        const agent = pinned
          ? new Agent({ connect: { lookup: createPinnedLookup(pinned) } })
          : undefined;
        try {
          response = (await undiciFetch(url.toString(), {
            ...(init as Parameters<typeof undiciFetch>[1]),
            redirect: 'manual',
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
        throw new UnsafeHostError(`Too many redirects fetching "${urlOf(input)}"`);
      }
      currentUrl = new URL(location, url).toString();
    }
  }) as FetchLike;
}
