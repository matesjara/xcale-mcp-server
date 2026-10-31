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

## What shipped (14 tools)

| Tool                                                                                | Agent menu      | Purpose                                                                                     |
| ----------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `get_establishment`, `list_room_types`, `list_rates`, `list_regimes`, `list_extras` | ✅              | Hotel catalog reads                                                                         |
| `check_availability`, `validate_promotional_code`                                   | ✅              | Free rooms per night; whether a code exists                                                 |
| `get_reservation`, `find_reservations_by_guest`, `get_reservation_links`            | ✅              | One guest's stay, by id or document, and its Guest/Shop/AutoCheck links; bound to its owner |
| `quote_stay`                                                                        | ❌ controlPlane | Price of a stay per rate (money guard)                                                      |
| `create_reservation`                                                                | ❌ controlPlane | One reservation; Avirato prices it; the tag reads back as `promotional_package`             |
| `modify_reservation`                                                                | ❌ controlPlane | The room's full record; Avirato reprices; clears the tag                                    |
| `cancel_reservation`                                                                | ❌ controlPlane | Leaves it `Reserva cancelada`; its draft bill stays                                         |

Also in this PR, in `src/core/`:

- the `credential_exchange` descriptor gains a closed dotted key path and `tokenTtlSeconds` (ADR);
- `redactQueryValues` ends a value at a double quote, so a provider's one-line JSON error body that echoes the request URL stays parseable, and a single quote stays masked.

## Evidence

- **Production, 2026-10-30:** every read; the quote; three test reservations (225, 227, 230), created and cancelled at once.
- **Sandbox, 2026-10-31:** all 14 tools through the provider.
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

## Open

- **P-1:** which link (`Guest` or `Shop`) lets the guest pay. It needs a live production reservation, because a sandbox reservation's Guest link opens the production guest app.
- **Modify and staff changes:** a modify sends no extras and no advance. Whether that resets extras or an advance that hotel staff added in Avirato's back-office is not observed.
- **Logo:** the house tile, in its own change.
- **Production test leftovers** in Reserva Donato's Avirato, for the hotel:
  - cancelled reservations 225, 227 and 230;
  - draft bills 282, 284 and 287;
  - the client `XCALEPRUEBA1`.
