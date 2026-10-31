# Avirato Provider — Ship Log

- **Status:** in review — PR **#190** to `dev`. Tracking: #189.
- **Release order:** this provider ships **before** `xcale-backend#2218`, its consumer. The consumer resolves the dotted token path, applies `tokenTtlSeconds` and mints single-flight. Until it lands, an Avirato connection cannot mint. No new env var: `reference` resolution reuses `CREDENTIAL_RESOLVE_URL` / `CREDENTIAL_RESOLVE_SECRET`.
- **Before the merge:** number the ADR (`npm run adr:number -- --apply`).
- **Related:**
  - this folder: `feature-design.md`, `api-contract.md`, `implementation-plan.md`;
  - ADR `credential-exchange-response-path-and-token-ttl` (amends 0010), ADR 0013 (control-plane tools), ADR 0015 (thin write passthrough), ADR 0019 (identity policy);
  - the evidence comments on #189.

## Summary

Avirato (a Spanish hotel PMS, API v3) as a standard provider.

- **Auth:** `credential_exchange` with `reference` delivery. The API user's email and password stay in the backend's Rail A, and this server receives the minted JWT. The token arrives at `data.token`, with no stated lifetime, so the descriptor declares 900 s.
- **Context:** `web_code`, Avirato's establishment id, is strict call context, never a tool argument.
- **Data and errors:** data is returned verbatim, the envelope stripped. Errors carry the machine code and only plain validation sentences, never the echoed request.

## What shipped (16 tools)

| Tool                                                                                | Agent menu      | Purpose                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_establishment`, `list_room_types`, `list_rates`, `list_regimes`, `list_extras` | ✅              | Hotel catalog reads                                                                                                                                                                                                                                 |
| `check_availability`, `validate_promotional_code`                                   | ✅              | Free rooms per night; whether a code exists                                                                                                                                                                                                         |
| `get_reservation`, `find_reservations_by_guest`, `get_reservation_links`            | ✅              | One guest's stay, by id or document, and its Guest/Shop/AutoCheck links; bound to its owner                                                                                                                                                         |
| `quote_stay`                                                                        | ❌ controlPlane | Price of a stay per rate (money guard)                                                                                                                                                                                                              |
| `create_reservation`                                                                | ❌ controlPlane | One reservation; Avirato prices it; the tag reads back as `promotional_package`                                                                                                                                                                     |
| `modify_reservation`                                                                | ❌ controlPlane | The room's full record; Avirato reprices; clears the tag; **refuses (WOULD_REMOVE) to drop an extra or an advance the call does not state**                                                                                                         |
| `get_reservation_charges`                                                           | ❌ controlPlane | A reservation's charges — room, regime, extras by name                                                                                                                                                                                              |
| `cancel_reservation`                                                                | ❌ controlPlane | Leaves it `Reserva cancelada`; its draft bill stays                                                                                                                                                                                                 |
| `list_reservations`                                                                 | ❌ controlPlane | The hotel's reservations by date (created, modified, check-in, check-out), every status, paged by cursor; grouped by master reservation, camelCase rows verbatim; `subject-scoped`. It serves the backend's CRM history import (xcale-backend#2218) |

Also in this PR, in `src/core/`:

- the `credential_exchange` descriptor gains a closed dotted key path and `tokenTtlSeconds` (ADR);
- `redactQueryValues` ends a value at a double quote, so a provider's one-line JSON error body that echoes the request URL stays parseable, and a single quote stays masked.

## Evidence

- **Production, 2026-10-30:** every read; the quote; three test reservations (225, 227, 230), created and cancelled at once.
- **Sandbox, 2026-10-31:** all 15 tools through the provider.
  - Reservations 238 (create, links, cancel), 239 (party modify) and 240 (date modify, repriced 395000 → 790000; modify refused once cancelled).
  - The same token was accepted after 17 minutes.

## Review

`/code-review`, `/security-review` and `/pr-review` ran on PR #190 on 2026-10-31. Fixed on the branch:

- **Glossary:** Prettier had corrupted `CONTEXT.md` (`api_key` → `api*key`, broken `_Avoid_`) and re-padded the ADR index. Both are restored to `dev`, with only this PR's lines added.
- **Dot segments:** a document or promotional code made only of dots (`..`) is refused, because URL parsing would walk the request to another endpoint.
- **Truncated errors:** an error body truncated by the transport's 500-character cap still yields its validation sentences.
- **Not-found message:** "not found or cancelled" no longer claims a _reservation_ on non-reservation calls.
- **Empty answers:** `get_reservation` of an empty answer is "not found", and `find_reservations_by_guest` keeps a single-object answer.
- **Context:** `web_code` takes a number or a string of digits, never a coerced `true` or `'1e3'`.
- **Advance:** the advance type sent on create and modify is `CASH`, the only one observed accepted.
- **Redaction:** a single quote no longer ends a redacted query value.

**Second review** (`/code-review` and `/security-review` on the commits after the first review, 2026-10-31). Security found nothing at confidence ≥ 8. Fixed:

- **The guard failed open:** a single-object charges answer read as "no extras", and an advance sent as a numeric string read as 0. Now one helper reads every Avirato answer shape (`asItems`, `firstRow`, `amount`), and the guard's two reads run in parallel.
- **Fragments:** punctuation-only fragments are no longer forwarded as validation reasons.
- **`web_code`:** a value with surrounding whitespace is accepted.
- **Docs:** the contract and plan no longer say the advance type is the payment type.

**Not changed:** a cancelled extra charge still counts in the guard. That errs on the side of refusing, and no cancelled extra has been observed.

## The modify guard [CTO 2026-10-31]

**Observed (reservation 241):** a modify that does not send them removes the extras and the advance staff added. A 25000 extra disappeared and an advance of 50000 became 0.

**Decided:** the tool reads first and refuses with the facts (WOULD_REMOVE) unless the caller states `extras` and `advance`, and the read `get_reservation_charges` was added.

**Verified live (reservation 242):**

- the refusal changed nothing;
- the stated modify kept both the extra and the advance.

The record is on #190.

## Open

- **P-1, answered (reservations 234 and 237):**
  - Avirato charges a reservation only through **"Solicitar pago" in its back-office**: an amount and an email, then a MercadoPago link by email.
  - **The API has no endpoint for it.** No `/reservation/urls` link charges the reservation.
  - The hotel's Guest template is misconfigured (`error_fallback`).
  - Asked of Avirato through Esteban: can it be automated or exposed in the API?
- **`predefinedCharges` on a modify:** not observed (the CTO's pre-release item). The other item, an advance re-sent as `CASH`, survives (reservation 242).
- **Logo:** the house tile, in its own change.
- **Production test leftovers** in Reserva Donato's Avirato, for the hotel:
  - cancelled reservations 225, 227, 230, 234 and 237, plus a payment request for 237 sent to Sara's email (not paid);
  - draft bills 282, 284 and 287;
  - the client `XCALEPRUEBA1`.
