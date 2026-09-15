import type { ResolvedCredential } from './credential/resolved-credential';
import type { ProviderErrorCode } from './errors';
import type { SecretString } from './secret-string';

/** A JSON Schema object describing a tool's input (MCP-compatible). */
export type JsonSchema = Record<string, unknown>;

/** One callable capability, discoverable via tools/list and runnable via tools/call. */
/**
 * How a tool relates to the identity of the person a CONSUMER's agent is talking to.
 *
 * Published in `tools/list` because it is **provider knowledge**, and the consumer cannot derive it.
 * A gateway tool reaches the consumer as a name, a description and a schema — nothing in that says
 * whether `guestPhone` identifies a person or `search_guests` with no filters returns the whole
 * property. The consumer can enforce a rule it is told; it cannot invent one.
 *
 * Keeping it here rather than in a list on the consumer's side is the same argument as
 * `requiredScopes`: a hand-maintained map over there names tools by string, and rots silently the
 * day one is renamed — protecting a name that no longer exists, with nothing failing.
 *
 * This is a DECLARATION, not an enforcement point. The gateway does not police it; the consumer
 * decides what to do, under its own tenant's setting.
 */
export type ToolIdentityPolicy =
  /**
   * Acts on a person named in its arguments — in the NAMED fields. When several of those fields
   * are optional, an unscoped call (none supplied) is the broadest read the tool offers, and the
   * consumer should treat it as such.
   */
  | {
      readonly mode: 'subject-bound';
      readonly identityFields: readonly string[];
    }
  /** Takes no person identifier and returns other people's records anyway. */
  | { readonly mode: 'subject-scoped' }
  /** Access earned by proving knowledge only the holder would have, rather than by naming them. */
  | { readonly mode: 'knowledge-proof' };

export interface McpToolDefinition {
  /** Namespaced to avoid collisions: `mcp_{slug}_{verb}`. */
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  /**
   * Whose data this tool can reach — see `ToolIdentityPolicy`. Absent means the tool touches
   * nobody's personal records, which is true of most of them (room types, rate plans, a dashboard).
   */
  readonly identityPolicy?: ToolIdentityPolicy;
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
