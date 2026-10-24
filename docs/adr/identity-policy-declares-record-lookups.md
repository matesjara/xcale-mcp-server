# ADR: The identity policy declares record lookups — field kinds, result identities, a projection and the created record

- **Status:** Accepted (2026-10-22, in the grill of matesjara/xcale-backend#1852 — JuanJo, with Mateo's direction)
- **Date:** 2026-10-22
- **Decision makers:** Mateo (direction: one transversal capability, not one per provider); Juan José (design lead)
- **Tags:** core, contract, identity, privacy, health, Ley-1581
- **Number:** _unassigned (assigned at merge)_
- **Extends:** [identity-policy-travels-in-tool-meta](0019-identity-policy-travels-in-tool-meta.md) and
  [identity-policy-record-ownership-and-always-enforce](identity-policy-record-ownership-and-always-enforce.md)

## Context

xcale-backend is building **Own Records** (matesjara/xcale-backend#1852): a customer who forgot their
reservation, appointment or order number proves they hold a phone line, and the tenant's agent finds and
shows **that person's own records** — in a hotel, a clinic or a store — and lets them act with a second
factor. The decision that shapes this server: the mechanism is **generic**. The consumer owns the proof
and the enforcement; a provider only **declares** what its tools can look up and what their results carry.
Nothing about identity is coded per provider in the consumer.

`ToolIdentityPolicy` cannot say enough for that today (`src/core/types.ts`):

1. **It does not say what kind of identifier a field is.** `identityFields` is a bare list, and the
   consumer reads every entry as a phone. Cloudbeds `search_guests` lists `guestFirstName` and
   `guestLastName` beside `guestPhone` and `guestEmail`, so under the consumer's strict mode naming a
   guest always refuses, and an email can never match.
2. **It describes the arguments, never the rows that come back.** A provider's phone filter may be fuzzy
   (prefix, contains, a record typed without a country code), so a caller who passed the argument check
   can still receive another person's row. Only the provider knows which field on each row carries the
   person.
3. **It cannot say what is safe to show.** The "see" step must never expose the record number or the
   fields a tenant uses as its act factor. Free text, OTA confirmation codes and URLs carry them in
   places no consumer can guess. The provider knows its result shape; the consumer does not.
4. **Ownership by construction is consumer code per provider.** xcale-backend#1442 recognises a HiMed
   appointment it created through a HiMed-specific observer (`himed-appointment-ownership.ts`). The next
   provider would need another one.

## Decision

The `subject-bound` variant gains **optional** fields, published like the rest of the policy under
`_meta['xcale.app/identityPolicy']` (0019):

| Field | Type | Meaning |
|:--|:--|:--|
| `identityFieldKinds` | `Record<string, 'phone' \| 'email' \| 'document' \| 'name'>` | The kind of each entry of `identityFields`. `phone`, `email` and `document` **identify** and bind to the person's proven identities by kind; `name` only **narrows** a search — it never binds and never refuses on its own. A field listed without a kind keeps today's meaning, so existing declarations are unaffected. |
| `recordLookup` | `boolean` | The tool finds **a person's records** by the identifying fields. The consumer may call it on the person's behalf, filling those fields from that person's proven identities, never from the model. |
| `recordKind` | `'reservation' \| 'appointment' \| 'order' \| 'record'` | On a `recordLookup` tool: what kind of record it returns, so the consumer can name it to the customer and in the consent prompt. Absent: `'record'`. |
| `resultItemsPath` | `string` | Dot path to the array of records in the result. Absent: the result itself is the array. Every path below is relative to one item. |
| `resultIdentityFields` | `Record<string, 'phone' \| 'email' \| 'document'>` | Which field on each returned item carries the person, and its kind. The consumer keeps only the items whose identity matches the person exactly (E.164 for phones), whatever the provider's filter returned. |
| `resultRecordIdField` | `string` | The record id on each item. The consumer keeps it server-side and hands the agent an opaque handle instead. |
| `projection` | `string[]` | The **allowlist** of item fields that may be shown when a person sees their records. Whatever is not listed never reaches the agent on that road: not the record number, not free text. |
| `projectionDetail` | `string[]` | Extra item fields that may be shown **only when the tenant opts in** (for health data: specialty, practitioner). Never shown by default; the health floor shows `projection` only. |
| `resultDateField` | `string` | The date on each item that places the record in time — a stay's end, an appointment's start, an order's date — in ISO 8601. The consumer serves records found without a code only inside its recency window (the future, or the recent past), so a recycled or mistyped phone never opens old history. |
| `createdRecordIdField` | `string` | On a tool that **creates** a record (a booking, an appointment, an order): where the new record's id is in the result, so the consumer can link it to the person who created it — ownership by construction, declared once instead of coded per provider. |
| `recordAction` | `'cancel' \| 'change' \| 'read'` | On a **write** tool that declares `recordOwnershipField`: which action that call performs, so the consumer checks a step-up permit bound to that record and that action. |

`recordOwnershipField`, `ownedResultField` and `alwaysEnforce` are reused unchanged. A write tool that
acts on a record names its record id with `recordOwnershipField`, and the consumer resolves the opaque
handle back to that id. **A write tool with `recordOwnershipField` and no `recordAction` is not served on
the Own Records road.**

**A shared phone is detected from what the rows already declare.** When one phone's records carry several
distinct `resultIdentityFields` values of kind `email` or `document`, the consumer treats that phone as
shared (a receptionist's, an agency's, a household's). No name field is needed for it. `alwaysEnforce` stays the provider's statement that the data is not the tenant's
to leave unprotected; on the consumer that is the **health tier** of Own Records: a proven phone plus the
patient's document to see, and a minimal default view.

**The gateway's contract: an absent `identityPolicy` means the tool touches no person's records.** A tool
that touches them without declaring is a defect of this gateway, and it is fixed here, never worked around
in a consumer.

As in 0019, these are **declarations, not enforcement points**. This server does not police them; the
consumer enforces. **A tool that declares `recordLookup` without a `projection` and
`resultIdentityFields` is not served on the Own Records road.**

## Alternatives Considered

### Alternative A: the consumer adapts each provider itself
- **Pros:** no contract change; each adapter can be as precise as its provider.
- **Cons:** the identity core couples to every provider; the consumer has to re-learn every result shape,
  which rots the day a provider changes it; every new provider is consumer work before it can join.
- **Why rejected:** it contradicts the grill's first decision (a generic mechanism; providers only
  declare), and it is the hand-maintained map 0019 was written to replace.

### Alternative B: generic redaction by denylist (strip the record number and the factor fields)
- **Pros:** fewer declarations; nothing to list per tool.
- **Cons:** it leaks wherever the denylist does not look: notes that hold a cédula or an email, an OTA
  confirmation code in another field, a payment URL that embeds the reference, a card rendered from the
  raw result.
- **Why rejected:** the red-team review of the plan showed each of those paths. An allowlist fails
  closed: a field nobody declared is a field nobody sees.

### Alternative C (accepted): provider-declared vocabulary, enforced and projected by the consumer
- **Pros:** one core for every provider; the knowledge stays with the party that has it; a provider that
  has not declared is simply not on the road, never half-served; additive under 0001.
- **Cons:** listed below.
- **Why accepted:** it is the only option where both the generic mechanism and fail-closed exposure hold.

## Consequences

### Positive
- A new provider joins Own Records by declaring, with no consumer code.
- Row-level matching closes the fuzzy-filter leak; the projection closes the free-text leak.
- Ownership by construction stops being provider-specific consumer code.

### Negative
- **Every provider must declare to join**, and each declaration is a published-menu change: a
  `schemaVersion` bump (0001/0019), or a warm consumer cache keeps the old policy.
- **Some records cannot be placed in time.** A tool without `resultDateField` cannot serve records found
  without a code, because the consumer cannot apply its recency window to them.
- **The projection is upkeep.** A provider that adds a field to its result has to decide whether it
  belongs in the projection; until it does, the field is invisible on this road (fail closed, by design).
- **`identityFieldKinds` leaves `name` in `identityFields`** for compatibility rather than moving it out.
  The kind is what changes its meaning.
- Reversing this would orphan every declaration and send the consumer back to per-provider adapters.

### Neutral
- First adopters for v1:
  - **Cloudbeds** `search_guests`: kinds for its four fields, `recordLookup`, result identities, a
    projection.
  - **HiMed**: kinds (`document` on `idPaciente`), `resultDateField`, `projection` and `projectionDetail`
    (specialty, practitioner) on its appointment list, `recordAction: 'cancel'` on `cancel_appointment`, and
    `createdRecordIdField` on `create_appointment` to replace the consumer-side observer.
- **WooCommerce's order tools must declare before the consumer's first phase.** `mcp_woocommerce_update_order`,
  `mcp_woocommerce_list_orders` and `mcp_woocommerce_get_order` (`src/providers/woocommerce/tools.ts:1065,1436,1454`)
  touch customers' orders and declare no `identityPolicy` today. They are fixed by a declaration PR in this repo,
  before xcale-backend's phase 0 (provider before consumer). Nevatal's `list_appointments` /
  `cancel_appointment` are native tools of xcale-backend and are declared there.

## References

- Epic: matesjara/xcale-backend#1852 (Own Records); absorbs matesjara/xcale-backend#1842 (HiMed).
- Consumer: xcale-backend's ADR amending its ADR 0062 (Record Access Grant, no existence oracle) and
  `docs/design/own-records/feature-design.md` — they follow this one, provider before consumer.
- Depends on xcale-backend#1442 for the consumer's reading of `ownedResultField`, `recordOwnershipField`
  and `alwaysEnforce`.
- Code anchors: `src/core/types.ts` (`ToolIdentityPolicy`, `IDENTITY_POLICY_META_KEY`),
  `src/providers/cloudbeds/tools.ts` (`search_guests`), `src/providers/himed/tools.ts`.
