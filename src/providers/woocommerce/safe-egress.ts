import { lookup as dnsLookup } from 'dns/promises';
import { BlockList, isIP } from 'net';

import type { FetchLike } from '../../core/http';

/**
 * SSRF-safe egress for WooCommerce.
 *
 * WooCommerce is the first provider whose base URL is the tenant's own `storeUrl` (self-hosted), so
 * the gateway must not fetch it blindly. Before every request this: requires `https`, rejects
 * internal IP literals (loopback / RFC1918 / CGNAT / link-local, and IPv6 equivalents), resolves the
 * hostname and rejects if ANY resolved address is internal. The backend also validates at connect,
 * but its check is IP-literal-only — a hostname that resolves to a private address (cloud metadata at
 * `169.254.169.254`, an internal service on `10.x`) would otherwise reach the network from here.
 *
 * Re-checking on every call closes slow DNS rebinding too. The only residual is the sub-second
 * TOCTOU between this resolution and the socket connect, which needs a pinned dispatcher (undici) —
 * a documented fast-follow, deliberately not pulled in for this read-only v1.
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

async function assertPublicUrl(rawUrl: string, lookupImpl: LookupFn): Promise<void> {
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
  if (isIP(host) !== 0) {
    if (isBlockedIp(host)) {
      throw new UnsafeHostError(`Blocked internal IP literal "${host}"`);
    }
    return; // public IP literal — nothing to resolve
  }
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
}

/**
 * A `fetch` that SSRF-validates the target host before delegating. Drop-in for the provider's
 * `fetchImpl`. `lookupImpl`/`fetchImpl` are test seams; production uses DNS + global fetch.
 */
export function createSafeFetch(
  opts: { lookupImpl?: LookupFn; fetchImpl?: FetchLike } = {},
): FetchLike {
  const doLookup: LookupFn = opts.lookupImpl ?? ((host) => dnsLookup(host, { all: true }));
  const inner: FetchLike = opts.fetchImpl ?? globalThis.fetch;
  return (async (input, init) => {
    await assertPublicUrl(urlOf(input), doLookup);
    return inner(input, init);
  }) as FetchLike;
}
