import type { JsonSchema, McpToolDefinition, ProviderCallContext, ToolResult } from './types';

/**
 * How a provider's credential reaches the server on a `tools/call`
 * (ADR: credential-delivery-strategies). Exactly two strategies; opt-in per provider (default
 * `forwarded`). Published in the catalog so one declaration drives both the consumer (what to send)
 * and the server (whether to resolve a reference).
 */
export type CredentialDelivery = 'forwarded' | 'reference';

/**
 * Non-secret auth blueprint a provider publishes via the catalog (ADR:
 * provider-knowledge-vs-credential-custody). Adaptive — as rich as the auth type requires.
 * SECRETS (clientId/clientSecret/keys) NEVER appear here; they are the consumer's generic config.
 */
export type ProviderAuthDescriptor =
  | {
      readonly type: 'api_key' | 'bearer';
      readonly credentialDelivery?: CredentialDelivery;
      readonly fields: ReadonlyArray<{
        readonly key: string;
        readonly label: string;
        readonly placement: 'header' | 'query';
      }>;
    }
  | {
      readonly type: 'oauth2';
      readonly credentialDelivery?: CredentialDelivery;
      readonly authorizationUrl: string;
      readonly tokenUrl: string;
      readonly scopes: readonly string[];
      readonly tokenPlacement: 'bearer_header' | 'custom_header';
      readonly supportsRefresh: boolean;
    }
  | {
      /**
       * Declarative credential-exchange mint (Siigo-class): a durable credential is exchanged at a
       * token endpoint for a short-lived bearer token. Rail A (the Credential Authority) runs this
       * generically from the descriptor; secrets never appear here. STRICTLY DECLARATIVE — data only,
       * never hooks/templates/expressions (ADR: credential-delivery-strategies). Imperative auth
       * (HMAC/signing) is NOT an extension of this variant — it requires its own variant + an ADR.
       */
      readonly type: 'credential_exchange';
      readonly credentialDelivery?: CredentialDelivery;
      /** Token endpoint that mints the short-lived token. */
      readonly tokenEndpoint: string;
      readonly method: 'POST';
      /** Map logical credential fields → the provider's wire field names (used verbatim, never interpolated). */
      readonly bodyFields: Readonly<Record<string, string>>;
      /** Where to read the token (and optional expiry) in the mint response. */
      readonly responseFields: { readonly token: string; readonly expiry?: string };
      /**
       * Non-secret static headers required on every call (e.g. Siigo `Partner-Id`). The header name
       * is knowledge; its VALUE comes from deployment config, never from this descriptor or the catalog.
       */
      readonly staticHeaders?: ReadonlyArray<{
        readonly name: string;
        readonly source: 'deployment';
      }>;
      /** How the minted token is applied to data calls. */
      readonly tokenPlacement: 'bearer_header';
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
