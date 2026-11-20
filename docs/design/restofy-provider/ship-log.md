# Ship Log — restofy-provider

- **Status:** on-dev
- **Released to prod:** not yet
- **Related:** [feature-design.md](feature-design.md) · [api-contract.md](api-contract.md) · [implementation-plan.md](implementation-plan.md) · PR matesjara/xcale-mcp-server#224
- **Consumer:** matesjara/xcale-backend#2935 (Phase 2; epic #2933)

## Build notes & deviations

- Built test-first, slices S1–S8 of the plan, in the PR's own branch: the design and the implementation travel in one PR (Sara, 2026-11-18).
- **CTO records on #224 (2026-11-18):** `create_order` control plane — the reason corrected (Toteat publishes its own; the precedent is Avirato AD-4); one-day TTL; `create_contact` never updates.
- **`reservedAt` is converted to UTC.** Restofy accepts only UTC with `Z` and refuses an offset, which the contract had not recorded; caught by the contract QA live (2026-11-19). The tool takes any offset and sends the same instant.
- **`list_reservation_slots` names an unknown area** (`reason: "unknown_area"`), from the same QA.
- The stale picomatch audit exception (GHSA withdrawn 2026-11-18) is fixed in its own PR, matesjara/xcale-mcp-server#225; until it merges, CI on any PR fails the audit step.
- `assets/restofy.svg` is a plain fork-and-knife glyph on the house tile: Restofy publishes no vector mark.

- **Review of #224 (Mateo, 2026-11-19) — blocker fixed (`6151229`):** a `reservedAt` or a date that does not exist (31 February, 25:99) was rolled by `Date` into another day or threw past the typed result. Both are now refused with `INVALID_INPUT` before Restofy is called; two tests.
- **Restofy retired `diner-reservation/list-reservation-slots`** (it answers `Acción no encontrada`; found in the WhatsApp E2E, 2026-11-20). Its own diner booking page now reads `diner-reservation/list-reservation-areas { slug }`, which carries every online-bookable area's open days and slots; `list_reservation_slots` reads the asked date there. Its published output is unchanged (`{ slots: [{ iso, isFull }] }`), so the consumer is untouched. Fixture `dinerAreas.json` recorded from the sandbox.
- `get_business_profile` adds `tenant: { currency, slug, locale }` (from `tenants/get-tenant-info`), additive: the backend's shipping quote needs the currency every amount is in, and no other tool exposed it (2026-11-19).

## Ship Log

### Migrations

- N/A (no migration: the provider is stateless)

### Manual UI / QA (dev period)

- 2026-11-18 sandbox spike on xcale's own test restaurant: auth, menu, dry run and 3 orders, idempotency, contacts, a reservation created and cancelled, public slots, delivery statuses (evidence on matesjara/xcale-backend#2934).
- 2026-11-19 all 16 tools live through the provider (test restaurant); adjustment: none.
- 2026-11-19 writes live through the provider: order `xcale-qa-2026-11-19` sent 3 times (same, same, changed body) → one order `93N-U92`; reservation 3 created, found by phone, cancelled; adjustment: none.
- 2026-11-19 `mcp-contract-qa`: BLOCKED — an offset `reservedAt` refused by Restofy; `audit-exceptions.json` outside the footprint. Adjustments: UTC conversion + `unknown_area` + a description fix (`a357712`); audit fix moved to #225. Reservation 5 created with `-05:00` and stored as the same UTC instant, then cancelled.
- 2026-11-19 `create_reservation` declares `createdRecordIdField: reservationId` (`restofy:reservation`) so the diner owns what they book [CTO 2026-11-19, xcale-backend#2935]; `schemaVersion` 2026-11-19.
- 2026-11-19 `mcp-contract-qa` re-run on `a357712`: PASS — footprint clean; reservation 6 booked with `-05:00`, stored as the same UTC instant, cancelled; `unknown_area` live; suite 1187 tests, typecheck and format clean. ✅

- 2026-11-20 WhatsApp E2E through the backend consumer (matesjara/xcale-backend#2935, local MCP + backend, the restaurant's agent on the dev line): profile, channels, menu, the order (dry run, then `65F-C99` placed once, unpaid, 35.000), order status, contact by phone, areas, slots (after the fix above), a reservation for 2 created, read and cancelled. ✅

### Feature flags / config

- Test credentials in Doppler `xcale-mcp-server` / `dev_sara` (`RESTOFY_API_KEY`, `RESTOFY_TENANT_KEY`), 2026-11-19 — for QA only; the provider reads no config (Rail A holds every restaurant's key).

### Deploy verification (prod)

- [ ] `server/discover` lists `restofy`, `tools/list` its 13 tools; one live call once the backend half is live — ⬜ pending · matesjara/xcale-mcp-server#226

## Known gaps at ship

- Kitchen stages are not visible through Restofy's integration API (R-2) → asked of Restofy; nothing to build.
- Payment through xcale's Payment Request, reservation deposits, polling for status updates and the CRM → fast-follows on epic matesjara/xcale-backend#2933 (#2936 for polling and CRM).
- Test data left on the test restaurant: open orders `xcale-test-001`, `-004`, `-005`, `xcale-qa-2026-11-19`, `xcale-contractqa-…` (the API cannot cancel an order); contacts 1 and 2; reservations 1–5 cancelled; from the 2026-11-20 E2E, order `65F-C99` (open) and the E2E reservations, all cancelled.
