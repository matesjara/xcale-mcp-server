import { describe, expect, it, vi } from 'vitest';

import { SecretString } from '../../../core/secret-string';
import { createCloudbedsProvider } from '../provider';

/**
 * Occupancy filtering on `get_availability`.
 *
 * The tool used to take dates only, so "a room for four" came back as every room type and the
 * consumer compared each `maxGuests` itself. That works for a six-room hotel and stops working for
 * a large one, where the agent receives forty rows to sift and the guest waits.
 *
 * The shape of the filter was MEASURED against a live property (20064, 2026-08-20) rather than read
 * off the spec, because the failure mode of guessing here is silent — a parameter Cloudbeds ignores
 * looks exactly like a filter that found everything:
 *
 *   adults=2            → 6 of 6 types      adults=4 → 1 (maxGuests 5)      adults=6 → 0
 *   adults=2&children=1 → 2 types
 *
 * These tests assert the wire, which is the half we control: the values reach Cloudbeds, and an
 * absent value is absent rather than sent as `undefined`.
 */
describe('get_availability — occupancy is filtered by Cloudbeds, not by the caller', () => {
  const ctx = {
    credential: { secret: new SecretString('cbat_test0000000000000000000000000') },
    metadata: { propertyID: '20064' },
    request: {},
  } as never;

  function providerCapturing(): {
    urls: string[];
    provider: ReturnType<typeof createCloudbedsProvider>;
  } {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
    });
    return { urls, provider: createCloudbedsProvider({ fetchImpl: fetchImpl as never }) };
  }

  it('sends the party size when the guest gave one', async () => {
    const { urls, provider } = providerCapturing();

    await provider.callTool(
      'mcp_cloudbeds_get_availability',
      { startDate: '2026-08-22', endDate: '2026-08-24', adults: 2, children: 1 },
      ctx,
    );

    expect(urls[0]).toContain('adults=2');
    expect(urls[0]).toContain('children=1');
  });

  it('omits them entirely when the guest did not — never sends an empty filter', async () => {
    // A `children=undefined` on the wire is not "no filter"; it is a value Cloudbeds has to
    // interpret, and the safest reading of an unasked question is not to ask it.
    const { urls, provider } = providerCapturing();

    await provider.callTool(
      'mcp_cloudbeds_get_availability',
      { startDate: '2026-08-22', endDate: '2026-08-24' },
      ctx,
    );

    expect(urls[0]).not.toContain('adults');
    expect(urls[0]).not.toContain('children');
  });

  it('rejects a party that cannot exist rather than passing it through', async () => {
    const { provider } = providerCapturing();

    const res = (await provider.callTool(
      'mcp_cloudbeds_get_availability',
      { startDate: '2026-08-22', endDate: '2026-08-24', adults: 0 },
      ctx,
    )) as { kind: string };

    expect(res.kind).toBe('error');
  });
});
