# ADR 0011: Tool-derived OAuth scopes

- **Status:** Accepted
- **Date:** 2026-07-15
- **Decision makers:** JuanJo
- **Tags:** auth, providers, contract

## Context

An oauth2 `authDescriptor` published a hand-written `scopes` array. That list has to stay in sync, by
hand and with nothing enforcing it, with **two things that move independently**:

1. **The tools that actually need a scope.** A scope only exists to let a tool run. Nothing tied the
   list to the tools, so it could name scopes no tool used, or omit ones tools needed.
2. **The provider's app registration.** For Cloudbeds this is a human-edited web page (App Details ›
   *Permission Scopes*) that generates the app's canonical OAuth URL. No code sees that page.

Drift is silent and it hurts in **both** directions:

- **Too little** → the call is denied. Cloudbeds reports this as
  `"Scope required for this call was not granted by property."` — which **blames the wrong party**: the
  property *does* authorize it; we never requested it. Read literally, the message sends an engineer
  hunting on the hotel's side indefinitely.
- **Too much** → every hotel is asked to over-grant. Consent is **binary** (below), so there is no
  negotiating it down, and `soul.md` ranks Security first.

We found this while asking a different question — how to cover all 32 authorized Cloudbeds scopes so
customers can compose agents. Answering it required establishing facts nobody had, all **observed, not
inferred** (full record: `docs/design/cloudbeds-scope-coverage/scope-endpoint-map.md`):

- **The token is bounded by what we request.** 12 of 12 methods that the property authorizes but we
  never requested returned `SCOPE DENIED`. There is no shortcut to the other scopes.
- **Consent is binary.** A hotel never sees App Details (a partner-only page); it gets a list and one
  *Allow Access* button. Therefore **requested == granted**, and the consumer's stored scope list —
  which records only the request — is faithful in practice.
- **The grant is not readable by us.** The token response carries no `scope` field (observed on a real
  reconnect); `/userinfo`'s `acl` is a different vocabulary (Cloudbeds UI permissions);
  `/integration/v1/connected-applications` would return `oauthScopes` but answers
  `403 "Partner tokens are not allowed to access this endpoint"`.
- **Cardinality is N agents : 1 connection.** A scope therefore can never belong to "an agent". Per-agent
  composition already exists in the consumer as `enabledTools`.

The surface at stake: Cloudbeds' vocabulary is 61 scopes; this app is registered for 32; 24 of those have
endpoints in PMS v1.3, spanning 69 operations. We shipped 13 tools over 7 scopes. Whatever governs the
scope list will be exercised dozens of times, by people who did not sit through this analysis.

## Decision

An oauth2 provider's published `scopes` is **derived**: it is the union of its tools' `requiredScopes`,
computed at provider construction (`core/scopes.ts` › `deriveOAuthScopes`). A provider's auth blueprint
never contains a hand-written scope list. A tool is the only thing that can need a scope, so the tools are
the only honest source; adding a tool requests its scope by construction, and no list can drift from the
app registration because there is no list.

## Alternatives Considered

### Alternative A: a hand-written list of all 32 registered scopes

- **Pros:** trivial; freezes the consent screen immediately, so no connection is ever left short — not
  even while tools are being built.
- **Cons:** must be kept in sync **by hand** with a web page, and nothing warns when it desynchronizes;
  requests scopes no tool uses, which is over-permissioning by construction.
- **Why rejected:** it is precisely the failure mode we set out to fix, made permanent. The list would be
  correct on the day it was written and unverifiable forever after.

### Alternative B: dynamic per-connection scopes

- **Pros:** each hotel consents only to what it wants (sales vs administrative); the most proportionate
  consent screen possible.
- **Cons:** the connection is shared by **all** of a user's agents (N:1), so no per-agent scope set is
  even well-defined; expanding later forces a reconnect; it is a large contract change across the
  manifest and the consumer's rail.
- **Why rejected:** the cardinality makes it incoherent, and *complexity on demand* forbids it — the
  mechanism would arrive before the problem. Per-agent composition is already solved by `enabledTools`.

### Alternative C: publish the 32 as "available" and let the consumer subset them

- **Pros:** clean split of knowledge (server) and policy (consumer).
- **Cons:** the consumer would need to know which scope each tool needs in order to choose — Cloudbeds
  knowledge living outside the Cloudbeds adapter.
- **Why rejected:** violates Provider Self-Containment. It is also strictly weaker than the accepted
  option, which gives the consumer the same power *and* the per-tool knowledge to use it.

### Alternative D (accepted): derive the scopes from the tools

- **Pros:** no list to maintain and none to drift; over- and under-requesting both become structurally
  hard; provider knowledge stays in the provider while the consumer keeps policy; scopes with no tools
  (Data Insights; scopes with no published endpoint) fall out **by construction** rather than by a
  decision someone must remember.
- **Cons:** the requested set grows as tools are added, and a grown set leaves existing connections short
  (see Negative).
- **Why accepted:** it makes the correct thing automatic and the incorrect thing loud. The cost lands
  during a build phase where it is currently free.

## Consequences

### Positive

- Adding a tool requests its scope. No second edit, no list to remember.
- The union cannot name a scope no tool uses; over-permissioning has to be argued for, per tool.
- Scopes with no tools are never requested — Data Insights (a separate product: ~130 report/chart
  endpoints, bearer JWT, no per-endpoint scopes) and the three registered-but-unpublished scopes
  (`read:adjustment`, `read:resourceTypes`, `read:resourceReservations`) are excluded automatically.
- The refactor published the **same 7 scopes** as the hand-written list, pinned by a test — so it landed
  with no consent-screen change, no reconnect, and no consumer impact.

### Negative

- **The requested set grows as tools are added**, and a grown set leaves already-connected users short
  until they reconnect. Free today (no real hotels are connected); **not free after launch**, when adding
  a tool with a new scope becomes a migration. Mitigation when it matters: land a role group's tools
  together rather than trickling scopes.
- **Reversing this** means re-introducing a hand-written list in every oauth2 provider and deleting the
  guard — cheap in code, but it silently restores the drift. That is exactly why it is written down: the
  next reader will find a literal array simpler and will be wrong.
- **`REGISTERED_SCOPES` is still hand-maintained** — it mirrors an external, human-edited page. It is not
  what we request (so it cannot cause drift in the request), and its only job is the guard; but if the
  app registration changes, someone must update it.

### Neutral

- **A mandatory guard per oauth2 provider:** a test asserting union(`requiredScopes`) ⊆ the app's
  registered scopes. One tool declaring an unregistered scope puts it in the authorize URL and can break
  the connect flow for **every** consumer — a whole-provider outage from a single tool. Verified by
  breaking it, not by assuming.
- **`requiredScopes: []` is meaningful and distinct from omitting the field.** `[]` means "authenticates,
  needs no scope" — Cloudbeds' webhook methods, which the OpenAPI spec declares as `OAuth2: []`. A test
  forbids omission, so silence can never read as "needs nothing".
- **Scope strings are opaque.** Never parsed, split on `:`, or ordered by meaning — Cloudbeds itself uses
  `read:hotel` (v1.3) and `hotel:read` (v2.0), inverted. Any structure we assumed would be wrong
  somewhere.
- A provider's scope surface is now reviewable in a diff: the pinned union test changes iff the consent
  screen changes.

## References

- Related ADRs: [provider-knowledge-vs-credential-custody](0004-provider-knowledge-vs-credential-custody.md)
  (knowledge → server, custody → Rail A; the `authDescriptor` this refines),
  [consumer-agnostic-contract](0002-consumer-agnostic-contract.md) (why policy stays with the consumer),
  [canonical-provider-pattern](0009-canonical-provider-pattern.md) (single-source tool contract — this extends
  the same stance from `input` to `requiredScopes`),
  [additive-contract-versioning](0001-additive-contract-versioning.md) (`requiredScopes` is additive; no
  consumer breaks).
- Evidence: `docs/design/cloudbeds-scope-coverage/scope-endpoint-map.md` (the observed facts, the 61/32/24
  scope arithmetic, the falsified hypotheses) and `tool-map.md` (the ~38-tool proposal over 69 operations).
- Code anchors: `src/core/scopes.ts`, `src/core/tool.ts` (`ToolDefinition.requiredScopes`),
  `src/providers/cloudbeds/auth.ts` (`cloudbedsAuthBase`, `REGISTERED_SCOPES`),
  `src/providers/cloudbeds/provider.ts`, `src/providers/cloudbeds/__tests__/scopes.test.ts`.
- Provider source of truth: Cloudbeds App Details › *Permission Scopes* (partner account) and
  `github.com/cloudbeds/openapi-specs` › `src/pms-v1.3-openapi.yaml` (per-operation `security`).
