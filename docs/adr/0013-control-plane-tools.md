# ADR 0013: Control-plane tools — callable, not published

- **Status:** Accepted
- **Date:** 2026-08-06
- **Decision makers:** Mateo
- **Tags:** mcp, contract, discovery, providers, security

## Context

Some provider operations are infrastructure the **consumer** performs on its own behalf —
subscribe my webhook receiver, remove my subscriptions on disconnect, read or set the app's
enabled state. They are never a move an agent makes for a guest. Cloudbeds' webhook tools were
originally published as ordinary agent tools, and the write-path review (PR #11) withdrew them
for reasons that were all sentences about the agent: the `endpointUrl` is a bearer credential
(Cloudbeds deliveries carry no signature), a `list` tool returned it verbatim into agent context,
and a `delete` tool let the agent unhook the consumer's own receiver.

The withdrawal overshot. The registry indexed `listTools()` for routing, so a tool withdrawn from
the menu was withdrawn from dispatch too — every call answered `UNKNOWN_TOOL`. The backend's
already-shipped subscribe call had been failing **silently since PR #11 merged**; that production
regression is what surfaced the gap and made restoring webhook management urgent. The menu
("what may an agent choose?") and the router ("what can you run?") are different questions, and
answering both from one list is what broke.

## Decision

Split the two questions. `ToolDefinition` gains a `controlPlane?: boolean` flag, and the
`IProvider` port gains `routableToolNames()` alongside `listTools()`: the registry routes
`tools/call` on the full routable set, while `tools/list` serves only the published
(non-control-plane) tools. Control-plane tools are therefore **invocable by name over the same
authenticated transport but withdrawn from the agent's menu** — and, consistently, excluded from
the catalog: `server/discover`'s `toolCount` derives from `listTools()`, and control-plane
changes never bump `schemaVersion` (that key exists to invalidate the consumer's `tools/list`
cache, which they cannot move). This is not an authorization boundary — anything holding the
Hop-B secret and a live token can still call them; it removes the **agent** as an attack surface,
not the caller.

## Alternatives Considered

### Alternative A: republish as ordinary agent tools behind guards

- **Pros:** No core change; tools stay discoverable via `tools/list`; the PR #11 conditions
  (https allowlist, redaction, consent gate) were already written down.
- **Cons:** The agent remains reachable — a model can still choose, hallucinate, or be
  prompt-injected into the tool; a consent gate is consumer policy (business logic that does not
  belong in this server); redaction fights the symptom while the secret-bearing URL still
  transits agent context.
- **Why rejected:** Every reason the tools were withdrawn named the agent. Taking the agent out
  of reach entirely is strictly stronger than gating an agent tool, and it makes the guards moot
  (no `list` tool exists, so nothing returns an `endpointUrl` to anyone).

### Alternative B: a separate contract surface for control operations

- **Pros:** Clean conceptual split — agent tools on MCP, consumer infrastructure on its own
  endpoint; discovery question never arises.
- **Cons:** A second transport, auth path, error contract, and versioning story for four tools;
  duplicates the credential-resolution and typed-error machinery the `tools/call` path already
  has; the tool knowledge would live outside the provider module, breaking self-containment.
- **Why rejected:** _Complexity on demand_ forbids it — the existing authenticated transport
  already does everything these calls need. The distinction is per-tool, so a flag on the tool
  definition is the honest place for it.

### Alternative C (accepted): a `controlPlane` flag + a menu/router split on the port

- **Pros:** One flag at the definition site; control-plane tools keep the entire existing
  pipeline (validation, credential handling, typed errors, tests); the agent can never select
  them; provider self-containment holds (the flag lives with the tool).
- **Cons:** Extends the core `IProvider` contract with a second method, and creates a class of
  tools with **no discovery surface** (see Consequences).
- **Why accepted:** It fixes the production regression with the smallest honest mechanism, and
  the trade-off it takes is explicit and additively reversible.

## Consequences

### Positive

- Webhook subscription management works again — the silent `UNKNOWN_TOOL` regression shipped in
  PR #11 is fixed, and app-state lifecycle (`get_app_state`/`set_app_state`) is now reachable.
- A control-plane tool can never be chosen by a model, hallucinated into a plan, or reached
  through prompt injection: the tool list is the agent's entire menu, and these are not on it.
- No new surface: same Hop-B auth, same credential delivery, same typed-error contract, same
  test harness as every other tool.

### Negative

- **Control-plane tools have no discovery surface — the accepted trade-off.** They appear in
  neither `tools/list` nor `server/discover` (whose `toolCount` counts only published tools), so
  a consumer must know their **names and schemas out-of-band**. That is a deliberate, documented
  exception to the capability-discovery principle (soul.md: "the backend never hardcodes tools")
  and to the intent of
  [three-pillar-mcp-contract-with-discovery](0006-three-pillar-mcp-contract-with-discovery.md).
  Accepted because today the coupling is small and stable: one consumer, one provider, four
  tools whose names follow the standard `mcp_{slug}_*` convention.
- Reversing the mechanism means collapsing the router back into the menu — cheap in code, but it
  re-creates exactly the withdrawn-from-dispatch failure this ADR exists to prevent.

### Neutral

- **Future option, on trigger:** a discovery surface for control-plane tools — e.g. a
  `controlPlaneTools` field on the `server/discover` catalog entry — is a purely **additive**
  change under [additive-contract-versioning](0001-additive-contract-versioning.md). Adopt it when a
  second consumer, or a second provider with control-plane tools, makes out-of-band knowledge a
  real maintenance cost; not before.
- Scope derivation still unions **all** tools' `requiredScopes`, control-plane included
  ([tool-derived-oauth-scopes](0011-tool-derived-oauth-scopes.md)) — a hidden tool that needed a
  scope would still have to request it on the consent screen. (Cloudbeds' four declare
  `requiredScopes: []`, so the consent screen is unchanged.)
- The registry's duplicate-name guard now applies across the full routable set: two providers
  cannot share a tool name even if neither publishes it.

## References

- Related ADRs:
  [three-pillar-mcp-contract-with-discovery](0006-three-pillar-mcp-contract-with-discovery.md) (the
  discovery principle this excepts),
  [additive-contract-versioning](0001-additive-contract-versioning.md) (`schemaVersion` semantics; the
  additive path back to discoverability),
  [canonical-provider-pattern](0009-canonical-provider-pattern.md) (single-source tool definitions the
  flag extends), [tool-derived-oauth-scopes](0011-tool-derived-oauth-scopes.md) (scope union covers
  unpublished tools).
- Origin of the withdrawal + closure note: `docs/design/roadmap.md` (PR #11 section, "Withdrawn
  in this PR (Blocker 2)").
- Code anchors: `src/core/tool.ts` (`ToolDefinition.controlPlane`), `src/core/provider-port.ts`
  (`IProvider.routableToolNames`), `src/core/registry.ts` (routing indexes the routable set),
  `src/core/provider-factory.ts` (menu filter + scope union), `src/providers/cloudbeds/tools.ts`
  ("Control plane" section), `src/providers/cloudbeds/manifest.ts` (the not-bumped
  `schemaVersion` rationale).
