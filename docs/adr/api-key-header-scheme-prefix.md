# ADR: API-key header scheme prefix in the materializer

- **Status:** Accepted
- **Date:** 2026-09-24
- **Decision makers:** Sara (proposer) · Mateo (sign-off)
- **Tags:** auth, integrations, mcp, core
- **Origin:** Dentalink provider (`docs/design/dentalink-provider/`), open question Q-1.

> **Unnumbered on purpose.** Number it with the `/adr` house convention at merge against `dev`.

## Context

Dentalink (dental-clinic management, HealthAtom) is the first provider to onboard whose credential is
a single static token sent under a **non-standard `Authorization` scheme**:

```
Authorization: Token <access_token>
```

The vendor documents no alternative — no `Bearer`, no query parameter, no custom header. The token is
long-lived (no refresh, no exchange), so it is a `forwarded` single secret, which is otherwise the
plain `api_key` path.

Two forces collide, the same shape ADR 0018 (`basic`) resolved:

- **The materializer cannot emit this header.** `materialize()`
  (`src/core/auth/authentication-materializer.ts`) has three single-secret shapes and none produces
  `Authorization: Token <secret>`: `bearer` hardcodes the `Bearer ` scheme; `api_key` with
  `placement: 'header'` writes the secret **raw** (`headers[field.key] = secret`), with no scheme
  prefix; `basic` Base64-frames a composed pair. So `api_key` header would emit
  `Authorization: <token>` — wrong; the `Token ` scheme is missing.
- **The provider cannot fix it itself.** The token is a `SecretString` revealed at the single
  `.reveal()` site inside `materialize()`; the Dentalink adapter never holds the raw secret
  (`forwarded` delivery), so it cannot prepend `Token ` in its own client. The prefix must be applied
  where the secret is revealed — the core.

- **Provider knowledge must live in the MCP.** The catalog (`server/discover`) publishes each
  provider's `authDescriptor` as a public contract; the litmus test (soul.md) is *"could a third
  party use xcale-mcp-server without knowing xcale-backend exists?"*. Any scheme that hides "this is
  `Authorization: Token <token>`" from the catalog fails that test.

We are deciding now because the Dentalink provider is being scoped (read + reserve v1) and its
authentication shape blocks the whole integration. Onboarding a provider is supposed to touch only
`src/providers/**` (Provider Self-Containment); this one cannot, so the exception needs a recorded
justification.

## Decision

Add an **optional `scheme` prefix to the `api_key` header field descriptor** and a corresponding
branch in the materializer. The credential remains **single-secret** and `forwarded`.

- Descriptor: the `api_key` header field gains an optional `scheme?: string`
  (`src/core/provider-port.ts`). Dentalink declares `{ type: 'api_key', fields: [{ key:
  'Authorization', placement: 'header', scheme: 'Token' }] }`.
- Materializer: for `api_key` + `placement: 'header'`, when `scheme` is present emit
  `headers[field.key] = `${scheme} ${secret}``; when absent, keep today's raw-secret behavior
  **byte-unchanged**.

This is purely additive: the `bearer`, `basic`, `credential_exchange` and existing raw-header
`api_key` behaviors are untouched, and the `assertNever` default still compile-forces every variant.
The `scheme` lives in the published `authDescriptor`, so the catalog honestly says
`Authorization: Token <secret>` and any third-party consumer can authenticate from the catalog alone
— the consumer-agnostic contract holds.

The scheme is **generic**: any future provider using `Authorization: <Scheme> <token>` (e.g. `Token`,
`ApiKey`, a vendor scheme) reuses this and touches only `src/providers/**`.

## Alternatives Considered

### Alternative A: Compose `Token <token>` in the backend; MCP places it verbatim
- **Pros:** Zero core change — reuse `api_key` header with the pre-formed `Token …` value placed as-is.
- **Cons:** The published `authDescriptor` would say only "put this secret in a header" and omit the
  `Token ` scheme. The real recipe would live in xcale-backend, invisible to any other catalog
  consumer — and the backend would have to prepend a string to a secret it holds in plaintext, which
  it should not.
- **Why rejected:** Fails the consumer-agnostic litmus test and leaks provider knowledge to one
  consumer — the exact coupling the server exists to prevent (same rejection as ADR 0018 Alt A).

### Alternative B: A new `token` auth variant in the descriptor union
- **Pros:** Explicit; mirrors how `bearer` is its own case.
- **Cons:** Scheme proliferation — the next non-standard scheme (`ApiKey`, `TOK`, …) would each need
  its own variant. Less general than parameterizing the prefix once.
- **Why rejected:** An optional `scheme` on the existing `api_key` header path covers all of them with
  one additive field, at lower surface.

### Alternative C (accepted): Optional `scheme` prefix on `api_key` header placement
- **Pros:** Single-secret runtime unchanged; provider knowledge stays in the MCP (litmus passes);
  generic to any `Authorization: <Scheme> <token>` provider for free; additive and byte-safe for
  existing providers.
- **Why accepted:** Honors both the single-secret invariant and the consumer-agnostic contract at
  minimal, well-scoped cost, and generalizes cleanly.

## Consequences

### Positive
- Dentalink (and any future `Authorization: <Scheme> <token>` provider) is expressible with a truthful
  catalog entry.
- The change is additive and mechanically safe: existing auth branches are byte-unchanged, and
  `assertNever` guarantees the new behavior is implemented before it can ship. A mutation test asserts
  that dropping the `scheme` prefix turns a test red.
- `forwarded` delivery and `SecretString` redaction are reused unchanged.

### Negative
- **The golden rule is intentionally broken:** onboarding Dentalink touches `src/core/auth` (and
  `src/core/provider-port.ts`), not only `src/providers/**`. This ADR is the required justification.
  Future scheme-prefixed providers reuse it and touch only `src/providers/**` again.
- The token rides in a header, so — unlike Toteat's URL credential — there is no query-string leak
  surface; but the token must still never appear in logs, errors, or tool results (the existing
  redaction control covers it). HTTPS is mandatory (Dentalink requires it).

### Neutral
- The `authDescriptor` `api_key` variant gains an optional published `scheme` field — an additive
  public-contract surface, evolved per the additive-versioning ADR.
- `bearer` remains its own variant rather than being refolded into "`api_key` header with
  `scheme: 'Bearer'`" — kept untouched to stay additive and byte-safe (prove-don't-pre-abstract).

## References

- Related ADRs: [basic-http-auth-scheme](0018-basic-http-auth-scheme.md) (the direct precedent),
  [credential-delivery-strategies](0010-credential-delivery-strategies.md),
  [provider-knowledge-vs-credential-custody](0004-provider-knowledge-vs-credential-custody.md),
  [canonical-provider-pattern](0009-canonical-provider-pattern.md),
  [additive-contract-versioning](0001-additive-contract-versioning.md)
- Code anchors: `src/core/auth/authentication-materializer.ts` (single-secret `api_key` header path +
  `assertNever` default), `src/core/provider-port.ts` (`ProviderAuthDescriptor` `api_key` variant),
  `src/providers/toteat/auth.ts` (the `api_key` + `forwarded` precedent)
- Design: `docs/design/dentalink-provider/feature-design.md` § AD-3, Q-1
- Provider docs: Dentalink API authentication — https://api.dentalink.healthatom.com/docs/
