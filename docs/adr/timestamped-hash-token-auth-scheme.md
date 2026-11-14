# ADR: Timestamped hash token — the first imperative auth variant in the materializer

- **Status:** Accepted
- **Date:** 2026-11-09
- **Decision makers:** Sara (design), CTO (architect agent)
- **Tags:** core, auth, credentials, autocore
- **Number:** _unassigned (assigned at merge)_

## Context

Autocore Hotels (payment links for hotels — a financial provider, matesjara/xcale-mcp-server#188) authenticates with
one header computed from two secrets and the current time. Observed against Autocore Staging on 2026-11-09
(`docs/design/autocore-provider/sandbox-evidence.md` › Autenticación):

- `GET /v2/hotels` answers `200` only with
  `Auth-Token: base64(ascii(access_key + ";" + ts + ";" + sha256_hex(ascii(secret_key + ts))))`, where `ts` is the
  Unix time in whole seconds (10 digits). Autocore's documentation (Payment Gateways › Authentication) says a token is
  valid for 30 s.
- The two keys sent as plain headers (`access_key`, `secret_key`), no auth, a token built with a wrong secret, and a
  valid token sent to another environment all answer `401` with the same body. Keys are per environment.
- One tool call can make several HTTP requests: the connection probe pages `GET /v2/hotels`, and the status tool reads
  the status and then, when paid, a voucher.

What the core has today:

- **One reveal, one place.** `materialize()` (`src/core/auth/authentication-materializer.ts:19-83`) is the only
  `.reveal()` of a provider secret in the runtime (`:38`) and switches exhaustively over `ProviderAuthDescriptor`
  (`src/core/provider-port.ts:39-126`) with an `assertNever` default. Its variants (`none`, `api_key`/`bearer`,
  `basic`, `oauth2`, `credential_exchange`) all place a secret, or a token minted elsewhere, verbatim or Base64-framed.
  None computes anything from the secret.
- **Materialization runs per HTTP request.** The provider factory hands each handler a `request` executor that calls
  `materialize(...)` and then `sendRequest(...)` for every request the handler makes
  (`src/core/provider-factory.ts:126-132`), with one `ResolvedCredential` resolved once per `tools/call`. The
  transport does not retry (`src/core/http.ts`).
- **`CONTEXT.md` reserves this shape.** Authentication Materialization is "the swap point for a future imperative
  (signed-request) auth variant", and a provider needing imperative auth "does NOT extend" `credential_exchange` — it
  "requires its own variant + an ADR".
- **The credential is already decided** (grill D-3, feature design AD-1): both keys are secret, composed by the
  consumer into one credential `access_key:secret_key` (the WooCommerce `ck:cs` precedent, ADR 0018), delivered by
  `reference` (ADR 0003's hard gate for financial providers, ADR 0010).

## Decision

Add an additive auth variant, **`timestamped_hash_token`**, to `ProviderAuthDescriptor`, materialized in
`materialize()` — still the only reveal — freshly for every HTTP request.

1. **The recipe is fixed by the variant, not declared.** The variant means exactly: split the composed secret into
   `key` and `secret`; take `ts` = the current Unix time in whole seconds, as a decimal string; compute
   `digest = sha256(utf8(secret + ts))` as lowercase hex; emit `header: base64(utf8(key + ";" + ts + ";" + digest))`.
   No hash algorithm, digest encoding, separator, field order or time unit is a descriptor field. One provider uses
   this shape today; knobs with one value are a configuration DSL the core does not need (prove, don't
   pre-abstract). When a second provider differs in one knob, that knob is added as an optional field whose absence
   means today's value — additive, no change for Autocore.
2. **The descriptor declares what is data:** `header` (the header name; Autocore's is `Auth-Token`), `fields` (the two
   credential inputs, label-only, as `basic` does — their order is the composition order, `fields[0]:fields[1]`, and
   `fields[0]` is the key that travels in the token) and `credentialDelivery`. The catalog publishes it, so a consumer
   derives the connect form and the composition from the catalog alone (the consumer-agnostic litmus).
3. **The composed secret splits at its first `:`.** Everything before it is the key, everything after it the secret, so
   a secret containing `:` is preserved. A composed secret with no `:`, or with an empty part, fails closed before any
   request is sent, with a fixed message that carries no credential material.
4. **`ResolvedCredential` stays a single `SecretString`.** The two parts exist only inside `materialize()`, after its
   one reveal. No second reveal site, no richer credential shape, no change to the resolvers or the transport.
5. **The clock is injected.** `materialize()` takes the current time from a clock argument that defaults to the system
   clock; the provider factory passes a test seam beside `fetchImpl`. Nothing else in the variant reads time.
6. **`reference` delivery stays.** The 30 s window starts at materialization, after the reference is resolved, so the
   resolve latency (≤60 s reference TTL) never eats into the token's life, and each request in a multi-request call
   gets its own token.
7. **No provider name in the core.** The variant, its fields and its errors say nothing about Autocore.

## Consequences

### Positive

- Autocore is expressible with a truthful catalog entry and no secret outside the materializer: the single-reveal
  invariant, the CI-grep control on `.reveal()` and `Credential-in-Transit-Only` hold unchanged.
- Fresh-per-request comes for free from where `materialize()` already runs; a paged probe or a status-then-voucher
  read never sends a stale token.
- `assertNever` compile-forces the new branch; the existing branches stay byte-identical.

### Negative

- **Provider Self-Containment is broken on purpose, once.** Onboarding Autocore touches `src/core/auth/` and
  `src/core/provider-port.ts` (and the factory's clock seam). This ADR is the justification; the core change ships as
  its own commit with a "Touches the core" section, and `/implement` does not merge it alone (ADR 0017).
- **Time becomes an input to auth.** A server clock more than ~30 s off makes every Autocore call `401`, which the
  core maps to `PROVIDER_AUTH_EXPIRED` — the consumer would ask the tenant to reconnect when the fault is ours. App
  Platform hosts keep NTP time; we accept the risk and do not add skew detection.
- **The token is a bearer credential for its 30 s.** It carries the access key in clear (Base64) and is replayable
  within its window; it must be treated as secret material wherever a request could be logged.

### Neutral

- The published `authDescriptor` union gains `timestamped_hash_token` — an additive contract change (ADR 0001). The
  consumer's side, asked for in a consumer issue: **Rail A must recognize the variant, collect the two `fields` at
  connect, compose `fields[0]:fields[1]` (`access_key:secret_key`) into one stored credential, and resolve it through
  `reference`** — the same composition it does for `basic`. It computes nothing; the token is never the consumer's.
- `CONTEXT.md` gains a glossary entry for the variant, and its "swap point for a future imperative auth variant" line
  now names it.

## Binding test obligations

The core change does not merge without these tests, in isolation from any provider:

1. **Deterministic clock.** With the clock fixed, the header equals a fixed expected value; two requests at different
   fixed times carry different tokens; `ts` is whole seconds (a time with milliseconds truncates, never rounds).
2. **Parity with Autocore.** One vector is reproduced byte for byte: Autocore's documented example if its
   documentation publishes one with inputs and output; otherwise a vector computed independently of the
   implementation (a standard `sha256`/`base64` tool, inputs and command recorded beside the fixture), with the
   Staging `200` of 2026-11-09 as the recorded proof the recipe is Autocore's. Test keys are dummies, never real ones.
3. **The split.** A secret containing `:` round-trips; a composed secret with no `:` or an empty part throws before
   `fetch` is called, and the error message contains neither part.
4. **Never logged, never returned.** No log line, `ToolResult`, error message or thrown error carries the composed
   secret, either part, or the token — asserted with the redaction harness the other variants use.
5. **Per request.** A handler making two requests in one call materializes twice from one `ResolvedCredential`, each
   with the clock's value at that moment.
6. **No regression.** Every existing variant's materialization is unchanged (the current suite passes untouched).

## Alternatives considered

### B. The provider computes the token in its own client — rejected

It needs the secret outside the materializer: a second reveal, in provider code. That breaks the single-reveal
invariant `CONTEXT.md` and the credential-boundary review rest on, and every future signing provider would copy it.
Security outranks keeping the change out of the core.

### C. Rail A mints the token and the reference resolves to it — rejected

Rail A runs only declarative descriptors (`credential_exchange`) and cannot run imperative code without becoming an
interpreter (`CONTEXT.md` › `credential_exchange`). Worse, it is wrong in time: a token minted at resolve can be
seconds old before the first request, and one resolution per `tools/call` would reuse it across a paged probe or a
status-then-voucher read, against a 30 s life. It also moves provider knowledge (the recipe) into the consumer.

### D. An Autocore-specific variant (`type: 'autocore'`) — rejected

A per-provider branch in the core, which the architecture forbids (`if slug === …` in core). The recipe is a generic
shape; naming it by what it does costs nothing and lets a second provider reuse it.

### A′. A fully declared recipe (algorithm, encoding, separator, order, time unit as fields) — rejected

Generic on paper, but every knob has one value and one user, and the variant would grow into the configuration DSL
`CONTEXT.md` warns against. The fixed recipe plus optional knobs added when a second provider proves them keeps the
same reach at a fraction of the surface.

## References

- Related ADRs: [credential-forwarding-and-token-model](0003-credential-forwarding-and-token-model.md),
  [provider-knowledge-vs-credential-custody](0004-provider-knowledge-vs-credential-custody.md),
  [credential-delivery-strategies](0010-credential-delivery-strategies.md),
  [additive-contract-versioning](0001-additive-contract-versioning.md),
  [agentic-auto-merge-to-dev](0017-agentic-auto-merge-to-dev.md),
  [basic-http-auth-scheme](0018-basic-http-auth-scheme.md)
- Code anchors: `src/core/auth/authentication-materializer.ts:19-83` (the single reveal and the exhaustive switch),
  `src/core/provider-port.ts:39-126` (`ProviderAuthDescriptor`), `src/core/provider-factory.ts:126-132`
  (materialization per request), `src/core/credential/resolved-credential.ts` (single-secret `ResolvedCredential`)
- Evidence and design: `docs/design/autocore-provider/sandbox-evidence.md`, `grill-notes.md` (D-3),
  `feature-design.md` (AD-1, AD-2, R-1); matesjara/xcale-mcp-server#188
