import type { z } from 'zod';

import type { RequestSpec } from './auth/http-request';
import type { ProviderErrorCode } from './errors';
import type { RequestResult } from './http';

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

/**
 * Context handed to a tool handler: an authenticated-request executor + the already-validated, typed
 * metadata. The handler builds a `RequestSpec` and calls `request(spec)`; the core materializes auth
 * (reveals + applies placement) and transports it, so the handler never touches the secret.
 */
export interface ToolHandlerContext<M = unknown> {
  /** Execute an authenticated request; the core reveals + applies auth and sends it. */
  readonly request: (spec: RequestSpec) => Promise<RequestResult>;
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
  /**
   * The provider scopes this tool needs to run — provider knowledge, so it lives with the tool.
   *
   * It is the SINGLE SOURCE of an oauth2 provider's scope surface: the `authDescriptor`'s `scopes` is
   * the UNION of its tools' `requiredScopes` (`deriveOAuthScopes`), never a hand-written list. Adding a
   * tool therefore requests its scope automatically, and no list can drift from the provider's app
   * registration.
   *
   * `[]` is meaningful and NOT the same as omitted: it means "authenticates, but needs no specific
   * scope" (e.g. Cloudbeds' webhook methods, which the OpenAPI spec declares as `OAuth2: []`).
   * Omitted means the provider has no scope model at all (api_key providers).
   */
  readonly requiredScopes?: readonly string[];
  /**
   * Control-plane tool: dispatched by `tools/call`, **withdrawn from `tools/list`**.
   *
   * Some provider operations are infrastructure the CONSUMER performs (subscribe a webhook receiver,
   * disable an app) and are not moves an agent may make on a guest's behalf. Publishing them made
   * them agent surface, which is how the webhook tools were withdrawn wholesale in the first place:
   * their `endpointUrl` is a bearer credential and any read tool can surface guest-authored text that
   * steers an agent.
   *
   * A flag on the definition is the honest place for that distinction, because the tool list IS the
   * agent's menu: the consumer builds its catalog from `tools/list`, so a tool that never appears
   * there can never be chosen by a model, hallucinated into a plan, or reached through prompt
   * injection. It stays callable by name over the same authenticated transport, which is exactly what
   * a control plane needs — it knows the name, the agent does not.
   *
   * This is NOT an authorization boundary: anything holding the Hop-B secret and a live token can
   * still call it. It removes the agent as an attack surface, not the caller.
   */
  readonly controlPlane?: boolean;
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
