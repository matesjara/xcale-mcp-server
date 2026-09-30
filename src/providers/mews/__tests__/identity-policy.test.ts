import { describe, expect, it } from 'vitest';

import { mewsManifest } from '../manifest';
import { mewsProvider } from '../provider';

/**
 * Whose data each Mews tool can reach (ADR 0019): the same declaration Cloudbeds publishes, so a
 * consumer can tell a guest lookup from a room-type read without knowing either provider.
 */
describe('mews publishes whose data each tool can reach', () => {
  const published = mewsProvider.listTools();
  const byName = new Map(published.map((t) => [t.name, t]));

  it('marks the customer search as bound to the person it names', () => {
    expect(byName.get('mcp_mews_search_customers')?.identityPolicy).toEqual({
      mode: 'subject-bound',
      identityFields: ['emails', 'customerIds'],
    });
  });

  it('every declared identity field exists in the tool it belongs to', () => {
    for (const tool of published) {
      if (tool.identityPolicy?.mode !== 'subject-bound') continue;
      const properties = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      );
      for (const field of tool.identityPolicy.identityFields) {
        expect(properties, `${tool.name}: ${field} is not in its input schema`).toContain(field);
      }
    }
  });

  it('marks the reads that return other people without being asked about anyone', () => {
    for (const name of [
      'mcp_mews_list_reservations',
      'mcp_mews_list_order_items',
      'mcp_mews_list_reservation_notes',
    ]) {
      expect(byName.get(name)?.identityPolicy, name).toEqual({ mode: 'subject-scoped' });
    }
  });

  it('leaves tools that touch nobody alone', () => {
    for (const name of [
      'mcp_mews_list_resource_categories',
      'mcp_mews_list_rates',
      'mcp_mews_get_availability',
      'mcp_mews_list_products',
    ]) {
      expect(byName.get(name)?.identityPolicy, name).toBeUndefined();
    }
  });

  it('declares the version bump that a changed tools/list requires', () => {
    expect(mewsManifest.schemaVersion).toBe('2026-09-30');
    expect(mewsManifest.providerVersion).toBe('0.3.0');
  });
});
