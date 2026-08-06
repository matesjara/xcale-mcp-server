import { describe, expect, it } from 'vitest';

import type { IProvider } from '../provider-port';
import { createRegistry } from '../registry';
import { toolSuccess } from '../types';

/**
 * @param toolNames tools the provider publishes AND can run
 * @param hiddenToolNames tools it can run but does NOT publish (control-plane)
 */
function fakeProvider(
  slug: string,
  toolNames: readonly string[],
  hiddenToolNames: readonly string[] = [],
): IProvider {
  return {
    routableToolNames: () => [...toolNames, ...hiddenToolNames],
    manifest: {
      slug,
      displayName: slug,
      category: 'test',
      schemaVersion: '1',
      providerVersion: '0.1.0',
    },
    auth: { type: 'api_key', fields: [{ key: 'k', label: 'K', placement: 'header' }] },
    listTools: () =>
      toolNames.map((name) => ({ name, description: name, inputSchema: { type: 'object' } })),
    callTool: async (toolName) => toolSuccess({ toolName, providerSlug: slug, data: null }),
  };
}

describe('createRegistry', () => {
  it('routes a tool the provider does NOT publish — the menu and the router are different questions', () => {
    // The regression this pins, found by running it and not by any unit test: the registry indexed
    // `listTools()`, so withdrawing a control-plane tool from the agent's menu also withdrew it from
    // DISPATCH. Every call answered `UNKNOWN_TOOL`, and the provider-level test missed it because it
    // called `provider.callTool` directly — under the layer that was broken.
    const reg = createRegistry([fakeProvider('a', ['mcp_a_x'], ['mcp_a_control'])]);

    expect(reg.getProviderByTool('mcp_a_control')?.manifest.slug).toBe('a');
    expect(reg.hasTool('mcp_a_control')).toBe(true);
    // …and it is still absent from the published surface.
    expect(reg.providers[0]!.listTools().map((t) => t.name)).not.toContain('mcp_a_control');
  });

  it('rejects a duplicate name even when neither provider publishes it', () => {
    // Two providers sharing a hidden name would make dispatch ambiguous exactly like a published
    // clash — the guard has to see the whole routable set, not the menu.
    expect(() =>
      createRegistry([fakeProvider('a', [], ['dup']), fakeProvider('b', [], ['dup'])]),
    ).toThrow(/Duplicate tool name/);
  });

  it('indexes providers by slug and by tool name', () => {
    const reg = createRegistry([fakeProvider('a', ['mcp_a_x']), fakeProvider('b', ['mcp_b_y'])]);
    expect(reg.getProvider('a')?.manifest.slug).toBe('a');
    expect(reg.getProviderByTool('mcp_b_y')?.manifest.slug).toBe('b');
    expect(reg.hasTool('mcp_a_x')).toBe(true);
    expect(reg.hasTool('missing')).toBe(false);
    expect(reg.getProvider('missing')).toBeUndefined();
  });

  it('rejects duplicate provider slugs', () => {
    expect(() =>
      createRegistry([fakeProvider('a', ['mcp_a_x']), fakeProvider('a', ['mcp_a_z'])]),
    ).toThrow(/Duplicate provider slug/);
  });

  it('rejects duplicate tool names across providers', () => {
    expect(() => createRegistry([fakeProvider('a', ['dup']), fakeProvider('b', ['dup'])])).toThrow(
      /Duplicate tool name/,
    );
  });
});
