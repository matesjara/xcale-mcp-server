import type { z } from 'zod';

import type { ProviderErrorCode } from './errors';
import type { SecretString } from './secret-string';

/**
 * The light result a handler returns. The provider dispatcher (createProvider) wraps it into the
 * full `ToolResult`, adding `toolName`/`providerSlug` so handlers stay focused on logic.
 */
export type ToolOutcome =
  | { readonly ok: true; readonly data: unknown; readonly message?: string }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

export function ok(data: unknown, message?: string): ToolOutcome {
  return message === undefined ? { ok: true, data } : { ok: true, data, message };
}

export function err(code: ProviderErrorCode, message: string): ToolOutcome {
  return { ok: false, code, message };
}

/** Context handed to a tool handler: the credential + the already-validated, typed metadata. */
export interface ToolHandlerContext<M = unknown> {
  readonly token: SecretString;
  readonly metadata: M;
}

/**
 * A tool's definition. `input` (zod) is the SINGLE SOURCE OF TRUTH: it validates the args AND
 * generates the published JSON Schema. The handler receives args already validated and TYPED
 * (`z.infer<I>`) — no `parse()` or `unknown` inside business logic.
 */
export interface ToolDefinition<I extends z.ZodTypeAny = z.ZodTypeAny, M = unknown> {
  readonly name: string;
  readonly description: string;
  readonly input: I;
  readonly handler: (args: z.infer<I>, ctx: ToolHandlerContext<M>) => Promise<ToolOutcome>;
}

/** Declare a tool. Identity helper that preserves the input/metadata types for the handler. */
export function defineTool<I extends z.ZodTypeAny, M = unknown>(
  def: ToolDefinition<I, M>,
): ToolDefinition<I, M> {
  return def;
}

/**
 * Returns a `defineTool` bound to a provider's metadata type `M`, so each tool's handler receives
 * typed, validated `ctx.metadata` while still inferring its own input type — no per-tool generics.
 * Use it for providers that declare a `metadataSchema`; use plain `defineTool` when there is none.
 */
export function toolFactory<M>() {
  return function tool<I extends z.ZodTypeAny>(def: ToolDefinition<I, M>): ToolDefinition<I, M> {
    return def;
  };
}
