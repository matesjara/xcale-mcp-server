import { describe, expect, it } from 'vitest';

import { cloudbedsProvider } from '../index';
import { cloudbedsManifest } from '../manifest';

/**
 * A consumer cannot tell a guest lookup from a room-type read. It receives a name, a description
 * and a JSON Schema, and nothing in those says that `guestPhone` identifies a person, or that
 * `search_guests` with every filter omitted returns the property's whole guest list.
 *
 * So the provider says it, and `tools/list` carries it. These pin the wire shape, because the
 * consumer's enforcement is only as true as what arrives.
 */
describe('cloudbeds publishes whose data each tool can reach', () => {
  const published = cloudbedsProvider.listTools();
  const byName = new Map(published.map((t) => [t.name, t]));

  it('marks the guest search as bound to a named person', () => {
    const tool = byName.get('mcp_cloudbeds_search_guests');

    expect(tool?.identityPolicy).toEqual({
      mode: 'subject-bound',
      identityFields: ['guestPhone', 'guestEmail', 'guestFirstName', 'guestLastName'],
    });
  });

  it('names every optional filter that identifies somebody, not just the phone', () => {
    const tool = byName.get('mcp_cloudbeds_search_guests');
    const policy = tool?.identityPolicy;
    if (policy?.mode !== 'subject-bound') throw new Error('expected subject-bound');

    // Every one of these is a way to ask about a specific person. A policy that named only the
    // phone would leave the other three unguarded while looking complete — the worst outcome,
    // because it stops anyone checking again.
    const declared = new Set(policy.identityFields);
    for (const field of ['guestFirstName', 'guestLastName', 'guestEmail', 'guestPhone']) {
      expect(declared.has(field), `${field} must be declared`).toBe(true);
    }
  });

  it('every declared identity field exists in the tool it belongs to', () => {
    // A field name that does not match the schema declares protection over nothing, and rots the
    // day an argument is renamed — the failure mode this whole mechanism exists to avoid.
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
    expect(byName.get('mcp_cloudbeds_list_reservations')?.identityPolicy).toEqual({
      mode: 'subject-scoped',
    });
    expect(byName.get('mcp_cloudbeds_list_users')?.identityPolicy).toEqual({
      mode: 'subject-scoped',
    });
  });

  it('leaves tools that touch nobody alone', () => {
    // Absent is the default and must stay cheap: a room-type read carries no policy at all, so the
    // consumer short-circuits before reading anything.
    expect(byName.get('mcp_cloudbeds_list_room_types')?.identityPolicy).toBeUndefined();
    expect(byName.get('mcp_cloudbeds_get_rate_plans')?.identityPolicy).toBeUndefined();
  });

  it('declares the version bump that a changed tools/list requires', () => {
    // The repo's own rule, and the nearest precedent is a FIX commit for exactly this omission.
    expect(cloudbedsManifest.schemaVersion).toBe('2026-09-15');
    expect(cloudbedsManifest.providerVersion).toBe('0.8.0');
  });
});
