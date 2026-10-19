# Erbon Booking (write path) — Ship Log

- **Status:** in-soak — merged into `dev` 2026-10-06 with the provider, **PR #123**.
- **Released to prod:** 2026-10-07 via release PR **#128** (merge `59c10d1`), before the backend
  release `matesjara/xcale-backend#1432` (#1401), which is ACTIVE. The provider-wide log (tools, reviews, release order, open questions) is
  `../erbon-read-only-provider/ship-log.md`; this one covers the write path only.
- **Related:** `grill-notes.md` · `api-contract.md` · `implementation-plan.md` ·
  `../erbon-read-only-provider/sandbox-evidence.md` §6–§10 · ADR 0015 (the backend owns the
  idempotency boundary) · consumer: `xcale-backend#1401` (`docs/design/erbon-backend/`).

## What shipped

Five `controlPlane` tools the backend's booking adapters call — never the agent:

| Tool                             | Erbon                                      | Notes                                                                     |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `search_guest`                   | `GET guest/search`                         | Resolve the holder by email/phone/document                                |
| `create_guest`                   | `POST guest/new`                           | Correctable write (a duplicate guest is harmless)                         |
| `create_booking`                 | `POST booking/new` (AE79)                  | **Irreversible**, one room per call, at-most-once (single POST, no retry) |
| `get_booking` / `search_booking` | `GET booking/{id}` / `POST booking/search` | Read back the recorded total; find ours by voucher                        |

## Decisions that shaped it

- **Irreversible-write guards in the schema**, refused before Erbon: real calendar dates, check-out
  after check-in, and `ratePrices` covering exactly the stay's nights (one per night, no gaps,
  duplicates or extras).
- **The voucher is the idempotency key**: the backend stamps `voucher` per room
  (`${externalRef}-r{k}`); it round-trips as `onlineSaleChannelNumber`, which `search_booking`
  filters server-side. `search_booking` requires at least one filter.
- **Tax:** `totalWithTax` stays an optional passthrough the backend **omits** — omitted, Erbon applies
  the hotel's own tax (750 → 787.5); sent as 0, Erbon stores a 0 total (bookings 61714/61715).
- **Classification:** `idSource` / `idSegment` are optional passthrough; the backend sends the pair
  the hotel chose from `get_segment_sources` (Erbon asked for them on 2026-10-06; verified on 61767).

## Live evidence

61706 (first write), 61714/61715 (multi-room BB), 61716/61717 (tax applied by Erbon, quote = recorded
total), 61726, 61727, #1735, #1736 and #1774 / 61767 (through the backend agent on WhatsApp; 61767
filed under origin WHATSAPP / segment Direto).

## Deploy verification (prod)

- ✅ done (2026-10-07) — DigitalOcean deployment `5f5c6326` ACTIVE (~14:30 UTC); `/health` ok,
  `/discover` 401 unauthenticated, authenticated `/discover` lists `erbon` (schemaVersion 2026-10-06,
  providerVersion 0.3.0). Full record in `../erbon-read-only-provider/ship-log.md`.
- ✅ done (2026-10-07) — #127 (`search_booking` requires a filter) shipped in the same release.

## Known gaps

- No cancel or modify API at Erbon: a created booking is the hotel's to change. The backend never
  offers cancel/verify for Erbon.
- `create_guest.address` is `z.unknown()`; several string fields have no enum/format (review note,
  backend-only tools).
