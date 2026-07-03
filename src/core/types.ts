import type { ResolvedCredential } from './credential/resolved-credential';
import type { ProviderErrorCode } from './errors';
import type { SecretString } from './secret-string';

/** A JSON Schema object describing a tool's input (MCP-compatible). */
export type JsonSchema = Record<string, unknown>;

/** One callable capability, discoverable via tools/list and runnable via tools/call. */
export interface McpToolDefinition {
  /** Namespaced to avoid collisions: `mcp_{slug}_{verb}`. */
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
}

/**
 * Inbound, PRE-resolution context: the raw wire value (a forwarded credential or an ephemeral
 * reference) + routing metadata. Flows from the HTTP edge to the dispatch point, where the
 * `CredentialResolver` turns it into a `ProviderCallContext`. Never persisted, cached, or logged.
 */
export interface InboundCallContext {
  /** Raw Hop-A wire value — a credential (`forwarded`) or a reference (`reference`). */
  readonly token: SecretString;
  /** Opaque, provider-scoped routing data (e.g. accountKey, storeDomain). Validated per adapter. */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Per-call context handed to a provider, POST-resolution. Consumer-agnostic: no tenant/plan/business
 * identity. The credential is already resolved; provider execution is defined in terms of it.
 */
export interface ProviderCallContext {
  /** The resolved credential (convergence point of both delivery strategies). */
  readonly credential: ResolvedCredential;
  /** Opaque, provider-scoped routing data (e.g. accountKey, storeDomain). Validated per adapter. */
  readonly metadata?: Record<string, unknown>;
}

/** The normalized outcome of a tools/call — a discriminated union (no ad-hoc strings). */
export type ToolResult =
  | {
      readonly kind: 'success';
      readonly toolName: string;
      readonly providerSlug: string;
      readonly data: unknown;
      readonly message?: string;
    }
  | {
      readonly kind: 'error';
      readonly code: ProviderErrorCode;
      readonly toolName: string;
      readonly providerSlug: string;
      readonly message: string;
    };

export function toolSuccess(args: {
  toolName: string;
  providerSlug: string;
  data: unknown;
  message?: string;
}): ToolResult {
  return { kind: 'success', ...args };
}

export function toolError(args: {
  code: ProviderErrorCode;
  toolName: string;
  providerSlug: string;
  message: string;
}): ToolResult {
  return { kind: 'error', ...args };
}
