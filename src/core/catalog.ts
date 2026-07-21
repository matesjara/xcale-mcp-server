import type { ProviderAuthDescriptor, ProviderCapabilities } from './provider-port';
import type { ProviderRegistry } from './registry';
import type { JsonSchema } from './types';

/**
 * One provider's public, discoverable description (the `server/discover` payload).
 * Consumer-agnostic: contains provider knowledge, never consumer concepts. No secrets.
 */
export interface CatalogEntry {
  readonly slug: string;
  readonly displayName: string;
  readonly category: string;
  readonly schemaVersion: string;
  readonly providerVersion: string;
  readonly authDescriptor: ProviderAuthDescriptor;
  /** Relative or absolute URL to the provider's logo image. */
  readonly logoUrl?: string;
  /** JSON Schema of the context the consumer must forward (e.g. propertyID), when the provider needs it. */
  readonly contextSchema?: JsonSchema;
  readonly toolCount: number;
  readonly capabilities?: ProviderCapabilities;
  readonly deprecated?: boolean;
  readonly sunsetDate?: string;
}

/** Derive the capability catalog from the registry (the source of truth is the explicit list). */
export function buildCatalog(registry: ProviderRegistry): CatalogEntry[] {
  return registry.providers.map((provider) => {
    const m = provider.manifest;
    return {
      slug: m.slug,
      displayName: m.displayName,
      category: m.category,
      schemaVersion: m.schemaVersion,
      providerVersion: m.providerVersion,
      authDescriptor: provider.auth,
      toolCount: provider.listTools().length,
      // Optional fields only included when present.
      ...(provider.contextSchema !== undefined ? { contextSchema: provider.contextSchema } : {}),
      ...(m.logoUrl !== undefined ? { logoUrl: m.logoUrl } : {}),
      ...(m.capabilities !== undefined ? { capabilities: m.capabilities } : {}),
      ...(m.deprecated !== undefined ? { deprecated: m.deprecated } : {}),
      ...(m.sunsetDate !== undefined ? { sunsetDate: m.sunsetDate } : {}),
    };
  });
}
