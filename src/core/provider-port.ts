import type { JsonSchema, McpToolDefinition, ProviderCallContext, ToolResult } from './types';

/**
 * Non-secret auth blueprint a provider publishes via the catalog (ADR:
 * provider-knowledge-vs-credential-custody). Adaptive — as rich as the auth type requires.
 * SECRETS (clientId/clientSecret/keys) NEVER appear here; they are the consumer's generic config.
 */
export type ProviderAuthDescriptor =
  | {
      readonly type: 'api_key' | 'bearer';
      readonly fields: ReadonlyArray<{
        readonly key: string;
        readonly label: string;
        readonly placement: 'header' | 'query';
      }>;
    }
  | {
      readonly type: 'oauth2';
      readonly authorizationUrl: string;
      readonly tokenUrl: string;
      readonly scopes: readonly string[];
      readonly tokenPlacement: 'bearer_header' | 'custom_header';
      readonly supportsRefresh: boolean;
    };

/** Optional capabilities a provider may declare. Reserved (modeled, not enforced in v1). */
export interface ProviderCapabilities {
  readonly streaming?: boolean;
  readonly longRunning?: boolean;
  readonly webhooks?: boolean;
  readonly polling?: boolean;
  readonly files?: boolean;
  readonly pagination?: boolean;
  readonly autoRefresh?: boolean;
}

/** Provider identity + lifecycle metadata, published via the catalog. */
export interface ProviderManifest {
  /** Stable, consumer-agnostic id, kebab-case (e.g. `nevatal`). */
  readonly slug: string;
  readonly displayName: string;
  readonly category: string;
  /** Bumped when listTools() output changes incompatibly (cache key on the consumer). */
  readonly schemaVersion: string;
  /** The adapter's own semver. */
  readonly providerVersion: string;
  /** Relative or absolute URL to the provider's logo image (SVG/PNG). */
  readonly logoUrl?: string;
  /** Reserved lifecycle (modeled now, not enforced in v1). */
  readonly apiVersion?: string;
  readonly deprecated?: boolean;
  readonly sunsetDate?: string;
  readonly capabilities?: ProviderCapabilities;
}

/**
 * The contract every provider implements. The core depends on THIS, never on a concrete provider.
 * Adding a provider = a new `src/providers/{slug}/` module + one line in `src/providers/index.ts`.
 */
export interface IProvider {
  readonly manifest: ProviderManifest;
  readonly auth: ProviderAuthDescriptor;
  /**
   * JSON Schema of the provider's required call context (generated from its `metadataSchema`),
   * published via the catalog so a consumer knows what context to forward (e.g. `propertyID`).
   * Absent when the provider needs no context (Explicit Context principle).
   */
  readonly contextSchema?: JsonSchema;
  listTools(): readonly McpToolDefinition[];
  callTool(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ProviderCallContext,
  ): Promise<ToolResult>;
}
