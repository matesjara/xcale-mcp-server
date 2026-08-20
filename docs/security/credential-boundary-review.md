# Security Review — Credential Boundary (Hop A token forwarding)

> **Type:** Independent design-level security review (threat model). **No runtime code exists
> yet** — this reviews the *design* in [credential-forwarding-and-token-model](../adr/0003-credential-forwarding-and-token-model.md)
> and `../architecture-review.md` §7. It is also the **binding control checklist** that the later
> code-level security scan (the `/security-review` skill, run against the implementation diff)
> must verify.
> **Date:** 2026-06-19 · **Scope:** the backend → server → provider credential path.
> **Gates:** the credential ADR's acceptance (now Accepted, with a scope constraint).

---

## 0. The governing principle (explicit decision)

> **Credential-in-Transit-Only.** `xcale-mcp-server` MAY process a provider credential **in
> memory for the duration of a single invocation**. It MUST NOT deliberately persist or store it
> in databases, queues, persistent caches, or logs. This is a hard architectural invariant, not
> a guideline.

This principle must be validated to hold across **every** surface where data can escape a
process, not just the database:

| Surface | Default risk | Required control |
|:--|:--|:--|
| Application logs (`pino`) | `pino-http` can serialize whole `req` incl. headers | `redact: ['req.headers["x-provider-token"]', 'req.headers.authorization', 'req.headers.cookie']`; never log request bodies of `tools/call` |
| APM / tracing (OTel) | OTel does **not** capture HTTP headers by default ✅ | Do **not** enable `OTEL_INSTRUMENTATION_HTTP_*_CAPTURE_*_HEADERS` for these headers; add a Collector attributes/redact processor as defense-in-depth |
| Error reporting (Sentry/equivalent) | SDKs may attach request context incl. headers | `beforeSend` scrubber strips `x-provider-token`/`authorization`; never put the token in an `Error` message or `cause` |
| Metrics | Low (aggregates) | Never use a credential as a label/dimension/tag |
| Memory dumps / diagnostics | Heap dumps capture in-flight strings | Disable on-demand heap dumps in prod; restrict `--inspect`; treat dumps as secret |
| HTTP middleware (Fastify hooks, proxies) | Middleware may log/forward full requests | Audit every `onRequest`/`preHandler`; no request-logging middleware that serializes headers |

---

## 1. Threat model

**Assets:** (A1) the user's provider credential (Hop A, `X-Provider-Token`); (A2) the Hop B
service secret; (A3) the provider data reachable with A1.

**Trust boundaries:** TB1 backend → server (network, Hop B); TB2 server → provider API (Hop A);
TB3 server → observability sinks (logs/APM/errors/metrics).

**Adversaries:** external network attacker; a compromised observability/log sink; a malicious or
buggy adapter; an insider with prod log/dump access; a compromised server instance.

**STRIDE focus for this boundary:**

| Threat | Vector | Verdict |
|:--|:--|:--|
| **Information disclosure** | Credential leaks via logs/APM/errors/dumps (TB3) | **Primary risk** — fully mitigable with controls (§0) |
| **Spoofing** | Forged backend calls (TB1) | Mitigated by Hop B; strengthen with rotation/JWT |
| **Tampering / Replay** | Captured request replayed (TB1/TB2) | Low under TLS; static shared secret is the weak point (§2.3) |
| **Elevation / lateral** | Compromised server reuses long-lived creds | **Residual** — bounded by ephemeral references (§2.5) |
| **Repudiation** | Provider audit shows server identity, not user | Accepted trade-off of delegation; documented |

---

## 2. Findings

### 2.1 Information disclosure via observability (Severity: High → Mitigable) — primary finding

The credential transits the server process and is reachable by any code that serializes the
request or an object holding the token. Discipline ("we won't log it") is **not** an enforceable
control. **Required control — a mechanical "credential firewall":**

- Wrap the token in a **branded `SecretString` type** whose `toJSON()`, `toString()`, and
  `util.inspect.custom` all return `"[REDACTED]"`. `.reveal()` is called at exactly ONE point — the
  core **Authentication Materialization** step (`src/core/auth/authentication-materializer.ts`), which
  turns the resolved credential into a plain `HttpRequest`; adapters never see the secret (ADR:
  credential-delivery-strategies). This makes accidental serialization into logs, JSON error
  bodies, APM object captures, and `console`/`pino` output **return redaction by construction** —
  turning a discipline problem into a type-level guarantee.
- Plus the per-surface controls in §0 (pino `redact`, Sentry `beforeSend`, no header capture in
  OTel, no request-body logging).
- **Verification (later code scan):** a test asserting `JSON.stringify(ctx)` and the logger output
  never contain a known token value; grep CI gate forbidding `.reveal()` outside **two** greppable
  sites (tests excluded): `src/core/auth/authentication-materializer.ts` (reveals the **credential**
  at egress) and `src/core/credential/reference-resolver.ts` (reveals the non-secret **reference
  nonce** to resolve it — a single-use pointer, not a credential).

**Not a blocker** — the design supports these controls; they are implementation obligations.

### 2.2 Memory lifecycle (Severity: Medium → Residual)

The token lives in request scope and is GC-eligible after the call. **Caveat:** V8 strings cannot
be reliably zeroed, so a heap dump *during* the in-flight window could expose it. Controls:
no global/closure capture of the token; no in-memory cache of the raw token (the ephemeral-
reference model in §2.5 caches a *reference*, resolved per call, not stored long-term); disable
on-demand heap dumps in prod. **Residual risk is the strongest argument for §2.5 for high-value
credentials.** Not a blocker for MVP/non-financial.

### 2.3 Replay & Hop B (Severity: Medium)

Under enforced TLS, in-transit capture/replay is low. The weak point is the **static shared
secret** (Hop B): it doesn't rotate automatically and a replayed request within the trust zone
would authenticate. Controls: TLS-only (HSTS); constant-time secret comparison; **documented
rotation policy** (Doppler swap + rolling restart); reject any request carrying
`X-Provider-Token` on `server/discover`/`tools/list` (only `tools/call` may carry it); request
size limits; rate limiting. **Hardening path:** evolve Hop B to a short-lived signed JWT
(`exp`+`nonce`) — tracked in the Hop B ADR, not a v1 blocker.

### 2.4 Malicious/buggy adapter exfiltration (Severity: Medium)

An adapter receives the token and could, in principle, send it anywhere. Controls: adapters are
first-party, code-reviewed, and isolated (no cross-provider imports); the `.reveal()` call site is
CI-greppable; outbound egress is to the declared provider host only (consider an egress allowlist
per provider as future hardening). Acceptable for first-party adapters in MVP.

### 2.5 Need to evolve to ephemeral references (Severity: Decision)

The direct-forwarding model means the server holds a **usable, possibly long-lived** credential
each call. For **financial providers (ePayco/Siigo)** the blast radius of a compromised server is
unacceptable. **Decision: a hard gate** — before the first financial provider goes live, migrate
to **ephemeral references / OAuth 2.0 Token Exchange (RFC 8693)**: Rail A hands the server a
short-lived, single-purpose opaque reference; the server resolves it to the real credential just-
in-time (≤60s in-memory), so it never holds a long-lived secret. This keeps the server
effectively stateless and removes the passthrough concern.

### 2.6 TLS & channel hardening (Severity: Low, standard)

DO App Platform enforces HTTPS. Require: TLS 1.2+; HSTS; no credential ever in URL/query string
(header only); reject plaintext; verify the provider's TLS cert on the Hop A egress (no disabled
verification).

---

## 3. Verdict

**No architectural blockers.** The credential boundary design is **sound for the MVP scope
(non-financial providers, e.g. Nevatal)** provided the controls below are implemented and
verified. The primary risk (observability leakage) is fully mitigable, and the strongest
residual (long-lived credential in a compromised server) is bounded by a committed evolution to
ephemeral references before financial providers.

**Outcome:** the ADR is **Accepted** — the architectural decision stands; what is bounded is its
*scope of application* (the §4 constraint: ephemeral references / token exchange before any
financial or high-risk provider). The §4 controls are **binding on the implementation** and are
verified later by the code-level review against the diff.

---

## 4. Binding acceptance conditions (verified later against the implementation)

1. **`SecretString` credential firewall** implemented; `.reveal()` only inside the two greppable
   sites — `src/core/auth/authentication-materializer.ts` (the credential egress point) and
   `src/core/credential/reference-resolver.ts` (unwraps the non-secret reference nonce); tests
   excluded; serialization tests prove redaction.
2. **`pino` `redact`** covers `x-provider-token`, `authorization`, `cookie`; **no `tools/call`
   request-body logging.**
3. **Error reporting `beforeSend`** scrubber strips the credential; token never in `Error`
   messages.
4. **OTel** header capture for these headers left **disabled**; no credential used as a
   metric label.
5. **Hop B**: constant-time compare; documented rotation policy; `X-Provider-Token` rejected on
   non-`tools/call` endpoints.
6. **TLS-only**, header-only credential, provider-cert verification on egress.
7. **Heap dumps disabled/restricted** in prod.
8. **Documented gate:** ephemeral references / token exchange (§2.5) **before the first financial
   provider.**

---

## 5. References

- ADR gated by this review: [credential-forwarding-and-token-model](../adr/0003-credential-forwarding-and-token-model.md)
- Architecture review: `../architecture-review.md` §7 · Foundation: `../foundation.md` §8, Q-1/Q-11
- Backend re-auth flow consumed on 401/403: `xcale-backend/docs/adr/0005-native-connection-reauth-lifecycle.md`
- External: MCP security best practices (token passthrough); RFC 8693 (Token Exchange);
  [Fastify logging / pino redact](https://fastify.dev/docs/latest/Reference/Logging/);
  [Pino redacting secrets](https://blog.lepape.me/nodejs-best-practices-redacting-secrets-from-pino-logs/);
  [Sentry scrubbing sensitive data](https://docs.sentry.io/platforms/javascript/data-management/sensitive-data/);
  [Sanitizing headers in OpenTelemetry spans](https://oneuptime.com/blog/post/2026-02-06-sanitize-http-headers-opentelemetry-spans/view)
