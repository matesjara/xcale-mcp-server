# ADR 0022: Credential-less providers — the `none` auth variant

- **Status:** Proposed
- **Date:** 2026-10-14
- **Decision makers:** Mateo
- **Tags:** auth, integrations, mcp, core

## Context

Profitroom (first tenant: La Pausa Hotelbistró) is the first provider whose external API needs
**no secret at all**. Its hotel booking engine answers rooms, offers, a calendar and live priced
availability on an unauthenticated JSON API (`https://booking.profitroom.com/api/<hotelKey>/…`,
verified live on 2026-10-14). The only thing that identifies the target hotel is its public
booking-engine URL (e.g. `https://booking.profitroom.com/es/hotellapausa`), which anyone can read.

Today every provider has a credential. `ProviderAuthDescriptor` admits only `api_key | bearer`,
`basic`, `oauth2` and `credential_exchange` (`src/core/provider-port.ts:16-75`), and every
`tools/call` runs the Credential Resolution phase and then Authentication Materialization, whose
first statement reveals the secret (`src/core/auth/authentication-materializer.ts:25`). When no
`X-Provider-Token` arrives, the server wraps an empty string (`src/auth/token.ts:9`), so a
credential-less provider would "work" today only by accident.

Two forces collide:

- **Provider Self-Containment.** Onboarding a provider should touch only `src/providers/**`. A
  credential-less provider cannot be expressed truthfully without a core change.
- **Honest contract.** The catalog is a public, consumer-agnostic contract. Whatever it says about
  auth must be true, so a consumer can derive the connect flow from it alone.

We are deciding now because the read-only Profitroom provider (xcale-mcp-server#142) is being
designed, and its auth shape determines both this repo's core and the consumer's (Rail A) connect
flow (xcale-backend#1599).

## Decision

Add an **additive `none` variant** to `ProviderAuthDescriptor` — `{ type: 'none' }`, with no
fields and no `credentialDelivery`. It means _this provider's API takes no credential_; whatever
identifies the target account is **non-secret routing data** carried in `X-Provider-Metadata` and
validated by the provider's `contextSchema` (for Profitroom, `bookingEngineUrl`).

Runtime consequences, all confined to the existing exhaustive switches:

- **Materialization:** a `none` descriptor returns the request with no auth applied **before** the
  reveal line, so it never calls `.reveal()`. The single reveal statement stays where it is (the
  credential-boundary CI grep is per file and unaffected), and the early return narrows `none` out of
  the switch, so `assertNever` stays exhaustive with no unreachable case. The variant declares
  `credentialDelivery?: never` so `auth.credentialDelivery` (read in `src/protocol/mcp-server.ts:85`)
  stays valid on the union without touching the protocol layer.
- **Credential Resolution:** unchanged. A `none` provider resolves like `forwarded`; whatever
  arrives in `X-Provider-Token` (normally nothing) is wrapped, ignored and never revealed.
- **Conformance:** `case 'none'` has nothing to assert beyond the existing serializable-data check.
- **Catalog:** publishes `{ type: 'none' }`. The consumer reads it as "collect only the
  `contextSchema` fields; store no secret; send no `X-Provider-Token`".

## Alternatives Considered

### Alternative A: Dress the public identifier up as an `api_key`

- **Pros:** Zero core change. The hotel key travels in `X-Provider-Token`; the provider reads it.
- **Cons:** A public identifier gets encrypted, redacted and called a "credential". The catalog
  lies about the provider's auth, and the consumer's connect form asks for an "API key" the hotel
  does not have. It also blurs Hop A (credentials) with routing data, which the glossary keeps apart.
- **Why rejected:** Fails the honest-contract force and contradicts `CONTEXT.md` (`X-Provider-Token`
  is for credentials, `X-Provider-Metadata` for routing data).

### Alternative B: Make `auth` optional on the provider

- **Pros:** No new variant name; "absent" reads as "no auth".
- **Cons:** Every consumer of `provider.auth` gains an `undefined` branch outside the exhaustive
  switches, so the compiler stops forcing each path to handle the case. An absent field is also
  ambiguous on the wire (forgotten vs. intentional).
- **Why rejected:** Loses the closed-vocabulary enforcement (`assertNever`) that every other auth
  shape relies on.

### Alternative C (accepted): Additive `none` variant

- **Pros:** Truthful catalog; compile-forced handling in every switch; no new infrastructure; any
  future credential-less provider reuses it and touches only `src/providers/**` again.
- **Why accepted:** The smallest change that keeps both the honest contract and the exhaustive
  auth vocabulary.

## Consequences

### Positive

- Credential-less providers are expressible, and the catalog tells consumers exactly what to collect.
- Additive and mechanically safe: existing branches are untouched in behavior; `assertNever`
  forces the new variant to be handled everywhere before it can ship.
- The secret-reveal surface shrinks: a `none` call never reveals anything.

### Negative

- **The golden rule is intentionally broken once:** Profitroom touches `src/core`. This ADR is the
  justification; the core change ships as its own PR ahead of the provider.
- **Unauthenticated does not mean unprotected.** A `none` provider fetches from an external host
  using consumer-supplied routing data. A provider whose routing data is URL-shaped must **parse**
  it against a fixed allowlist and build every request from its own fixed base. It must never fetch
  the supplied value (SSRF). This is a provider-level rule this variant makes reachable.
- The consumer (Rail A) must support a connection that holds no secret: a new connect-flow branch
  in xcale-backend.

### Neutral

- The `authDescriptor` union gains a published `none` variant, an additive public-contract change
  under the additive-versioning ADR.
- A credential-less API is usually an _undocumented_ one (Profitroom's is internal to its booking
  engine). Drift detection and fail-closed behavior are the provider's responsibility, not this
  variant's.

## References

- Related ADRs: [provider-knowledge-vs-credential-custody](0004-provider-knowledge-vs-credential-custody.md), [credential-delivery-strategies](0010-credential-delivery-strategies.md), [basic-http-auth-scheme](0018-basic-http-auth-scheme.md), [additive-contract-versioning](0001-additive-contract-versioning.md), [canonical-provider-pattern](0009-canonical-provider-pattern.md)
- Code anchors: `src/core/provider-port.ts:16-75` (`ProviderAuthDescriptor`), `src/core/auth/authentication-materializer.ts:18-66` (reveal + exhaustive switch), `src/core/credential/credential-resolver.ts:33-49` (resolution dispatch), `src/core/testing/provider-conformance.ts` (auth conformance switch), `src/auth/token.ts:8-10` (absent token → empty `SecretString`)
- Glossary: `CONTEXT.md` › Credential-less provider, Booking-engine URL
- Design: [profitroom-read-only-provider](../design/profitroom-read-only-provider/feature-design.md)
