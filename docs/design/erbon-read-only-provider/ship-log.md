# Erbon Provider — Ship Log

- **Status:** **on `dev`** — merged 2026-10-06 via **PR #123** (release owner's walk, merge-ready).
  **Not yet released to prod.** Tracking: #112. Write path: `../erbon-booking/ship-log.md`.
- **Release order:** deploy this **before** `xcale-backend#1401` goes live — the backend's booking
  adapters call these tools. No new env var: `reference` resolution reuses `CREDENTIAL_RESOLVE_URL` /
  `CREDENTIAL_RESOLVE_SECRET`.
- **Related:** `feature-design.md` · `api-contract.md` · `implementation-plan.md` ·
  `sandbox-evidence.md` (§1–§10, every shape Observed live) · ADR 0020 (authDescriptor field names
  are non-secret — Accepted by Mateo, 2026-10-06) · ADR 0013 (control-plane tools) · ADR 0010
  (credential delivery).

## Summary

Erbon (LATAM hotel PMS) as a standard provider. `credential_exchange` auth with **`reference`**
delivery (the durable username/password stay in the backend's Rail A; this server redeems a
single-use nonce for the minted JWT). `hotelID` is strict call context, never a tool argument. Data
returned verbatim; errors never echo Erbon's body (`unwrapErbon`: operation label + HTTP status).

## What shipped (12 tools)

| Tool                                                               | Agent menu      | Purpose                                                                                               |
| ------------------------------------------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------- |
| `check_availability`, `list_room_types`, `list_rates`, `get_hotel` | ✅              | Hotel catalog reads                                                                                   |
| `get_rate_prices`                                                  | ❌ controlPlane | Per-night price per `numberPAX` and meal plan (money guard)                                           |
| `get_lodging_tax`                                                  | ❌ controlPlane | The hotel's daily-rate services + tax catalog; the backend derives the rate                           |
| `get_segment_sources`                                              | ❌ controlPlane | The hotel's active booking origins/segments (AE80); the hotel picks the pair its xcale bookings carry |
| `search_guest`, `create_guest`                                     | ❌ controlPlane | Resolve / register the holder                                                                         |
| `create_booking`                                                   | ❌ controlPlane | One reservation per call — **irreversible** (no cancel/modify API)                                    |
| `get_booking`, `search_booking`                                    | ❌ controlPlane | Read back; find ours by voucher (`onlineSaleChannelNumber`, filtered server-side)                     |

Also: the provider logo (`assets/erbon.webp`, `logoUrl` in the manifest); `schemaVersion`
2026-10-06, `providerVersion` 0.3.0.

## Reviews

- `/code-review` (two rounds, all findings fixed: `f164361`, `7065d1d`), `/security-review` clean.
- Release-owner review (2026-10-06): merge-ready; controlPlane is menu hiding, not an auth boundary —
  safe because every controlPlane call on the consumer is a literal in an adapter.

## Live evidence (sandbox hotel `964d9ad8-…`)

Bookings created through these handlers: 61706, 61714–61717; through the backend agent on WhatsApp:
61726, 61727, #1735, #1736, #1774 (61767). Quote = Erbon's recorded total on every one; 61767 carries
origin 6 WHATSAPP / segment 2 Direto. Erbon has no cancel API — these stay in the sandbox (Erbon's PM
is informed).

## Dependency fixes that rode along

The 2026-10-06 advisories turned the audit gate red on every branch: `proxy-addr` 2.0.8 (critical),
`@modelcontextprotocol/sdk` 1.32.1 (high), vitest 3 → 5 (dev-only `tinypool`, critical). They landed
on `dev` with #123 (the standalone PR #126 carried the same three commits).

## Follow-ups from the review (done on `chore/erbon-mcp-followups`)

- This ship-log and `../erbon-booking/ship-log.md`.
- Stale comments fixed: `search_booking` (the voucher IS filtered server-side) and the manifest
  header (the write path is live, backend-only).
- `search_booking` now requires at least one filter: unfiltered, it returned every booking of the
  hotel. Both consumer calls always filter (`bookingNumber`, `onlineSaleChannelNumber`).

## Known gaps / open with Erbon

- Not blocking (review notes): several string fields have no enum/format; `create_guest.address` is
  `z.unknown()`. Backend-only tools.
- Which daily-rate service a rate charges is not in `mapping/rates` (Giovanni: the rate decides it) —
  asked to expose it.
- Our voucher shows in the PMS as **Coupon Code** — asked whether that is the expected field.
- No Colombian sandbox hotel yet: the non-BR `taxes` block is read from the swagger shape, not yet
  Observed.
