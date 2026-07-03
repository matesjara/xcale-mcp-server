# ADR: Credential delivery strategies and the credential-resolution phase

- **Status:** Accepted
- **Date:** 2026-07-02
- **Decision makers:** Juan José (design lead), xcale team
- **Tags:** auth, security, integrations, mcp

## Context

The [credential-forwarding-and-token-model](credential-forwarding-and-token-model.md) ADR accepted
**direct credential forwarding** (`X-Provider-Token` carries the decrypted provider credential; the
Execution Engine uses it and discards it) **with a scope constraint**: it is approved for
non-financial / standard-risk providers (Nevatal, Cloudbeds) only, and a **hard gate** requires
migrating to *ephemeral references / OAuth 2.0 Token Exchange (RFC 8693)* — "Alternative B" of that
ADR — **before the first financial or high-risk provider (ePayco, Siigo)**. That was named as a hard
gate, not a backlog item.

Siigo (Colombian electronic invoicing / accounting) is now the **first financial provider** being
onboarded, so the gate is due. Siigo also forces a credential *shape* the current model never had:

- **Two distinct credentials.** The durable secret is `username + access_key` (does not expire until
  rotated — the "crown jewel"). The usable secret is a **24h JWT** minted from it via
  `POST /auth`. Every call also requires a non-secret `Partner-Id` header.
- The durable secret must **never** leave Rail A. But *something* must mint the JWT, and whoever
  mints needs the durable secret — so **minting stays in Rail A**, and the server must obtain a
  usable credential another way.
- The existing `authDescriptor` variants (`api_key | bearer | oauth2`) cannot describe a
  "exchange these fields for a short-lived token" flow, and the existing forwarded model would put a
  reusable credential (the JWT) in the server's memory/logs each call.

The decision the gate demands: **how does a financial provider's credential reach the Execution
Engine such that the server never holds a reusable credential — without adding infrastructure,
without moving custody off the hardened Rail A, and without weakening the gate to "just short-lived
enough"?**

## Forces

- **Custody stays in Rail A** ([provider-knowledge-vs-credential-custody](provider-knowledge-vs-credential-custody.md)) — a second service storing secrets is more attack surface, not less.
- **Blast radius** — a compromised Execution Engine must not yield a reusable provider credential.
- **Consumer-agnostic** ([consumer-agnostic-contract](consumer-agnostic-contract.md)) — no consumer/tenant identity on the wire or in the catalog.
- **Stateless Execution Engine** ([stateless-gateway-and-thin-acl](stateless-gateway-and-thin-acl.md)) — it receives a credential per call and discards it; it never reads a credential store.
- **Complexity on demand** — no new infrastructure (Redis, workers) without a demonstrated need.
- **Provider Self-Containment** — onboarding a provider must not scatter per-provider `if`s across the core, protocol, or a consumer.

## Decision

Introduce **exactly two credential delivery strategies — `forwarded` and `reference`** — declared per
provider on its `authDescriptor` and dispatched through a single **Credential Resolution phase**. A
`CredentialResolver` has two implementations (`ForwardedCredentialResolver` = near-identity, wraps the
`X-Provider-Token` value; `ReferenceCredentialResolver` = Hop-B callback) that both yield a uniform
`ResolvedCredential`; from that point the pipeline is byte-for-byte identical, so the strategy lives at
one swappable point (`resolvers[provider.auth.delivery].resolve()`), never a runtime `if`. For
`reference`, the **Credential Authority** (Rail A) sends a **single-use, ≤60s, opaque nonce that points
to a connection**; the **Execution Engine** (server) resolves it just-in-time via a Hop-B-authenticated
`POST /internal/credentials/resolve`, receives a usable credential (for Siigo, a freshly minted or
reused 24h JWT), uses it for the request scope only, and discards it. Rail A remains the sole custodian
and encapsulates the mint/reuse/refresh policy (it caches the 24h JWT and re-mints near expiry); **no
new infrastructure** — the reference lives in Rail A's existing Mongo with a TTL index. The
provider-auth knowledge Rail A needs to mint is expressed as a new, **strictly declarative**
`credential_exchange` `authDescriptor` variant. This **implements the architectural form** of the
parent ADR's Alternative B — opaque references and just-in-time resolution — while intentionally
**deferring** a standards-compliant RFC 8693 exchange *protocol*; it does not amend or weaken the
parent. The first consumer of the reference model is intentionally limited to **read-only** operations,
so the credential-delivery architecture is validated **independently from irreversible fiscal
operations** (Siigo).

```text
                        Provider
                           │
                  credentialDelivery
                           │
             ┌─────────────┴─────────────┐
          forwarded                   reference
             │                           │
      ForwardedResolver          ReferenceResolver
             │                           │
             │                   Credential Authority   ◀── mint / reuse / refresh
             │                           │                   (Rail A; owns custody)
             └────────────┬──────────────┘
                          ▼
                  ResolvedCredential      ◀── the convergence boundary
                          │
                   Provider Runtime       ◀── identical from here on
```

`ForwardedResolver` and `ReferenceResolver` are the abstraction; **how** `ReferenceResolver` reaches
the Credential Authority (today a Hop-B `POST /internal/credentials/resolve`) is a replaceable
implementation detail, not part of the boundary — see the invariants below.

## Alternatives Considered

| Alternative | What the server holds | Verdict |
|:--|:--|:--|
| A — forward `username+access_key` | the durable crown jewel (permanent) | ❌ rejected |
| B — forward the 24h JWT directly | a reusable credential, usable 24h | ❌ rejected |
| C — shared store (Redis) resolution | reads credentials from a shared store | ❌ rejected |
| **D — Hop-B callback resolution (C2)** | a per-call credential, discarded | ✅ **accepted** |
| E — full RFC 8693 token exchange | an opaque reference | 🕒 deferred |

### Alternative A: Direct forward of the durable credential
- **Pros:** Simplest; matches the forwarded model exactly.
- **Cons:** The Execution Engine sees the irrecoverable `username + access_key`; a compromised server has permanent blast radius until manual rotation.
- **Why rejected:** Exactly the exposure the hard gate exists to prevent, at its worst.

### Alternative B: Forward the minted 24h JWT
- **Pros:** The durable secret stays in Rail A; much less work than a resolution mechanism; the server only sees a self-expiring token.
- **Cons:** A 24h JWT is still a **reusable credential** — a captured `tools/call` is usable for 24h (read financial data, and with full-scope keys, write). It satisfies the *spirit* of the gate but not its *letter*, and sets a corrosive precedent ("this one only lasts 12h… 2h…") that erodes the gate over time.
- **Why rejected:** The governing question is not "is 24h secure enough?" but "may the Execution Engine receive a *reusable* credential at all?" The architectural answer is **no**.

### Alternative C: Shared reference store (Redis)
- **Pros:** Simple lookup; no extra round trip.
- **Cons:** New infrastructure (violates *complexity on demand*); worse, the Execution Engine reads a store that hands out credentials — operationally re-splitting custody the design keeps whole in Rail A.
- **Why rejected:** Reintroduces the custody boundary blur the whole model avoids, and adds infra.

### Alternative D (accepted): Hop-B callback resolution
- **Pros:** Zero new infrastructure (Rail A's existing Mongo TTL); the Execution Engine stays fully stateless and reads no store; custody stays 100% in Rail A; the wire contract is the same shape as RFC 8693, so the internal mechanism can harden later without a contract change; the server never holds a reusable credential — a captured reference is dead in ≤60s and single-use.
- **Cons:** One extra internal round trip per `tools/call` (mitigated: same region/infra; the reference is single-use and short-lived).
- **Why accepted:** The only option that honors the gate to the letter *and* every force above.

### Alternative E: Full RFC 8693 Token Exchange
- **Pros:** Standards-based; the eventual destination.
- **Cons:** Signing/TTL/clock-skew machinery is premature for a first financial provider; the callback model already yields the same security shape and wire contract.
- **Why deferred (not rejected):** D and E share the wire shape, so E is an internal hardening we can adopt later without re-cutting the boundary.

## Consequences

### Positive
- The hard gate is honored **to the letter** — the Execution Engine never receives a reusable credential — with no new infrastructure and no change to token custody.
- **Strategy is confined to the Credential Resolution phase**, not the provider runtime: an earned Strategy pattern (two real strategies exist today), not a scattered `if`.
- `forwarded` and `reference` **converge** at Provider Execution, so error handling, `SecretString` redaction, and pagination are shared unchanged.
- The model is reusable by every future financial provider (ePayco, …); Siigo is merely its first consumer.

### Negative
- One extra internal round trip per financial-provider `tools/call`.
- **Cross-repo:** the bulk of the new work is in **xcale-backend** — the `POST /internal/credentials/resolve` endpoint, a generic `credential_exchange` mint executor, the reference store (Mongo TTL), and strategy dispatch. Reversing this later means unwinding both repos.
- `authDescriptor` gains the `credential_exchange` variant — a published-contract surface to evolve additively.

### Neutral / new responsibilities & invariants
- **Rail A becomes the Credential Authority** (resolves references, owns mint/reuse/refresh), not merely a token store. The server is the **Execution Engine**.
- **`ResolvedCredential` is the convergence boundary.** The Credential Resolution phase always produces exactly one `ResolvedCredential`, and Provider Execution is defined **exclusively** in terms of it — never in terms of a delivery strategy, a token shape, or a transport. This is the single seam a future third strategy would have to satisfy.
- **The resolution transport is not part of the abstraction.** The abstraction is `CredentialResolver → Credential Authority`. The `POST /internal/credentials/resolve` Hop-B callback is the **first consumer's implementation** of that resolution; it can later become an RFC 8693 STS exchange, a SPIFFE/SVID handshake, a unix socket, or a sidecar **without** changing the `CredentialResolver` boundary or the wire contract. Do not treat the HTTP callback as the architecture.
- **Error-ownership boundary (invariant):** a `ProviderErrorCode`/`ToolResult` is emitted **iff the failure belongs to the provider domain** — determined by *who owns the cause*, not by phase or timing. A resolve-time **mint** failure because the durable credential was revoked is **provider-owned** → `PROVIDER_AUTH_EXPIRED` (even though no JWT ever existed and no data call ran). An **expired / consumed reference** or Hop-B failure is **transport-owned** → one transparent retry with a fresh reference, then a transport error; never a `ProviderErrorCode`, no `ToolResult`. This is an **additive clarification** to [typed-tool-result-error-contract](typed-tool-result-error-contract.md); it does **not** change the `ProviderErrorCode` set.
- **One resolution per `tools/call` (invariant):** one `ResolvedCredential`, request-scoped, reused across every provider egress in that call — a call never resolves multiple references.
- `credential_exchange` is **strictly declarative** (`tokenEndpoint`, `method`, `bodyFields`, `responseFields`, `staticHeaders`, `placement`) — no hooks/templates/expressions/signing. A provider needing *imperative* auth (HMAC/signing) does not extend this variant: it reopens *where the mint runs* and requires its own variant + a new ADR.
- **`Partner-Id`** is a non-secret institutional identifier (`source: deployment`), never in the published catalog — not custody.
- **Read-first** for the first financial consumer. The Siigo **write path (fiscal operations)** — confirmation, idempotency, duplicate detection, partial success, compensability — is out of scope here and gets **its own ADR**.

## References

- Parent (this implements the **architectural form** of its "Alternative B", deferring the RFC 8693 protocol itself): [credential-forwarding-and-token-model](credential-forwarding-and-token-model.md)
- Related ADRs: [provider-knowledge-vs-credential-custody](provider-knowledge-vs-credential-custody.md), [typed-tool-result-error-contract](typed-tool-result-error-contract.md) (additive clarification), [additive-contract-versioning](additive-contract-versioning.md), [three-pillar-mcp-contract-with-discovery](three-pillar-mcp-contract-with-discovery.md), [stateless-gateway-and-thin-acl](stateless-gateway-and-thin-acl.md), [canonical-provider-pattern](canonical-provider-pattern.md)
- Security review (binding controls): `docs/security/credential-boundary-review.md` §2.5
- Glossary terms: `CONTEXT.md` — Credential delivery strategy, Credential Resolution phase, Credential Authority, Execution Engine, Ephemeral reference, `credential_exchange`, Error-ownership boundary, Provider institutional identity
- Provider docs: Siigo API — https://developers.siigo.com/ (auth: `POST /auth` with `username`+`access_key` → 24h JWT; `Partner-Id` required on all calls)
