# ADR: The identity policy gains `recordOwnershipField`, `ownedResultField` and `alwaysEnforce`

- **Status:** Accepted (2026-10-17, by Mateo on the review of #125: `recordOwnershipField` and the
  non-switchable `alwaysEnforce`, as the law). `ownedResultField` was added on 2026-10-18, after that
  acceptance — it applies the same ownership fact to a read, and was **accepted by Mateo on 2026-10-21**
  ("sí, apruebo") on the #125 `/pr-review`. All three fields are accepted.
- **Date:** 2026-10-17
- **Decision makers:** Sara (HiMed owner); Mateo (release owner — signed off the `src/core` change and
  the mandatory patient-data protection on 2026-10-17)
- **Tags:** core, contract, identity, privacy, health, Ley-1581
- **Number:** _unassigned (assigned at merge)_
- **Extends:** [0019 — identity policy travels in `_meta`](0019-identity-policy-travels-in-tool-meta.md)

## Context

ADR 0019 publishes a tool's `ToolIdentityPolicy` under `_meta['xcale.app/identityPolicy']` so a
consumer can tell whose data a tool reaches. Its `subject-bound` mode says "this tool acts on the
person named in these fields", and the consumer binds those fields to the person writing.

HiMed exposed two things that shape cannot say:

1. **A record the caller created is theirs, even when the person fields cannot bind.** HiMed patient
   tools key on the cédula; over WhatsApp the only verified fact is the phone, and HiMed offers no
   second factor. A patient who booked an appointment in the conversation must still be able to
   cancel it. The consumer can prove that — it saw the booking — but only if the tool says which
   input field is the record id.
2. **Some data is not the tenant's to leave unprotected.** The consumer enforces identity policies
   only when the tenant opts in (`strict`; default `off`). A clinic's patient records fall under Ley
   1581: a clinic that never opted in, or switched it off, would serve any cédula to anyone. The
   provider is the party that knows the data is health data, so it must be able to say so.

## Decision

`ToolIdentityPolicy`'s `subject-bound` variant (`src/core/types.ts`) gains three **optional** fields:

- **`recordOwnershipField?: string`** — names an input field carrying a record id (HiMed:
  `idCita`). A consumer that tracks which records a subject created through its own channel may
  authorize the call by that ownership even when the identity fields do not match. It is an
  additional way to pass, never a way to skip the policy: a record the caller does not own falls
  through to the normal identity checks.
- **`ownedResultField?: string`** — names the field carrying a record id on each item of a LIST
  result (HiMed: `idCita` on `list_patient_appointments`). When the identity fields cannot bind, a
  consumer may still serve the call to a subject who owns records of the provider, returning only the
  items whose id that subject owns and withholding the rest. A patient asks "¿qué citas tengo?" and
  sees the citas they booked here; a stranger's document yields nothing of that patient's. Same
  ownership fact as `recordOwnershipField`, applied to what a read returns instead of what a write
  names. (Added 2026-10-18, stacked on the first two.)
- **`alwaysEnforce?: boolean`** — the consumer enforces this tool **regardless of the tenant's
  opt-in mode**. For data whose protection the tenant cannot waive. The consumer still serves the
  tenant's owner on their own surface (no buyer channel) — the field is about other people's data.

Both live in core, not in the HiMed provider, because they are vocabulary of the identity contract
(like `identityFields` itself): any provider holding records a caller can create, or data under a
mandatory-protection law, uses the same words. HiMed is the first user: every patient tool sets
`alwaysEnforce: true`, `cancel_appointment` sets `recordOwnershipField: 'idCita'`, and
`list_patient_appointments` sets `ownedResultField: 'idCita'`.

## Consequences

- **Additive, per ADR 0001.** All three fields are optional; a consumer that ignores them sees the policy
  it saw before. They travel the 0019 path (`_meta`), so no transport change.
- **Still a declaration, not an enforcement point** (0019). The gateway does not police either
  field; the consumer (xcale-backend's identity gate) enforces. `alwaysEnforce` is a promise the
  consumer must honor — the backend reads it from `_meta` and gates regardless of the tenant mode.
- **A consumer that ignores `alwaysEnforce` under-protects.** The field cannot force an unaware
  consumer; it makes the requirement explicit and machine-readable, which is the most a declaration
  can do. Our consumer honors it (xcale-backend#1442).
- **Changing any of them on a tool changes the published menu → `schemaVersion` bump** (0001/0019).
  HiMed is bumped to `2026-10-18` (`providerVersion` `0.6.0`) for exactly this — `2026-10-17` for
  `recordOwnershipField`/`alwaysEnforce`, then `2026-10-18` when `ownedResultField` was added; without
  the bump a consumer's cached `tools/list` keeps the old policy and stays unenforced under `off`.
- **`ownedResultField` makes the consumer edit a result, not only gate a call.** The consumer must
  filter the data the model sees AND anything derived from it (a rendered card), and must not let an
  error tied to the arguments (e.g. "patient not found") reach the model, or the filtered read would
  still say whether a document belongs to a patient. Errors that do not depend on the arguments
  (provider down, rate-limited, reconnect) pass through. A subject that owns no record of the
  provider is refused before the provider is called.
- **This crosses the Provider Self-Containment boundary** (a `src/core` change in a provider PR),
  hence Mateo's explicit call.

## Alternatives considered

- **Keep both in the HiMed provider.** Rejected: the policy is consumed generically by name; a
  HiMed-only field is one the consumer would have to special-case by provider slug — the
  hand-maintained map 0019 exists to avoid.
- **Make the tenant turn `strict` on for every clinic.** Rejected: a manual per-clinic step that can
  be forgotten or undone, for data where neither is acceptable.
- **A new `mode` (e.g. `record-owned`)** instead of a field. Rejected: a cancel is still about a
  person (the cédula) — ownership is an extra way to pass the same subject-bound check, not a
  different relationship. A separate mode would duplicate `identityFields` and its checks.
- **Gate creation too.** Rejected: registering or booking a NEW patient has nothing to bind to yet;
  gating it locks new patients out. Create tools carry no policy; protection stays on reads,
  changes and cancel, where the leak is.
