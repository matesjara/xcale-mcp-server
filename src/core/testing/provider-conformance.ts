import { expect } from 'vitest';

import { assertNever, ProviderErrorCode } from '../errors';
import type { IProvider, ProviderAuthDescriptor } from '../provider-port';
import { SecretString } from '../secret-string';

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * Shape-per-variant + serializability for ONE auth descriptor. Applied to `provider.auth` and to
 * every entry of `provider.additionalAuth` (ADR: multiple-connect-methods-per-provider) — the
 * catalog publishes them all, so a malformed additional connect method is a consumer-facing bug.
 */
function assertAuthDescriptorShape(auth: ProviderAuthDescriptor, label: string): void {
  // Exhaustive switch, so a new variant surfaces here (not silently).
  switch (auth.type) {
    case 'oauth2':
      expect(auth.tokenUrl.length, `${label}: oauth2.tokenUrl`).toBeGreaterThan(0);
      expect(auth.authorizationUrl.length, `${label}: oauth2.authorizationUrl`).toBeGreaterThan(0);
      break;
    case 'api_key':
    case 'bearer':
      expect(auth.fields.length, `${label}: fields`).toBeGreaterThan(0);
      break;
    case 'credential_exchange':
      expect(
        auth.tokenEndpoint.length,
        `${label}: credential_exchange.tokenEndpoint`,
      ).toBeGreaterThan(0);
      expect(
        Object.keys(auth.bodyFields).length,
        `${label}: credential_exchange.bodyFields`,
      ).toBeGreaterThan(0);
      expect(
        auth.responseFields.token.length,
        `${label}: credential_exchange.responseFields.token`,
      ).toBeGreaterThan(0);
      break;
    default:
      assertNever(auth);
  }

  // Enforcement #5 (ADR: credential-delivery-strategies): the auth descriptor is serializable DATA
  // only — a JSON round-trip must be identical. Catches any function/behavior smuggled into it.
  expect(
    JSON.parse(JSON.stringify(auth)) as unknown,
    `${label} must be pure serializable data`,
  ).toEqual(auth);
}

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

  // The primary descriptor and every additional connect method meet the same contract.
  assertAuthDescriptorShape(provider.auth, 'auth');
  (provider.additionalAuth ?? []).forEach((alt, i) =>
    assertAuthDescriptorShape(alt, `additionalAuth[${i}]`),
  );

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
