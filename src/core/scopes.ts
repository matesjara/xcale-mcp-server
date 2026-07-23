import type { ProviderAuthDescriptor } from './provider-port';
import type { ToolDefinition } from './tool';

/**
 * Derive an oauth2 provider's requested scopes from its tools.
 *
 * A hand-written `scopes` list on an `authDescriptor` has to be kept in sync, by hand, with two moving
 * things: the tools that actually need scopes, and the provider's app registration. Nothing enforces
 * either, so it drifts silently — request too little and calls are denied with an error that blames the
 * wrong party; request too much and every user is asked to over-grant on a consent screen.
 *
 * So the tools are the source of truth (`ToolDefinition.requiredScopes`) and this computes the union.
 * Adding a tool requests its scope; removing the last tool that needs a scope stops requesting it.
 *
 * Scope strings are treated as OPAQUE: never parsed, split, or ordered by meaning. Providers are not
 * consistent about their shape (Cloudbeds' own APIs use both `read:hotel` and `hotel:read`), so any
 * structure we assumed would be wrong somewhere. Sorted only for a stable, diffable output.
 *
 * Non-oauth2 descriptors pass through untouched: they have no scope model.
 */
export function deriveOAuthScopes<M>(
  auth: Omit<Extract<ProviderAuthDescriptor, { type: 'oauth2' }>, 'scopes'>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
  tools: ReadonlyArray<ToolDefinition<any, M>>,
): ProviderAuthDescriptor {
  return { ...auth, scopes: unionToolScopes(tools) };
}

/**
 * The union of every tool's `requiredScopes`, deduplicated and sorted.
 *
 * A tool with `requiredScopes: []` contributes nothing and that is correct — it authenticates but needs
 * no scope. A tool that OMITS the field also contributes nothing; enforcing that a provider's tools all
 * declare it is the provider's own conformance test, not this function's job (it must stay usable by
 * providers with no scope model at all).
 */
export function unionToolScopes<M>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
  tools: ReadonlyArray<ToolDefinition<any, M>>,
): readonly string[] {
  const all = new Set<string>();
  for (const t of tools) {
    for (const s of t.requiredScopes ?? []) all.add(s);
  }
  return [...all].sort();
}
