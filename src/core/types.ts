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

/**
 * The `_meta` key `identityPolicy` travels under in `tools/list`.
 *
 * NOT a style choice — measured. The SDK validates every published tool against its `ToolSchema`,
 * a plain `z.object`, so zod strips any key it does not name: a top-level `identityPolicy` is
 * silently dropped between this server and its consumer. `_meta` is the one passthrough the schema
 * declares (`z.record(z.string(), z.unknown())`), and the MCP spec's own place for
 * implementation-defined metadata. Verified against the installed SDK:
 *
 *   ToolSchema.parse({ …, identityPolicy })   → the key is gone
 *   ToolSchema.parse({ …, _meta: { … } })     → `_meta` survives intact
 *
 * Namespaced because `_meta` is shared ground and the spec asks for it. The prefix is this
 * SERVER's, never a consumer's — any MCP client can read the key without knowing who xcale-backend
 * is, which is the consumer-agnostic bar.
 */
export const IDENTITY_POLICY_META_KEY = 'xcale.app/identityPolicy';

/**
 * Who a tool may serve: the person a consumer's agent is talking to (`customer`), or the account's
 * own staff on their own surface (`operator`). Provider knowledge, published in `tools/list` for the
 * same reason as `ToolIdentityPolicy`: nothing in a name and a schema says that `list_reservations`
 * returns the whole property's book while `get_availability` returns nobody's data.
 *
 * A DECLARATION, not an enforcement point — the consumer refuses `operator` tools when a guest is on
 * the other end (ADR `tool-audience-gate-on-guest-channels`, xcale#1243).
 *
 * Absent on a tool = the provider has not classified it. A provider classifies all of its published
 * tools or none (`core/__tests__/audience-coverage.test.ts`), so a consumer that sees one mark can
 * read a missing one as a mistake and fail closed.
 */
export type ToolAudience = 'customer' | 'operator';

/** The `_meta` key `audience` travels under — same reason as `IDENTITY_POLICY_META_KEY`. */
export const AUDIENCE_META_KEY = 'xcale.app/audience';

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
  /** Who this tool may serve — see `ToolAudience`. Absent means the provider has not classified it. */
  readonly audience?: ToolAudience;
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
