# ADR: authDescriptor field names are non-secret; the catalog secret-scan targets values, not the field name `password`

- **Status:** Proposed
- **Date:** 2026-09-28
- **Decision makers:** Mateo
- **Tags:** integrations, auth, security

> ⚠️ **Note to Mateo — needs your sign-off.** This ADR authorizes a change to a **security guard test** (`src/core/__tests__/catalog.test.ts`), so it is `Proposed`, not `Accepted`. It does not weaken what the guard protects (no secret *values* may reach the published catalog); it makes the guard stop flagging a non-secret *field name*. Raised by the Erbon read-only provider (`docs/design/erbon-read-only-provider/`); nothing merges until you accept this.

## Context

The capability catalog (`server/discover`) publishes each provider's **full** `authDescriptor`, including `bodyFields` — see `src/core/catalog.ts:60` (`authDescriptor: provider.auth`). By design, `bodyFields` maps *logical credential fields → the provider's wire field NAMES*, "used verbatim, never interpolated" (`src/core/provider-port.ts:72`). It carries **field names, never secret values** — the Credential-in-Transit-Only invariant and `SecretString` keep values out of the descriptor entirely (ADR [credential-delivery-strategies](credential-delivery-strategies.md)).

A guard test asserts the catalog "carries no secrets and no consumer-specific concepts" by scanning the serialized catalog with `/clientSecret|client_secret|password|tenant|\bplan\b/i` (`src/core/__tests__/catalog.test.ts:22`).

The **Erbon** provider is the first whose token-mint wire body uses the field literally named `password` — Erbon's `POST /auth/login` expects `{ "username": …, "password": … }`. Its descriptor must therefore declare `bodyFields: { password: 'password' }`, where the value `'password'` is the wire field **name** Erbon requires (it cannot be renamed without breaking the login call). Siigo did not hit this because its fields are `username` / `access_key`.

The blunt `/password/i` term flags this non-secret field **name** as if a secret leaked, failing the guard the moment Erbon is registered in `PROVIDERS`. We are deciding now because the Erbon read-only provider (Slice 1) needs to register to be discoverable.

## Decision

An `authDescriptor`'s field **names** — `bodyFields` keys and values, and `fields[].key` for `api_key`/`basic` — are **non-secret provider knowledge** that legitimately appears in the published catalog. The catalog secret-scan guard asserts the absence of secret **values** and consumer-specific concepts; it must **not** treat the non-secret wire field name `password` as a leak. We keep the guard scanning for `password` (and the other terms), but first **exclude each `authDescriptor.bodyFields`** — the non-secret wire-field-name map — from the scanned JSON. The guard therefore still catches a real secret value containing `password` anywhere else in the catalog, while no longer flagging Erbon's legitimate `password` field name.

## Alternatives Considered

### Alternative A: Rename or avoid the `password` field
- **Pros:** no test change.
- **Cons:** impossible — the wire field name is dictated by Erbon's API (`{"username","password"}`); a different name makes the mint fail.
- **Why rejected:** it is not ours to rename.

### Alternative B: Stop publishing `bodyFields` in the catalog
- **Pros:** the literal `password` never reaches the scanned JSON.
- **Cons:** Rail A derives the connect form and the mint request from `bodyFields`; it is the consumer-agnostic litmus ("the connect form is derivable from the catalog alone"). Dropping it re-introduces per-provider knowledge on the consumer.
- **Why rejected:** breaks a deliberate contract (ADR [consumer-agnostic-contract](consumer-agnostic-contract.md), ADR [provider-knowledge-vs-credential-custody](provider-knowledge-vs-credential-custody.md)).

### Alternative C (accepted): Scope the scan to exclude the `bodyFields` name-map
- **Pros:** the `password` term stays in the scan (a real leak elsewhere is still caught); only the false positive — the non-secret `bodyFields` name-map — is excluded; unblocks any provider whose wire field is `password`; no contract broken.
- **Cons:** the scan must first strip `authDescriptor.bodyFields` (a few lines).
- **Why accepted:** the only false positive was the `bodyFields` name-map, so excluding just that keeps the `password` guard fully intact everywhere else — strictly better than dropping the term. The descriptor is data-only (enforced by the serializability round-trip in `provider-conformance.ts`), real secret **values** never enter it (`SecretString` + Credential-in-Transit-Only), and the dangerous field names (`clientSecret`/`client_secret`) plus consumer concepts (`tenant`/`plan`) stay scanned.

## Consequences

### Positive
- Any provider whose token-mint wire field is `password` can be onboarded without a per-provider exception.
- The guard now states what it actually protects: secret **values** and consumer concepts must not appear in the published catalog.

### Negative
- The scan skips the `authDescriptor.bodyFields` name-map, so a secret value that somehow landed *inside* `bodyFields` as a value would not trip `password` there. Mitigated because (a) the descriptor is serializable data with no behavior, asserted by the conformance round-trip; (b) secret values never enter the descriptor (`SecretString`, `.reveal()` only at egress); (c) everywhere else in the catalog `password`/`clientSecret`/`client_secret` are still scanned.
- Reversing this is a few lines (remove the `bodyFields` strip), but it would re-block Erbon.

### Neutral
- We now own a slightly more explicit guard, with a comment tying the `bodyFields` exclusion to this ADR so a future reader does not "restore" the blunt term and re-break Erbon.
- Touches a security-guard test → this ADR is gated on Mateo's sign-off (soul.md #1 Security).

## References

- Related ADRs: [consumer-agnostic-contract](consumer-agnostic-contract.md), [provider-knowledge-vs-credential-custody](provider-knowledge-vs-credential-custody.md), [credential-delivery-strategies](credential-delivery-strategies.md)
- Related feature design: `docs/design/erbon-read-only-provider/feature-design.md` (+ `grill-notes.md`, `api-contract.md`)
- Code anchors: `src/core/catalog.ts:60`, `src/core/__tests__/catalog.test.ts:22`, `src/core/provider-port.ts:72`, `src/providers/erbon/auth.ts`
