# ADR 0021: A tool's audience travels in `_meta`, under `xcale.app/audience`

- **Status:** Proposed
- **Date:** 2026-10-14
- **Decision makers:** Mateo (sign-off pending), Sara (#1243 grill)
- **Tags:** mcp, contract, tools-list, security, integrations

## Context

Some provider tools serve the person a business talks to; others act on the whole account. In
Cloudbeds, `list_room_types` reads what any guest may know, while `modify_reservation` takes any
reservation id and changes it with the **property's** token, and `search_guests` with no filter
returns the property's guest list. Nothing in a tool's name, description or JSON Schema says which
kind it is.

That gap was exploited in practice (xcale incident F-7, 2026-07-16): a stranger chatting with a
hotel's guest agent obtained other guests' reservations, and a property-wide write was one call
away. The September 2026 triage of xcale#1243 found the same tools enabled on a guest-facing agent
in production. The consumer cannot close this on its own without a hand-written list of tool names
— the failure ADR 0019 already rejected for `identityPolicy`: it rots the day a tool is added, and
it fails open for the new one.

`identityPolicy` (ADR 0019) is the wrong axis. It says how a tool relates to a named person
(`subject-bound`, `subject-scoped`). `modify_reservation` by id is neither: it is an account-wide
action reached by a reference.

## Decision

**Each provider tool may declare an audience, published in `tools/list` under
`_meta['xcale.app/audience']`** (`AUDIENCE_META_KEY` in `src/core/types.ts`), with one of two
values:

- `customer` — safe to run on behalf of the end customer on the other side of a conversation: it
  reads or does nothing beyond what that person may already see.
- `operator` — for the account's own staff: it reads or changes records beyond the person talking.

Rules on this side of the wire:

1. **All or none, per provider.** A provider that marks one published tool marks every published
   tool (`src/core/__tests__/audience-coverage.test.ts`). So a consumer that sees one mark can
   treat an unmarked tool of that provider as unclassified, and refuse it.
2. **Absent means unclassified**, never `customer`. A provider that has not classified carries no
   key at all and its `tools/list` is byte-identical to before.
3. **It is a declaration, not an enforcement point** — the same stance as ADR 0019. This gateway
   does not know who is on the other end of a conversation; the consumer does, and it enforces.
4. **The wire is the test.** `src/providers/cloudbeds/__tests__/audience.test.ts` reads the key
   over a real MCP client on Streamable HTTP, alongside `identityPolicy` on the same tool, because a
   test on `provider.listTools()` cannot see a field the handler drops (ADR 0019).
5. **The key is namespaced with this server's prefix** (ADR 0019). `customer` / `operator` describe
   the tool, not any consumer's entities, so any MCP client can read them.

Cloudbeds is classified first (`src/providers/cloudbeds/tools.ts`): 10 tools `customer` (availability,
room calendar, rate plans, room types, hotel details, properties, items, payment options, add-ons,
property configuration) and the other 30 `operator`. Schema version `2026-10-09`.

How xcale-backend enforces it — refuse `operator` and unclassified tools of a classifying provider
whenever a guest is on the other end, regardless of the tenant's identity-binding mode — is the
backend's ADR `tool-audience-gate-on-guest-channels` (xcale-backend#1468).

### Open for Mateo's sign-off

Whether that refusal is a **security line with no tenant override** (proposed: the danger is a
stranger steering a property-wide tool, and security stays ours per the backend's Tenant Autonomy
Boundary) or a **default a business may lift**. This repo's half does not change either way: the
gateway only publishes the mark. The answer is recorded here and in the backend ADR when given.

## Consequences

- **Additive, per ADR 0001.** A consumer that ignores `_meta` sees the same menu. The new key is a
  `schemaVersion` bump for each provider that classifies.
- **New responsibility for providers that classify:** every new tool must declare its audience, or
  the coverage test fails. That is deliberate — the alternative is a new tool silently reaching a
  guest.
- **Providers that have not classified stay unmarked**, and a consumer's existing protections are
  the only ones for them. Next to classify: those that reach people (Erbon, Siigo, HiMed).
- **Two repos share one contract.** Removing it means removing the mark here and the gate in the
  consumer. The gateway deploys first; an old gateway without the mark leaves a provider
  unclassified, never misclassified.

## Alternatives considered

- **A name list in the consumer.** Rejected for the reason ADR 0019 gives: provider knowledge
  belongs where the tool is defined, and a list fails open for the next tool.
- **`controlPlane` (ADR 0013) for the account-wide tools.** Hides them from every agent, including
  the account's owner on their own surface, which their credential allows. Narrows more than
  security needs.
- **Reuse `identityPolicy`.** Wrong axis (see Context); it would also need a value meaning "no
  person", which bends a field to carry something it does not mean.
- **MCP `annotations`.** A closed, spec-defined vocabulary about behaviour (read-only, destructive).
  Who a tool may serve is not in it — `readOnlyHint` is published there; audience is not.
