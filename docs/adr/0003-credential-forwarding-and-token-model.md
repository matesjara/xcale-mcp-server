# ADR 0003: Credential forwarding & token model (backend → server)

- **Status:** Accepted. The architectural decision is made; what is bounded is its *scope of
  application* (see **Constraint**). The independent security review
  (`docs/security/credential-boundary-review.md`, 2026-06-19) found **no architectural blockers**;
  its control checklist is binding on the implementation.
- **Date:** 2026-06-19
- **Decision makers:** Juan José (design lead), xcale team
- **Tags:** auth, security, integrations, mcp

## Context

`xcale-mcp-server` is stateless w.r.t. auth: Rail A (in `xcale-backend`) stores provider
credentials encrypted at rest; the server receives a credential per `tools/call` and uses it to
call the external provider API. The mechanism resolved in the grill is the `X-Provider-Token`
request header carrying the **decrypted, real provider credential** (Hop A), distinct from the
Hop B shared secret that authenticates the backend to the server.

The red-team review raised a legitimate concern: forwarding the real credential means the server
*process* sees sensitive secrets in memory (and potentially in logs if any code path
misbehaves). MCP's security guidance flags "token passthrough" as an anti-pattern. That guidance
is primarily aimed at *identity tokens* forwarded with the wrong audience; our case is a
*deliberate delegation* of a provider access credential intended to be used against that exact
provider — related but not identical. Regardless of the framing, the operational risk is real
and the "discard immediately" guarantee is not mechanically enforceable by design alone.

This is the single highest-stakes boundary in the system and must not be consolidated silently.

## Decision

**Direct credential forwarding with mandatory safeguards.** xcale-backend forwards the decrypted
provider credential to the server per call via `X-Provider-Token`. The server uses it only for the
duration of the call and **never persists, caches, or logs it**. The following safeguards are
**part of the decision, not optional**: the `SecretString` credential firewall (redacted
serialization, `.reveal()` only at provider egress), enforced `pino` redaction of
`x-provider-token` + `authorization`, no `tools/call` request-body logging, error-reporting
scrubbing, TLS-only transport, and constant-time Hop B verification. (Full control checklist:
`docs/security/credential-boundary-review.md` §4.)

## Constraint (scope of application)

Direct forwarding is approved for **non-financial / standard-risk providers** (e.g. Nevatal).
Migrating to **ephemeral references / OAuth 2.0 Token Exchange (RFC 8693)** — where Rail A hands
the server a short-lived opaque reference instead of the long-lived credential — is **mandatory
before supporting any financial or high-risk provider** (e.g. ePayco, Siigo). This is a hard gate,
not a backlog item.

## Alternatives Considered

### Alternative A (proposed for MVP): Direct credential forwarding + guardrails
- **Pros:** Simplest. No extra round trip. No state on the server. Proportionate for the first
  non-financial provider (Nevatal). Matches the current Rail A reactive-reauth flow.
- **Cons:** Server sees the real credential. "Never logged" depends on discipline + redaction
  config, not architecture. Larger blast radius if the server is compromised.
- **Why chosen (scope-bounded):** acceptable for the MVP *with* the mandatory safeguards, but the
  risk profile is wrong for financial/high-risk providers — hence the Constraint.

### Alternative B (planned evolution): Ephemeral reference / token exchange (RFC 8693)
- **Pros:** The server never receives the long-lived credential — eliminates the passthrough
  concern. Short TTL limits blast radius. Stays effectively stateless (in-memory ~60s cache).
- **Cons:** One extra round trip on first call; an in-memory resolution cache (mild state); more
  moving parts (signing, TTL, clock skew).
- **Why deferred (not rejected):** the right destination, but premature to build before a real
  provider and a security review define the exact mechanism.

### Alternative C (rejected): Server-owned credential custody (DB + refresh)
- **Pros:** Full Composio parity; credential never transits the backend hop.
- **Cons:** Two services storing secrets (more attack surface, not less); requires a DB +
  refresh workers; violates soul.md ("no credential storage / no always-on workers") and the
  stateless inversion.
- **Why rejected:** contradicts the core architectural inversion that keeps custody in the
  hardened, production-proven Rail A.

## Security review outcome (2026-06-19)

An independent design-level security review (`docs/security/credential-boundary-review.md`)
threat-modeled this boundary and found **no architectural blockers**. It established the governing
invariant **Credential-in-Transit-Only** (the server may process a credential in memory for one
invocation, but must never persist it to DBs, queues, persistent caches, or logs) and validated it
across logs, APM/tracing, error reporting, metrics, memory/dumps, and HTTP middleware. Binding
conditions for acceptance:

1. **`SecretString` credential firewall** — token wrapped in a branded type whose `toJSON`/
   `toString`/`inspect` return `"[REDACTED]"`; `.reveal()` only inside `src/providers/**`
   (CI-greppable); serialization tests prove redaction.
2. `pino` `redact` covers `x-provider-token` + `authorization` + `cookie`; no `tools/call`
   request-body logging.
3. Error-reporting `beforeSend` scrubber strips the credential; never in `Error` messages.
4. OTel header capture for these headers left disabled; credential never a metric label.
5. Hop B: constant-time compare + documented rotation policy; `X-Provider-Token` rejected on
   non-`tools/call` endpoints.
6. TLS-only, header-only credential, provider-cert verification on egress; heap dumps restricted.
7. **Hard gate:** migrate to ephemeral references / token exchange (RFC 8693) **before the first
   financial provider (ePayco/Siigo).**

These conditions are verified later by the code-level `/security-review` against the implementation.

## Consequences

### Positive
- MVP can ship and prove the end-to-end boundary without building token exchange first.
- The risk is named, bounded, and scheduled for remediation rather than hidden.

### Negative
- A real (if guardrailed) credential-exposure surface exists on the server until Alternative B
  lands. Reversing the MVP choice later means implementing token exchange on both sides.

### Neutral
- The server owns a strict no-log / no-persist obligation for `X-Provider-Token`, enforced in the
  transport layer (`src/auth/token.ts`, `pino` redact config) — not left to per-adapter code.

## References
- Architecture review: `docs/architecture-review.md` §7
- Foundation: `docs/foundation.md` §8 (auth model), Q-1, Q-11
- Related ADRs: [stateless-gateway-and-thin-acl](0005-stateless-gateway-and-thin-acl.md), [provider-knowledge-vs-credential-custody](0004-provider-knowledge-vs-credential-custody.md)
- External: MCP security best practices (token passthrough); RFC 8693 (OAuth 2.0 Token Exchange)
- Backend re-auth flow this integrates with: `xcale-backend/docs/adr/0005-native-connection-reauth-lifecycle.md`
