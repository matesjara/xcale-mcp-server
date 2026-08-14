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
- **`CREDENTIAL_RESOLVE_URL` is unvalidated at `loadConfig`.** No scheme or allowlist check —
  `env.CREDENTIAL_RESOLVE_URL ?? ''`, taken as given. A typo'd or plaintext host receives the
  outbound bearer on every resolve call. Fails *closed* while unset (today), so this is latent.
  *Fix:* require `https:` at startup or refuse to boot. *Trigger:* before the first
  `reference`-delivery provider ships (Siigo) — do NOT set the env var in `prd` until this lands.

  > **Half CLOSED (2026-08-14, PR #27).** This entry originally paired the unvalidated URL with a
  > second defect: "the outbound bearer is `MCP_SERVER_SECRET` itself". That half is fixed —
  > `CREDENTIAL_RESOLVE_SECRET` is now a distinct outbound secret (`src/config.ts`, `src/server.ts`),
  > falling back to `MCP_SERVER_SECRET` only until both this server and the backend carry it. So a
  > bad URL no longer exfiltrates the inbound master secret; it exfiltrates the callback secret,
  > which still buys an attacker provider credentials from the Credential Authority. The trigger
  > above stands unchanged, and the fallback makes it sharper: setting the URL in `prd` *without*
  > also setting `CREDENTIAL_RESOLVE_SECRET` silently restores the coupling #27 removed.
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
  at 15 s each; `Promise.all` is a drop-in since per-part failure is already tolerated. Same
  anti-pattern in `remove_webhook_subscriptions` (PR #19, control-plane review): the per-subscription
  DELETEs run in a for-loop with per-item failure already tolerated and counted — fix both in one pass.
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

---

## Cloudbeds — deferred from the control-plane review (PR #19, 2026-08-06)

The control-plane PR merged with its one Major resolved by an ADR
(`docs/adr/control-plane-tools.md` — the `controlPlane`/`routableToolNames()` mechanism and its
accepted no-discovery trade-off). These Minors were **accepted and parked**:

### Minors

- Sequential DELETE fan-out in `remove_webhook_subscriptions` — same anti-pattern as the
  composite-read sequential fan-out already tracked under the PR #11 Minors above; folded into
  that entry so both sites get fixed in one pass.
- **`classifyEnvelopeFailure`'s `access to property` match is knowingly coarse.** A token whose
  metadata carries the WRONG `propertyID` (a consumer bug) answers exactly like a real revocation
  and gets labeled `AUTH_EXPIRED`. Accepted in-code as the better of the two readings — it surfaces
  an actionable reconnect instead of an opaque error, and a wrong `propertyID` fails at connect
  time, not mid-life. Recorded for visibility. *Trigger:* a reconnect loop observed on a
  connection whose token is actually live.

---

## Cloudbeds — deferred from the scope-coverage review (PR #20, 2026-08-06)

The read:addon + write:communication PR merged with its one Blocker fixed (schemaVersion/
providerVersion bump for `list_addons`). These Minors were **accepted and parked**:

### Minors

- **`paymentsPath()` name is now misleading.** `client.getV2` reuses the payments-specific
  percent-encoder for the unrelated PMS v2.0 addons surface. Works correctly; the name lies.
  *Fix:* rename to a surface-neutral `v2Path`. *Trigger:* next Cloudbeds client touch.
- **`create_email_template` `cc`/`bcc` are single `z.string().email()`, not arrays.** If the
  Cloudbeds spec allows multiple recipients, the schema under-serves it (additive widening later
  is contract-safe, but certification reviewers may notice). *Fix:* confirm against the Cloudbeds
  communication spec; widen to arrays if supported. *Trigger:* before submitting the
  certification bundle to Cloudbeds.

---

## Cloudbeds certification bundle — accepted as-is (PR #18, 2026-08-06)

- The certification report (`2026-08-02-informe-certificacion.md`) carries an unrelated
  ePayco/card-payment status annex. Accepted rather than split during the merge push; move it to
  its own note if the report is ever exported outside the repo. *Trigger:* preparing the report
  for external submission.
