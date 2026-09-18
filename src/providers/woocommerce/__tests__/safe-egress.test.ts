import { describe, expect, it, vi } from 'vitest';

import { createSafeFetch, UnsafeHostError } from '../safe-egress';

/**
 * SSRF-safe egress for WooCommerce (ADR `mcp-credential-url-context-ssrf-validation`, backend side).
 * WooCommerce is the first provider whose base URL is the tenant's own `storeUrl`, so the MCP must
 * not fetch it blindly: every call re-resolves the host and blocks private/link-local targets. The
 * backend's connect-time check is IP-literal-only; this closes the domain-based case at call time.
 */

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const okResponse = () => new Response('{}', { status: 200 });

describe('createSafeFetch', () => {
  it('rejects a non-https URL before touching the network', async () => {
    const inner = vi.fn(async () => okResponse());
    const fetch = createSafeFetch({ lookupImpl: publicLookup, fetchImpl: inner });
    await expect(fetch('http://store.example.com/wp-json')).rejects.toBeInstanceOf(UnsafeHostError);
    expect(inner).not.toHaveBeenCalled();
  });

  it('rejects a loopback hostname', async () => {
    const inner = vi.fn(async () => okResponse());
    const fetch = createSafeFetch({ lookupImpl: publicLookup, fetchImpl: inner });
    await expect(fetch('https://localhost/wp-json')).rejects.toBeInstanceOf(UnsafeHostError);
    expect(inner).not.toHaveBeenCalled();
  });

  it.each([
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://169.254.169.254/x',
    'https://192.168.1.1/x',
  ])('rejects the private/link-local IP literal %s without a DNS lookup', async (url) => {
    const lookup = vi.fn(publicLookup);
    const inner = vi.fn(async () => okResponse());
    const fetch = createSafeFetch({ lookupImpl: lookup, fetchImpl: inner });
    await expect(fetch(url)).rejects.toBeInstanceOf(UnsafeHostError);
    expect(lookup).not.toHaveBeenCalled(); // an IP literal needs no resolution
    expect(inner).not.toHaveBeenCalled();
  });

  it('rejects a public hostname that RESOLVES to a private address (domain-based SSRF)', async () => {
    const evilLookup = async () => [{ address: '169.254.169.254', family: 4 }];
    const inner = vi.fn(async () => okResponse());
    const fetch = createSafeFetch({ lookupImpl: evilLookup, fetchImpl: inner });
    await expect(fetch('https://evil-store.example/wp-json')).rejects.toBeInstanceOf(
      UnsafeHostError,
    );
    expect(inner).not.toHaveBeenCalled();
  });

  it('allows a public hostname and delegates to the inner fetch', async () => {
    const inner = vi.fn(async () => okResponse());
    const fetch = createSafeFetch({ lookupImpl: publicLookup, fetchImpl: inner });
    const res = await fetch('https://store.example.com/wp-json/wc/v3/products', {
      method: 'GET',
    });
    expect(res.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('rejects when the host resolves to no address', async () => {
    const emptyLookup = async () => [] as { address: string; family: number }[];
    const inner = vi.fn(async () => okResponse());
    const fetch = createSafeFetch({ lookupImpl: emptyLookup, fetchImpl: inner });
    await expect(fetch('https://nowhere.example/x')).rejects.toBeInstanceOf(UnsafeHostError);
    expect(inner).not.toHaveBeenCalled();
  });
});
