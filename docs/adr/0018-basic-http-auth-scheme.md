# ADR 0018: HTTP Basic authentication scheme in the materializer

- **Status:** Accepted
- **Date:** 2026-09-14
- **Decision makers:** Mateo
- **Tags:** auth, integrations, mcp, core

## Context

WooCommerce is the first provider to onboard whose credential is **two durable secrets used
directly on every call**: a `consumer_key` + `consumer_secret` pair sent as HTTP Basic auth
(`Authorization: Basic base64(consumer_key:consumer_secret)`) over HTTPS. Both secrets are
long-lived (they do not expire until rotated), and — unlike Siigo — WooCommerce exposes **no
token-exchange endpoint**, so the pair cannot be reduced to a single minted token before it
reaches the server. Every data call needs both secrets.

Two forces collide:

- **The materializer is single-secret.** `materialize()` reveals exactly one `SecretString`
  from the `ResolvedCredential` and places it per the *first* declared `api_key` field
  (`src/core/auth/authentication-materializer.ts:31-45`). Its own comment records that
  "multiple distinct secrets are not expressible with today's single-secret model … the
  imperative / multi-material future, ADR-gated." So WooCommerce's pair cannot be expressed
  by the existing `api_key` path.
- **Provider knowledge must live in the MCP.** The catalog (`server/discover`) publishes each
  provider's `authDescriptor` as a public contract; the litmus test (soul.md) is *"could a
  third party use xcale-mcp-server without knowing xcale-backend exists?"*. Any scheme that
  hides "this is Basic of two keys" from the catalog fails that test.

We are deciding now because the WooCommerce provider is being scoped (read-only v1) and its
authentication shape blocks the whole integration. Onboarding a provider is supposed to touch
only `src/providers/**` (the golden rule of Provider Self-Containment); this one cannot, so
the exception needs a recorded justification.

## Decision

Add an **additive `basic` auth variant** to the `ProviderAuthDescriptor` and a corresponding
branch in the materializer. The credential remains **single-secret**: Rail A stores the two
WooCommerce secrets and forwards them joined as the string `consumer_key:consumer_secret`
(one `SecretString`, `forwarded` delivery). The materializer's new `case 'basic'` reveals
that single secret and emits `Authorization: Basic base64(secret)`. The colon-join happens in
the backend at credential materialization; the Base64 framing and the knowledge that the
provider uses HTTP Basic live in the MCP descriptor. This keeps the catalog contract honest,
avoids a multi-secret rewrite of the runtime, and is purely additive — the existing `bearer`,
`api_key`, and `credential_exchange` branches are untouched, and the `assertNever` default
still compile-forces every new variant to be implemented.

## Alternatives Considered

### Alternative A: Compose the full Basic header in the backend; MCP places it verbatim
- **Pros:** Zero core change — reuses `api_key` with `placement: 'header'`, `key: 'authorization'`, the pre-formed `Basic …` value placed as-is.
- **Cons:** The published `authDescriptor` would say only "put this secret in a header" and omit that it is Basic auth of two keys. The real recipe would live in xcale-backend, invisible to any other consumer of the catalog.
- **Why rejected:** Fails the consumer-agnostic litmus test — a third-party MCP client could not authenticate WooCommerce from the catalog alone. It re-couples provider knowledge to one consumer, the exact thing the server exists to prevent.

### Alternative B: Full multi-secret `ResolvedCredential` (the "multi-material future")
- **Pros:** Most general — models N distinct secrets, placements, and imperative auth (HMAC/signing) for any future provider.
- **Cons:** A significant rewrite of the credential-resolution and materialization runtime, with a new cross-repo contract, for a single provider that does not need it.
- **Why rejected:** Premature (prove-don't-pre-abstract). WooCommerce is the only two-secret provider today, and Basic is a closed, standard scheme — a single composed secret satisfies it without opening the multi-material surface. Revisit when a *second* provider needs genuinely distinct multi-secret or imperative auth.

### Alternative C (accepted): Additive `basic` scheme over a single composed secret
- **Pros:** Keeps the runtime single-secret; provider knowledge stays in the MCP (litmus passes); Basic is an internet standard, reusable by any future Basic provider for free; additive switch branch, no risk to existing providers.
- **Why accepted:** The only option that honors both the single-secret invariant and the consumer-agnostic contract, at minimal, well-scoped cost.

## Consequences

### Positive
- WooCommerce (and any future HTTP Basic provider) is expressible with a truthful catalog entry.
- The change is additive and mechanically safe: existing auth branches are byte-unchanged, and `assertNever` guarantees the new variant is fully implemented before it can ship.
- No new infrastructure, no multi-material rewrite; `forwarded` delivery and `SecretString` redaction are reused unchanged.

### Negative
- **The golden rule is intentionally broken:** onboarding WooCommerce touches `src/core/auth`, not only `src/providers/**`. This ADR is the required justification. Future *Basic* providers reuse the scheme and touch only `src/providers/**` again.
- Base64 is encoding, not encryption, so the scheme is only safe over TLS — the WooCommerce provider must reject non-`https` store URLs at connect (enforced in Rail A). A misconfigured `http` base URL would expose the joined secret.
- Reversing the scheme later (e.g. folding it into a general multi-material model) means migrating this branch and the WooCommerce descriptor.

### Neutral
- The `authDescriptor` union gains a published `basic` variant — an additive public-contract surface to evolve per the additive-versioning ADR.
- The backend now owns one new credential-materialization shape: "join two stored fields with a colon and forward as one secret" for `basic` providers.

## References

- Related ADRs: [credential-delivery-strategies](0010-credential-delivery-strategies.md), [provider-knowledge-vs-credential-custody](0004-provider-knowledge-vs-credential-custody.md), [canonical-provider-pattern](0009-canonical-provider-pattern.md), [additive-contract-versioning](0001-additive-contract-versioning.md), [multiple-connect-methods-per-provider](0016-multiple-connect-methods-per-provider.md)
- Code anchors: `src/core/auth/authentication-materializer.ts:31-45` (single-secret `api_key` path + `assertNever` default), `src/core/provider-port.ts:16-25` (`ProviderAuthDescriptor` `api_key | bearer` variant), `src/providers/toteat/auth.ts` (the `api_key` + `forwarded` + per-account-context precedent)
- Provider docs: WooCommerce REST API authentication — https://woocommerce.github.io/woocommerce-rest-api-docs/#authentication
