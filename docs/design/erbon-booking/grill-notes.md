# Erbon booking write-path — grill notes (pre feature-design)

- **Status:** alignment (grill COMPLETE for the MCP side). Q1–Q3 resolved; Q4 is the backend phase.
- **Branch:** single branch `feat/erbon-read-only-provider` (read-only + booking write together — one branch by decision 2026-09-28).
- **Date:** 2026-09-28
- **Code target repo:** `xcale-mcp-server` (the create tool lands in the existing `erbon` provider, not a new provider). Write-**safety** lives in `xcale-backend` (separate phase).
- **Source:** Erbon Swagger (`POST /hotel/{hotelID}/booking/new`, "AE79"), live sandbox, and Giovanni's 2026-09-28 email (create endpoint + example payload). See `../erbon-read-only-provider/sandbox-evidence.md` §6.
- **Epic:** `matesjara/xcale-backend#1040`. Backend enablers already building: `#1077` (Core picks adapters per provider), `#1082` (booking tools for any PMS).

> Working document. The read-only quote provider (`../erbon-read-only-provider/`) is a separate, complete phase; this folder covers only the booking **write**.

---

## 1. Scope

Add the ability to **create a reservation** in Erbon from xcale. The MCP side is one new tool on the existing `erbon` provider. Everything else (availability guard, idempotency, propose→confirm) is the backend phase.

## 2. Recon findings (verified — sandbox + swagger, 2026-09-28)

1. **`POST /hotel/{hotelID}/booking/new` is live** ("AE79 - Create a new booking"). Swagger `required: []` (Erbon validates server-side). Giovanni's "principal" fields: `idBookingStatus, checkInDate, checkOutDate, idRoomTypeReserved, idRoomTypeOccupied, numberAdults/Children/Children2/Babies, idConfigPension, idRate, ratePrices[], isDirect, isCompany, idCompany, idAgency, idSource, idSegment, voucher, isRateDefault, commentsBooking, guests[]`.
2. **NO cancel and NO modify exist** — and no compensating action of any kind (unlike Siigo fiscal, whose correction is a credit note). **A created Erbon booking cannot be undone via the API.** This is the single most important fact.
3. **Overbooking:** the API creates a booking even with no availability — the caller owns the availability check.
4. **One room per reservation** — each booking is a separate call; no multi-room array.
5. **`voucher`** is a caller-supplied field — the natural idempotency / reconciliation handle (mirrors Siigo's reference tag, ADR 0015).
6. **Guest prerequisite:** `guests[].idGuest` is required for a booking; a guest must exist first (`GET /guest/search`, `POST /guest/new`).

## 3. Resolved decisions

- **D1 — ADR 0015 (fiscal-write-path) governs the boundary.** MCP write tool = **thin passthrough**: validate input shape, POST, return verbatim. No dedup, no idempotency ledger, no availability decision, no retry. One tool call = at most one external mutation. All write-safety lives in the consumer (xcale-backend). Not re-litigated — this is the repo's invariant, set by ADR 0015 and the Cloudbeds booking write-path (E-08).
  - **Erbon refinement to surface:** ADR 0015 responsibility #3 (compensation) has **no Erbon analog** — there is no cancel/credit-note. So the propose→confirm (responsibility #2) is even more load-bearing, and almost certainly must be **human-gated**, not agent/system-autonomous. (Backend decision; flag to Mateo.)
- **D2 — `mcp_erbon_create_booking` is `controlPlane: true`** (backend-only, withdrawn from `listTools()`). Confirmed 2026-09-28. Rationale: irreversible + overbooking risk → the agent must never be able to invoke it; the backend orchestrates it behind its own gates. Same mechanism as `get_rate_prices` (AD-2), justified by ADR 0013 (control-plane-tools). Rejected: exposing it on the agent menu with a confirm-signal (Siigo-fiscal style) — for a no-undo action we withdraw it from the agent entirely.

## 4. Open questions

- **Q2 (scope) — Guest prerequisite. RESOLVED (2026-09-28): YES.** Add thin `mcp_erbon_search_guest` + `mcp_erbon_create_guest` to the `erbon` provider, both `controlPlane`. `idGuest` is required for a booking, so keeping the full ensure-guest flow in the MCP means the backend has everything to orchestrate a booking with no missing dependency. `create_guest` is a lower-stakes correctable write (a CRM record, editable via `guests/update`), so lighter gating than the booking itself.
- **Q3 (contract) — `create_booking` input shape. RESOLVED (2026-09-28).** Faithful thin passthrough with a coherent minimum:
  - **Required:** `checkInDate`, `checkOutDate` (ISO `YYYY-MM-DD`), `idRoomTypeReserved`, `idRoomTypeOccupied`, `idRate`, `idConfigPension` (`RO`/`BB`/`HB`/`FB`/`AI`), `numberAdults`, `ratePrices[]` (`[{ date, price }]` — the price to charge per night, composed by the backend from the quote), `guests[]` (`[{ idGuest, isHolder }]`).
  - **Optional passthrough:** `voucher` (idempotency — filled by the backend, NOT required at the MCP level, per ADR 0015), `idBookingStatus`, `numberChildren`/`numberChildren2`/`numberBabies`, `isDirect`/`isCompany`/`idCompany`/`idAgency`/`idSource`/`idSegment`, `isRateDefault`, `commentsBooking`, `contact*`, etc.
  - **Validation:** dates ISO, ids positive ints; nothing else — Erbon validates the rest (no reimplementation of its business rules).
  - **One room per call** — no room array; each reservation is a separate `create_booking`.
- **Q4 (backend, flagged) — human-gated confirm.** Given no undo, the propose→confirm must be a human (guest/hotel staff), not the agent. Decided in the backend grill; raise to Mateo.

## 5. ADRs

No new ADR: the boundary is ADR 0015 (fiscal-write-path) + ADR 0013 (control-plane-tools). The "Erbon has no compensating action" point is a **refinement/annotation to surface on ADR 0015 and the epic**, not a new decision — it strengthens, not contradicts, 0015.

## 6. Proposed tools (MCP)

| Tool | Endpoint | controlPlane | Notes |
|:--|:--|:--:|:--|
| `mcp_erbon_create_booking` | `POST /hotel/{hotelID}/booking/new` | ✅ | thin passthrough; one room; `voucher` passed through (backend owns idempotency); returns Erbon's create response verbatim |
| `mcp_erbon_search_guest` | `GET /hotel/{hotelID}/guest/search` | ✅ (Q2) | resolve an existing guest by document/id before booking |
| `mcp_erbon_create_guest` | `POST /hotel/{hotelID}/guest/new` | ✅ (Q2) | create a guest when none exists (correctable write) |

## 7. Next step

Resolve Q2–Q3, then `/feature-design` + `/api-contract-authoring` + `/implementation-plan` in this folder, then build (thin passthrough tools on the existing `erbon` provider). Backend write-safety phase depends on `#1077`/`#1082`.
