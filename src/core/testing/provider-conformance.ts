import { expect } from 'vitest';

import { assertNever, ProviderErrorCode } from '../errors';
import type { IProvider } from '../provider-port';
import { SecretString } from '../secret-string';

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * The generic contract every provider must satisfy — the machine-checkable form of the
 * Provider Self-Containment success criterion. A provider's own test calls this, then adds its
 * behavior-specific assertions. No manual exceptions: if a provider can't pass this, the
 * architecture (not the test) is what to revisit.
 */
export async function runProviderConformance(provider: IProvider): Promise<void> {
  const m = provider.manifest;
  expect(m.slug, 'manifest.slug must be kebab-case').toMatch(SLUG_RE);
  expect(m.displayName.length, 'manifest.displayName').toBeGreaterThan(0);
  expect(m.category.length, 'manifest.category').toBeGreaterThan(0);
  expect(m.schemaVersion.length, 'manifest.schemaVersion').toBeGreaterThan(0);
  expect(m.providerVersion.length, 'manifest.providerVersion').toBeGreaterThan(0);

  // Auth descriptor shape per variant — exhaustive, so a new variant surfaces here (not silently).
  switch (provider.auth.type) {
    case 'oauth2':
      expect(provider.auth.tokenUrl.length, 'oauth2.tokenUrl').toBeGreaterThan(0);
      expect(provider.auth.authorizationUrl.length, 'oauth2.authorizationUrl').toBeGreaterThan(0);
      break;
    case 'api_key':
    case 'bearer':
      expect(provider.auth.fields.length, 'auth.fields').toBeGreaterThan(0);
      break;
    case 'credential_exchange':
      expect(
        provider.auth.tokenEndpoint.length,
        'credential_exchange.tokenEndpoint',
      ).toBeGreaterThan(0);
      expect(
        Object.keys(provider.auth.bodyFields).length,
        'credential_exchange.bodyFields',
      ).toBeGreaterThan(0);
      expect(
        provider.auth.responseFields.token.length,
        'credential_exchange.responseFields.token',
      ).toBeGreaterThan(0);
      break;
    default:
      assertNever(provider.auth);
  }

  // Enforcement #5 (ADR: credential-delivery-strategies): the auth descriptor is serializable DATA
  // only — a JSON round-trip must be identical. Catches any function/behavior smuggled into it.
  expect(
    JSON.parse(JSON.stringify(provider.auth)) as unknown,
    'authDescriptor must be pure serializable data',
  ).toEqual(provider.auth);

  const tools = provider.listTools();
  expect(tools.length, 'listTools() must be non-empty').toBeGreaterThan(0);

  const prefix = `mcp_${m.slug}_`;
  const seen = new Set<string>();
  for (const tool of tools) {
    expect(
      tool.name.startsWith(prefix),
      `tool "${tool.name}" must be namespaced "${prefix}*"`,
    ).toBe(true);
    expect(seen.has(tool.name), `duplicate tool name "${tool.name}"`).toBe(false);
    seen.add(tool.name);
    expect(typeof tool.description, `${tool.name}.description`).toBe('string');
    expect(tool.inputSchema, `${tool.name}.inputSchema`).toBeTypeOf('object');
  }

  // An unknown tool must yield a typed UNKNOWN_TOOL error, never throw.
  const result = await provider.callTool(
    '___does_not_exist___',
    {},
    {
      credential: { secret: new SecretString('') },
    },
  );
  expect(result.kind, 'unknown tool → error result').toBe('error');
  if (result.kind === 'error') {
    expect(result.code).toBe(ProviderErrorCode.UNKNOWN_TOOL);
    expect(result.providerSlug).toBe(m.slug);
  }
}
