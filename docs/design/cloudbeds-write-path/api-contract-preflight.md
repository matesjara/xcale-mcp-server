# Cloudbeds Write-Path — API Contract Preflight

> **Status:** Preflight **Approved** (2026-07-10). The API Contract itself is **intentionally deferred** —
> not authored yet, pending primary wire evidence (P-1…P-4 below).
> **Companion:** `feature-design.md` (Approved, 2026-07-10). This preflight gates `api-contract.md`.
> **Last Updated:** 2026-07-10

## Why this document exists

The Feature Design may carry controlled uncertainty (its Q-3: "confirm against official docs"). The
**API Contract cannot freeze unverified provider wire semantics** — it is the exact, two-sided source of
truth both the MCP adapter and the consumer implement against. (A contract *may* enumerate
provider-defined uncertainty — "this endpoint MAY return one of these values" — and still be a valid
contract; what it cannot say is "this field name will be confirmed later".)

Therefore the API Contract is **deferred until the provider's wire semantics can be verified**, and this
preflight records precisely what is already evidenced versus what still needs a primary-source
observation. The contract is **authored only after primary evidence is complete** — that, not a slogan,
is what makes it correct on first write.

### Governing rule (transversal — lives in the skill)

This deferral follows the skill's **Evidence Before Contract (extended)** rule
(`.claude/skills/api-contract-authoring/SKILL.md`). This preflight exists because E-08's architecture is
closed (FD approved) while Cloudbeds' primary wire evidence is temporarily unavailable. The risk is
availability of primary evidence, not design.

---

## Frozen by the approved Feature Design (no verification needed)

The following are already settled in `feature-design.md` (Approved). This preflight **does not re-justify
them** — the contract simply inherits them: the call envelope + headers, the auth model (PMS OAuth,
Credential-in-Transit-Only, standard-risk), the error-code mapping, `ok()` verbatim result shaping, the
tool surface (`mcp_cloudbeds_create_reservation` + an additive external-reference filter on
`mcp_cloudbeds_list_reservations`), the new `CloudbedsClient.post(...)`, and the
booking-only / stateless / consumer-agnostic constraints.

## ✅ Wire facts confirmed from official Cloudbeds documentation (safe to freeze)

| Wire fact | Value | Source |
|:--|:--|:--|
| External-reference **request** field on `postReservation` | `thirdPartyIdentifier` | Official Cloudbeds documentation |
| Payment fields to **exclude** (booking-only boundary) | `cardToken` (Stripe Customer ID), `paymentAuthorizationCode` (Stripe Charge ID) | Official Cloudbeds documentation |
| Rate parameter | `rateID` (unique per room-type/rate combo across properties) | Official Cloudbeds documentation |
| `postReservation` does **not** process payment by itself | payment via separate endpoints (`postCharge`/`postPayment`/`postCreditCard`) | Official Cloudbeds documentation |
| API base URL | `https://hotels.cloudbeds.com/api/v1.3` | `src/providers/cloudbeds/client.ts` |

## ⏳ Pending primary-source verification (blocks the contract)

| # | Unknown | Why it blocks | How to resolve |
|:--|:--|:--|:--|
| P-1 | **Exact `postReservation` request schema** — field names + required/optional for: guest identity, room/room-type assignment, stay dates, rate, notes; and the **multi-room** shape (array vs indexed keys). | This is the core of the `create_reservation` input DTO; cannot be authored from recollection. | Rendered official `postReservation` reference **or** a live sandbox `postReservation` call. |
| P-2 | **Exact external-reference filter parameter exposed by `getReservations`.** | The `list_reservations` filter must use the provider's actual wire parameter name. | Rendered `getReservations` reference **or** a live sandbox call filtering by the stamped reference. |
| P-3 | **Request encoding required by the provider** for `postReservation`. | Determines how `CloudbedsClient.post(...)` serializes the request body. | Observe the official endpoint reference or a sandbox request. |
| P-4 | **`postReservation` success response shape** — does it return the created reservation (incl. `reservationID`) or only an id/ack? | Determines what the tool returns verbatim and any behavior-test fixtures. | Rendered reference / sandbox response capture. |

## Evidence required to lift the deferral

Exactly one of:
1. **A live Cloudbeds sandbox** (test property + OAuth token) to observe `postReservation` and
   `getReservations` requests/responses directly, **or**
2. **The rendered official endpoint reference** content for `postReservation` and `getReservations`
   (the pages at `developers.cloudbeds.com/reference/…` are a ReadMe SPA that WebFetch cannot render —
   pasted/rendered content would suffice).

> Note on why this is deferral, not failure: everything the contract needs *architecturally* is settled
> (FD Approved, Q-1/Q-2 resolved). The gate is purely the four wire facts above (P-1…P-4).

## When evidence arrives — the definitive path

1. Verify each ⏳ item against the primary source; record the observed values.
2. Author `docs/design/cloudbeds-write-path/api-contract.md` with only verified wire facts.
3. It carries no "pending" markers by construction — authored only after evidence is complete — and feeds
   implementation.
4. Retire this preflight (its checklist is fully consumed).

## Scope reminders the contract must honor (from the FD — do not re-decide)

- Booking-only — **no** payment fields (`cardToken`/`paymentAuthorizationCode` explicitly excluded).
- Stateless — no store/cache/worker; the MCP implements no dedup/idempotency, only the lookup filter.
- Consumer-agnostic wire; Provider Self-Containment (`src/providers/cloudbeds/**` only); additive contract.
