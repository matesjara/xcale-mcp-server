import type { IProvider } from './provider-port';

/**
 * The explicit provider registry. No auto-discovery, no framework magic.
 *
 * Dependency inversion: this takes an `IProvider[]` — it never imports a concrete provider. The
 * single explicit list lives in `src/providers/index.ts`, so adding a provider touches only
 * `src/providers/**` (Provider Self-Containment), never the core.
 */
export interface ProviderRegistry {
  readonly providers: readonly IProvider[];
  getProvider(slug: string): IProvider | undefined;
  getProviderByTool(toolName: string): IProvider | undefined;
  hasTool(toolName: string): boolean;
}

export function createRegistry(providers: readonly IProvider[]): ProviderRegistry {
  const bySlug = new Map<string, IProvider>();
  const byTool = new Map<string, IProvider>();

  for (const provider of providers) {
    const { slug } = provider.manifest;
    if (bySlug.has(slug)) {
      throw new Error(`Duplicate provider slug in registry: "${slug}"`);
    }
    bySlug.set(slug, provider);

    // Routing indexes what a provider can RUN, not what it publishes. Indexing `listTools()` here is
    // what made every control-plane tool answer `UNKNOWN_TOOL` — withdrawn from the agent's menu and,
    // by the same line, withdrawn from dispatch. The duplicate guard still applies across the full
    // set: two providers cannot share a name even if neither publishes it.
    for (const toolName of provider.routableToolNames()) {
      if (byTool.has(toolName)) {
        throw new Error(`Duplicate tool name across providers: "${toolName}"`);
      }
      byTool.set(toolName, provider);
    }
  }

  return {
    providers,
    getProvider: (slug) => bySlug.get(slug),
    getProviderByTool: (toolName) => byTool.get(toolName),
    hasTool: (toolName) => byTool.has(toolName),
  };
}
