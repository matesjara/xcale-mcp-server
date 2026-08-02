# Roadmap — accepted debt & deferred work

Where accepted-with-debt items live once a PR merges with known follow-ups. Each entry names the
source (PR / review), the concrete risk, and the trigger that should pull it back into scope.

---

## Cloudbeds — deferred from the write-path review (PR #11, 2026-07-22)

The write-path PR merged with its two Blockers fixed (envelope→typed-error classification; webhook
tools withdrawn). These Majors/Minors from the same review were **accepted and parked**, not fixed,
so they are tracked here rather than lost.

### Majors

- **Fail-open on an empty forwarded credential.** `resolveCredential('forwarded', …)` does not reject
  an empty `SecretString`; `SecretString.isEmpty()` has no runtime caller, and echo's
  "missing credential → AUTH_EXPIRED" test was dropped. A consumer bug that omits `X-Provider-Token`
  makes the server attempt an unauthenticated outbound call instead of returning a reconnect signal.
  *Fix:* reject empty at `resolveCredential`; restore the guard test. *Trigger:* before any provider
  whose API treats an empty credential as anonymous access (vs a clean 401).
- **`CREDENTIAL_RESOLVE_URL` unvalidated + reuses the Hop-B secret outbound.** No scheme/allowlist
  check at `loadConfig`, and the outbound bearer is `MCP_SERVER_SECRET` itself. A typo'd/plaintext
  host would exfiltrate the inbound master secret. Fails *closed* while unset (today), so this is
  latent. *Fix:* require `https:` at startup or refuse to boot; use a distinct outbound secret.
  *Trigger:* before the first `reference`-delivery provider ships (Siigo) — do NOT set the env var
  in `prd` until this lands.
- **`create_reservation` double-book window.** 15 s transport abort can fire *after* Cloudbeds wrote
  the row; `thirdPartyIdentifier` (the only reconciliation handle) is optional. *Fix:* make
  `thirdPartyIdentifier` required; document the abort-after-write window. *Trigger:* before the
  consumer wires retry on `create_reservation`.
- **`modify_reservation.status` is free text.** The one destructive transition in the toolset is a
  `z.string()`; the vocabulary is known. A misinferred `"checked_out"` closes a folio on an in-house
  guest. *Fix:* `z.enum`. *Trigger:* next Cloudbeds touch.
- **The `.reveal()` CI gate is documented as binding but not implemented.** `credential-boundary-review.md`
  §4.1 describes a grep gate forbidding `.reveal()` outside two sites; `ci.yml` has no such step.
  *Fix:* add the grep step, or downgrade the doc from "binding" to "planned". *Trigger:* next CI edit.
- **`contextDiscovery` shipped without an ADR and with an unvalidated tool reference.** New `/discover`
  field + a core dispatch exemption keyed on a string compare with no assertion the named tool exists.
  *Fix:* construction-time assertion + fold into an ADR. *Trigger:* second provider needing context.
- **Unvalidated metadata cast to the typed context.** `provider-factory.ts` casts `ctx.metadata` to the
  provider's context type for providers with no `metadataSchema`. *Fix:* type it `unknown` in the
  no-schema branch. *Trigger:* next core touch.

### Minors

- Provider error bodies discarded on HTTP failure (`unwrap` drops `RequestResult.body` on `!res.ok`) —
  a write-tool 400 gives the agent nothing to correct.
- `unwrap` can throw on a non-object 200 body (`'data' in body` after only a truthiness guard).
- `api_key` materializer silently uses `fields[0]` and drops the rest instead of throwing.
- Sequential fan-out in the composite read tools (`get_property_configuration` etc.) — 4 serial GETs
  at 15 s each; `Promise.all` is a drop-in since per-part failure is already tolerated.
- Version bump granularity: consumers diffing `providerVersion` can't see mid-branch connect-requirement
  changes.

### Withdrawn in this PR (Blocker 2), tracked for safe re-exposure

Webhook subscription tools (`list`/`ensure`/`delete_webhook_subscription`) were removed from the
published toolset. Re-expose **only** behind: an https-allowlist for `endpointUrl` sourced from
deployment config, redaction of the secret-bearing URL in list results, and a real consent gate.
Webhook wiring is the consumer's control-plane concern, not per-call agent surface.

> **CLOSED (2026-08-02) — answered by a boundary, not by a consent gate.** The last sentence above
> turned out to be the whole fix: `ToolDefinition.controlPlane` withdraws a tool from `tools/list`
> while keeping it callable, so subscription management and app state are reachable by the consumer
> and invisible to every agent. Each condition is met or made moot — `endpointUrl` must be https
> (schema-enforced), there is **no** `list` tool so no secret is ever returned, and the consent gate
> is unnecessary once the agent cannot choose the tool. Withdrawing the three tools also broke the
> backend's already-shipped subscribe call, which had been failing silently since this PR merged:
> that regression is what surfaced the gap. See `providers/cloudbeds/tools.ts` (control plane
> section) and `core/tool.ts`.
