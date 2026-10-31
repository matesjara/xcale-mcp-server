# ADR: `credential_exchange` reads a nested token and declares its lifetime

- **Status:** Proposed
- **Date:** 2026-10-30
- **Decision makers:** CTO (the `architect` agent, ADR 0005 of the xcale layer), Sara Estrada
- **Tags:** auth, contract, catalog, integrations, mcp
- **Amends:** [credential-delivery-strategies](0010-credential-delivery-strategies.md), the `credential_exchange` variant only

## Context

[credential-delivery-strategies](0010-credential-delivery-strategies.md) introduced `credential_exchange`. A provider declares it, and Rail A (the Credential Authority, in xcale-backend) runs the mint generically from that declaration: it POSTs the durable credential to `tokenEndpoint` and reads `responseFields.token` and, optionally, `responseFields.expiry` from the JSON answer. The variant is **strictly declarative**, and CONTEXT.md names what that excludes: no hooks, templates, expressions, signing or JSON-path. Siigo and Erbon fit: each returns its token and expiry as top-level keys.

Avirato (`docs/design/avirato-provider/`, #189) does not fit, on two counts. Both were observed against its production API on 2026-10-30.

1. **The token is nested.** `POST /v3/token/login` answers `201 { "status": "success", "data": { "token": "…", "web_codes": [ … ] } }`. Rail A reads `json[responseFields.token]` (xcale-backend `src/modules/connections/credential-exchange.ts:99`), a top-level key, so it finds no token and every Avirato mint fails.
2. **The token states no lifetime.** The response has no expiry, although Avirato's OpenAPI marks `data.expiry` required, and the JWT (HS256) carries only `securityCode` and `iat`, no `exp`. Rail A reuses a cached token only while `expiresAt` is in the future (`credential-resolve.service.ts:79-81`). With no `expiresAt` it mints on **every** `tools/call`.

Minting on every call costs more than latency. Avirato allows 600 requests per 5 minutes per IP (`X-RateLimit-Limit: 600`, observed), shared by every tenant behind our egress, so one login per call roughly halves the budget. And **a second login invalidates the first token** (observed): two calls minting at once break each other.

The descriptor is a published contract: it reaches every consumer through `server/discover`. A way to express both facts is therefore a decision about that contract, recorded here, not something a provider absorbs on its own.

## Decision

The `credential_exchange` variant gains two **additive, declarative** capabilities.

1. **`responseFields.token` and `responseFields.expiry` accept a closed dotted key path.** The grammar is object keys of `[A-Za-z0-9_]` joined by `.` (`data.token`). There are no indices, wildcards, filters or escapes. A path that does not resolve to a non-empty string token is a mint with no token, exactly as a missing top-level key is today. A key without a dot is a path of length one, so Siigo and Erbon read as before.
2. **An optional `tokenTtlSeconds`** (a positive integer). When the mint response carries no usable expiry, the consumer treats the token as valid for that many seconds from the mint. A declared or parsed expiry, when present, wins. Avirato declares `responseFields: { token: 'data.token' }` and `tokenTtlSeconds: 900`.

**What the consumer owes** (xcale-backend, in its own PR, linked to this one, provider before consumer):

- resolve the path;
- apply the TTL when no expiry was read;
- mint at most one token at a time per connection (single-flight). A provider whose second login revokes the first is otherwise unusable under concurrency, and minting one at a time costs any other provider nothing.

The descriptor states the facts; the consumer owns the cache and the mint, as ADR 0010 already says.

## Alternatives Considered

### Alternative A: an envelope field (`responseEnvelope: 'data'`)

- **Pros:** No path grammar at all.
- **Cons:** It is a second mechanism for the same thing, and it covers one level of nesting only. The next provider that nests twice reopens this ADR.
- **Why rejected:** A closed path covers token and expiry with one rule and stays as declarative as a key.

### Alternative B: a general JSON-path (or JMESPath) expression

- **Pros:** It covers any shape.
- **Cons:** It is an expression language inside a descriptor that ADR 0010 made data-only. Rail A would interpret an expression language for a provider's benefit, which is the "config-DSL / interpreter" CONTEXT.md warns against.
- **Why rejected:** Avirato needs keys joined by dots, nothing more. Complexity on demand.

### Alternative C: reuse until rejected (no declared lifetime)

- **Pros:** It uses the token's real lifetime, whatever it is, with no constant to tune.
- **Cons:** It needs a new signal between the repos: a data call's 401 would have to reach Rail A and clear the cached token, and xcale-backend has no such path today (`markConnectionAuthFailure` marks the connection, it does not re-mint). The signal is a protocol change of its own.
- **Why rejected now:** A declared window is correct whatever the true lifetime turns out to be, and it costs one field. If the sandbox spike shows the window is not enough, this alternative becomes its own ADR and a `cto-mission` issue.

### Alternative D (accepted): a closed key path and a declared TTL

- **Pros:** Additive and data-only (the descriptor still survives the conformance suite's JSON round trip). Existing providers are untouched. It bounds the logins to one per connection per window, and it bounds how long a revoked token keeps failing calls.
- **Cons:** The TTL is a constant we choose, not Avirato's truth. Too long, and calls fail with a token Avirato has already expired; too short, and we mint more than needed. Fifteen minutes sits well inside both risks until the spike measures the real lifetime.
- **Why accepted:** It is the smallest declarative change that makes a real provider work, and it extends to the next provider with the same shape.

## Consequences

### Positive

- Avirato, and any later provider that nests its token or omits its lifetime, mints through the same generic Rail A path. No provider code runs in the consumer.
- The descriptor stays pure data: the conformance suite validates the path grammar and the TTL's range, and the round-trip check still holds.

### Negative

- The `credential_exchange` vocabulary grows by one grammar and one field, published in the catalog. It evolves additively from here; removing either is a breaking change.
- The TTL can be wrong in either direction until the provider's real lifetime is measured. That measurement is part of the provider's spike, not of this decision.
- The consumer must implement path resolution, the TTL fallback and single-flight minting before any provider declares them. Until it ships, a descriptor that uses them mints, and works, only after the backend PR lands.

### Neutral

- CONTEXT.md's `credential_exchange` entry is rewritten: the closed dotted key path is allowed, general JSON-path still is not.

## References

- Amends: [credential-delivery-strategies](0010-credential-delivery-strategies.md)
- Related feature design: `docs/design/avirato-provider/feature-design.md` (AD-2, R-1, R-6)
- CTO records: matesjara/xcale-mcp-server#189, comments of 2026-10-30
- Code anchors: `src/core/provider-port.ts` (the variant), `src/core/testing/provider-conformance.ts` (its checks); xcale-backend `src/modules/connections/credential-exchange.ts:99` and `src/modules/connections/credential-resolve.service.ts:79-81`
