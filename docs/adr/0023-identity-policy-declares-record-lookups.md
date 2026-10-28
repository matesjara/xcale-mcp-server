# ADR 0023: The identity policy declares record lookups — field kinds, result identities, a projection and the created record

- **Status:** Accepted (Mateo, 2026-10-25, on the architect's call — the whole vocabulary)
- **Date:** 2026-10-24
- **Decision makers:** Mateo decides (direction, 2026-10-22: one transversal capability, not one per provider);
  Juan José proposes
- **Tags:** core, contract, identity, privacy, health, Ley-1581
- **Number:** _unassigned (assigned at merge)_
- **Extends:** [identity-policy-travels-in-tool-meta](0019-identity-policy-travels-in-tool-meta.md) and
  [identity-policy-record-ownership-and-always-enforce](identity-policy-record-ownership-and-always-enforce.md)

## Context

xcale-backend is building **Own Records** (matesjara/xcale-backend#1852): one generic mechanism by which a
consumer finds a person's own records — a reservation, an appointment, an order — across every provider a
tenant connects, and acts on one of them. The decision that shapes this server: the consumer owns the proof
and the enforcement; a provider only **declares** what its tools can look up and what their results carry.
Nothing about identity is coded per provider in the consumer.

`ToolIdentityPolicy` cannot say enough for that today (`src/core/types.ts`):

1. **It does not say what kind of identifier a field is.** `identityFields` is a bare list, so a consumer
   cannot tell a phone from an email or a name. Cloudbeds `search_guests` lists `guestFirstName` and
   `guestLastName` beside `guestPhone` and `guestEmail`; xcale-backend today reads every entry as a phone.
2. **It describes the arguments, never the rows that come back.** A provider's phone filter may be fuzzy
   (prefix, contains, a record typed without a country code), so the rows a call returns may belong to
   people other than the one whose identifier was passed. Only the provider knows which field on each row
   carries the person.
3. **It cannot say which result fields are safe to show the person a record belongs to.** Free text, OTA
   confirmation codes and URLs carry record numbers and identifiers in places no consumer can guess. The
   provider knows its result shape; the consumer does not.
4. **Ownership by construction is consumer code per provider.** xcale-backend#1442 recognises a HiMed
   appointment it created through a HiMed-specific observer (`himed-appointment-ownership.ts`). The next
   provider would need another one.

## Decision

The `subject-bound` variant gains **optional** fields, published like the rest of the policy under
`_meta['xcale.app/identityPolicy']` (0019):

| Field | Type | Meaning |
|:--|:--|:--|
| `identityFieldKinds` | `Record<string, 'phone' \| 'email' \| 'document' \| 'name'>` | The kind of each entry of `identityFields`. `phone`, `email` and `document` **identify** a person; `name` only **narrows** a search and identifies no one on its own. A field listed without a kind keeps today's meaning, so existing declarations are unaffected. |
| `recordLookup` | `boolean` | The tool finds **a person's records** by its identifying fields: given that person's identifiers, it returns the records the provider associates with them, as precisely as the provider's filter allows (`resultIdentityFields` says who each row is). |
| `recordKind` | `'reservation' \| 'appointment' \| 'order' \| 'record'` | The category of record the tool returns or names, in provider-neutral words. Absent: `'record'` (unspecified). Not an id space — that is `recordOwnershipKind`. |
| `resultItemsPath` | `string` | Dot path to the records in the result: an array, or one object for a tool that returns a single record. Absent: the result itself. Every path below is relative to one item. |
| `resultIdentityFields` | `Record<string, 'phone' \| 'email' \| 'document'>` | Which fields on each returned item carry the person, and their kind. An item may carry several. They let each row be matched to a person on its own, whatever the provider's filter matched. |
| `resultRecordIdField` | `string` | The record id on each item — the value a tool that declares `recordOwnershipField` takes to name that record. |
| `projection` | `string[]` | The **allowlist** of item fields the provider holds safe to show the person the record belongs to. A field not listed is not declared safe — the record number, free text, a field added to the result later — so the list fails closed. |
| `projectionDetail` | `string[]` | Extra item fields, not in `projection`, that the provider marks as more sensitive than it (for health data: specialty, practitioner). |
| `resultDateField` | `string` | The date on each item that places the record in time — a stay's end, an appointment's start, an order's date — in ISO 8601. |
| `createdRecordIdField` | `string` | On a tool that **creates** a record (a booking, an appointment, an order): where the new record's id is in the result. That record exists because this call created it, so it belongs to the call's caller by construction — declared once instead of coded per provider. |
| `recordOwnershipKind` | `string` | The id space of the record ids this tool names — in `recordOwnershipField`, `ownedResultField`, `resultRecordIdField` or `createdRecordIdField` — as `<provider>:<kind>` (`woocommerce:order`, `woocommerce:customer`, `himed:cita`). Ids of different kinds never compare equal: an order `42` is not a customer `42`. Absent: the tool does not say which id space its ids belong to, so they cannot be compared with ids from any other tool — a consumer may own nothing by that field (fail closed). |
| `recordAction` | `'cancel' \| 'change' \| 'read'` | On a tool that declares `recordOwnershipField`: what the call does to the record it names. `cancel` cancels it and `change` modifies it — the two writes; `read` returns that one record and changes nothing. Absent: the tool does not declare what it does with the record. |

`recordKind` and `recordOwnershipKind` are different things: the first is a closed, provider-neutral
category for naming a record in words; the second is an open, provider-qualified id space for comparing ids.

`recordOwnershipField`, `ownedResultField` and `alwaysEnforce` are reused unchanged. A tool that names one
record — to cancel it, change it or read it — names its id with `recordOwnershipField` and says which of
the three it does with `recordAction`. `alwaysEnforce` stays the provider's statement that the data is
sensitive (0019).

**Fetching one record by its id needs no new field.** A tool that returns one named record (Cloudbeds
`get_reservation`, WooCommerce `get_order`) declares `recordOwnershipField` for the argument that carries
the id and `recordAction: 'read'`; its result is described by the same result-side fields as a lookup's —
`resultItemsPath` to the record (absent when the result is the record), `resultIdentityFields`,
`resultRecordIdField`, `projection`, `resultDateField`. The one row it returns can then be matched to a
person exactly like a lookup's rows. A separate "fetch by id" field would only repeat what
`recordOwnershipField` already says: which argument names the record.

**A record-lookup declaration is complete with `resultIdentityFields` and `projection`.** Without the first,
no returned row can be matched to a person; without the second, no field is declared safe to show.

**The gateway's contract: an absent `identityPolicy` means the tool touches no person's records.** A tool
that touches them without declaring is a defect of this gateway, and it is fixed here, never worked around
in a consumer.

As in 0019, these are **declarations, not enforcement points**. This server does not police them; what a
consumer does with them — and with a tool that declares too little — is the consumer's, and lives in its
own decisions (xcale-backend's `own-records-proof-grants-access-never-fuses`).

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
  closed: a field nobody declared is a field nobody declared safe.

### Alternative C (chosen): provider-declared vocabulary, enforced by the consumer
- **Pros:** one core for every provider; the knowledge stays with the party that has it; a provider that
  has not declared offers nothing to misread; additive under 0001.
- **Cons:** listed below.
- **Why chosen:** it is the only option where both the generic mechanism and fail-closed exposure hold.

## Consequences

### Positive
- A new provider joins Own Records by declaring, with no consumer code.
- Every returned row can be matched to a person on its own, whatever the provider's filter does; what is
  safe to show is declared, not guessed.
- Ownership by construction stops being provider-specific consumer code.
- One record fetched by its id is described with the vocabulary a lookup already uses.

### Negative
- **Every provider must declare to join**, and each declaration is a published-menu change: a
  `schemaVersion` bump (0001/0019), or a warm consumer cache keeps the old policy.
- **Some records cannot be placed in time.** A tool without `resultDateField` gives no date for its records.
- **The projection is upkeep.** A provider that adds a field to its result has to decide whether it
  belongs in the projection; until it does, the field is not declared safe to show (fail closed, by design).
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
  `mcp_woocommerce_list_orders` and `mcp_woocommerce_get_order` (`src/providers/woocommerce/tools.ts:1077,1448,1466`)
  touch customers' orders and declare no `identityPolicy` today. They are fixed by a declaration PR in this repo
  (#161), before xcale-backend's phase 0 (provider before consumer). Nevatal's `list_appointments` /
  `cancel_appointment` are native tools of xcale-backend and are declared there.

## References

- Epic: matesjara/xcale-backend#1852 (Own Records); absorbs matesjara/xcale-backend#1842 (HiMed).
- Consumer: xcale-backend's ADR `own-records-proof-grants-access-never-fuses` and
  `docs/design/own-records/` (matesjara/xcale-backend#1853) — what the consumer does with each field lives
  there, provider before consumer.
- Depends on xcale-backend#1442 for the consumer's reading of `ownedResultField`, `recordOwnershipField`
  and `alwaysEnforce`.
- Code anchors: `src/core/types.ts` (`ToolIdentityPolicy`, `IDENTITY_POLICY_META_KEY`),
  `src/providers/cloudbeds/tools.ts` (`search_guests`), `src/providers/himed/tools.ts`.
