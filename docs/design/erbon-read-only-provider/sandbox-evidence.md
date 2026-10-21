# Erbon — sandbox evidence

- **Date observed:** 2026-09-26 → 2026-09-28
- **Host:** `https://api.erbonsoftware.com` (single host; sandbox = partner-issued test credentials, no separate base URL observed)
- **Credentials:** partner-issued sandbox login (user `economy`, role `ECONOMY`) + `hotelID 358AC521-…`. Secrets are **not** recorded here (Credential-in-Transit-Only); values live only in the connect flow / Rail A.
- **Method:** read-only `curl` probes. No write endpoints were exercised.

All shapes below are **Observed** (verbatim from live responses), not inferred from the swagger.

---

## 1. Auth — `POST /auth/login`

Request body: `{ "username": "…", "password": "…" }` → **HTTP 200**. Response shape:

```json
{ "bearerToken": "eyJhbG…(439-char JWT)", "expirationUTCDate": "2026-09-28T01:16:35.4536443Z" }
```

- Token field: **`bearerToken`** (JWT). Applied as `Authorization: bearer <jwt>` on data calls.
- Expiry field: **`expirationUTCDate`** — an **absolute UTC datetime** (~48h lifetime), NOT `expires_in` seconds. ← divergence from Siigo; see grill-notes Q1.

### JWT payload claims (decoded, non-secret)

```json
{
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name": "0fa1ff82-f39e-438e-a2b5-85b3f1aaba1b",
  "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "ECONOMY",
  "exp": 1790648383
}
```

The identity claim is an **account GUID**, not the `hotelID` — proving the credential is account-scoped and `hotelID` is per-call context (grill D4).

## 2. Endpoint enumeration (from swagger, 65 paths)

- **Booking:** `GET /hotel/{hotelID}/booking/{id}`, `POST /hotel/{hotelID}/booking/new`, `POST .../booking/search`, `PUT .../booking/{id}/checkin`, `PUT .../booking/{id}/checkout`, `POST .../booking/{id}/invoice`, guest attach/new/remove, `POST /hotel/booking/list`, `POST /booking/localizerList`.
- **Cancel / modify a booking:** **NONE.** No cancel/delete/update-dates/change-room endpoint exists. The only booking PUTs are `checkin`/`checkout`.
- **Availability:** `GET /hotel/{hotelID}/availability`, `GET .../availability/inventory`, `GET .../occupancy/withpension`.
- **Rates/prices:** `GET .../mapping/rates`, `GET .../mapping/rateprices`, `POST .../sales/rate/prices`, `POST .../sales/rate/prices/mealplan`.
- Non-`{hotelID}` paths: `POST /hotel/booking/list`, `POST /booking/localizerList`, `POST /hotel/hotelid` (localizer→hotelID), `GET /mapping/errors`. → no "list my hotels" listing.

## 3. Reads that work (live, HTTP 200)

**`GET /hotel/{hotelID}/availability`** — headers `checkinDate: 2026-10-20`, `checkoutDate: 2026-10-23`:

```json
[{"date":"2026-10-20","roomTypeDescription":"SUITE ESTANDAR","statusAvailability":8},
 {"date":"2026-10-20","roomTypeDescription":"SUITE JUNIOR","statusAvailability":12}, …]
```

Note: rows key on `roomTypeDescription`, **no id**.

**`GET /hotel/{hotelID}/mapping/roomtype`**:

```json
[{"id":2,"code":"STD","description":"SUITE ESTANDAR","minPax":1,"maxPax":2,"externalCode":"","roomCount":8,"roomCountOccupied":1}, …]
```

**`GET /hotel/{hotelID}/mapping/rates`**:

```json
[{"id":3,"code":"Estandar RC-Channel","description":"Estandar RC-Channel","allowRO":true,"allowBB":true,"allowHB":true,"allowFB":true,"allowAI":true,"isDerived":false,"derivation":null}, …]
```

Meal plans are flags per rate: `allowRO/BB/HB/FB/AI` (Room Only / Bed&Breakfast / Half Board / Full Board / All Inclusive).

## 4. Reads that returned empty or error

**`GET /hotel/{hotelID}/mapping/rateprices`** — headers `dateFrom`/`dateTo`/`idRate`/`idRoomType` → **HTTP 200 but `[]`** for every combo tried:

- rates {1,3,4,5,6} × roomTypes {2,4,5} × Nov date range → all `[]`
- year-end window (rate 1 = "Tarifa Fin de ano") × roomTypes {2,5} → `[]`
- near-date range, no roomType filter, and datetime-format dates → `[]`

Endpoint is healthy; the sandbox hotel simply has **no prices loaded**. → waiting on Erbon to seed prices (grill Q3). Not a blocker to building the provider (use a hand-made fixture).

**`GET /hotel/{hotelID}/availability/inventory`** → **HTTP 400** `ERR_ROOM_AVAILABILITY_FETCH` (wrong/missing params — not needed for the quote path).

**`GET /hotel/{hotelID}/occupancy/withpension`** → **HTTP 400** (not needed for the quote path).

## 5. Corroborating email (Erbon → Sara, 2026-09-22)

Erbon (Giovanni Neto) confirmed in writing that **creating reservations via the API is not yet possible** (only availability + prices), and estimated create + cancel + date-change ~3 weeks out. Matches §2 (no cancel/modify) and §4 (prices pending). Booking write is a future `erbon-booking` phase.

## 6. Update 2026-09-28 — prices seeded + CREATE endpoint live (Giovanni)

Giovanni provided a hotel with prices loaded and shipped the create endpoint.

- **New hotelID with prices:** `964d9ad8-d143-4d29-bd09-114afecdd99a`. A credential reaches multiple hotels (he will send the accessible hotelIds) — confirms `hotelID` is per-call context, not the credential identity.
- **`GET /mapping/rateprices` now returns data (Observed).** Row shape carries **per-meal-plan prices inline** (not a single `price` field as A.8 inferred):
  ```json
  {
    "id": 157308,
    "idRoomType": 2,
    "idRate": 1,
    "date": "2026-09-29",
    "priceRO": 346.0,
    "priceBB": 396.0,
    "priceHB": 446.0,
    "priceFB": 496.0,
    "priceAI": 546.0,
    "currencyCode": "..."
  }
  ```
  One row per date; the meal plan (`RO/BB/HB/FB/AI`) selects the price field. This resolves the price-composition question — meal-plan pricing is inline, no separate read. **A.8 in api-contract must be updated to this Observed shape.** (Sweep: `rate=1 room=2` → 14 rows; other combos in that hotel returned `[]`, i.e. only priced combos carry rows.)
- **`POST /hotel/{hotelID}/booking/new` is LIVE** ("AE79 - Create a new booking"). Swagger `required: []` (Erbon validates server-side); Giovanni's "principal" fields: `idBookingStatus, checkInDate, checkOutDate, idRoomTypeReserved, idRoomTypeOccupied, numberAdults/Children/Children2/Babies, idConfigPension, idRate, ratePrices[], isDirect, isCompany, idCompany, idAgency, idSource, idSegment, voucher, isRateDefault, commentsBooking, guests[]`. Full prop set also has `idRoom, manualValue, totalWithTax, contact*`, etc.
- **⚠️ Still NO cancel and NO modify** in the swagger (only checkin/checkout/invoice/guest attach-remove). **A created booking cannot be undone via the API.**
- **Erbon's own caveats:** (1) the API will create a booking **even with no availability** (overbooking) — the caller must check availability first; (2) **one room per reservation** — each booking is a separate call. The `voucher` field is caller-supplied (candidate idempotency/reconciliation key).

## 7. Update 2026-10-01 — WRITE PATH exercised end-to-end (live sandbox test booking)

A deliberate test booking was created in the sandbox (`hotelID 964d9ad8…`, holder `QA XCALE …`) to confirm the write/read shapes — a sandbox booking is safe (no real hotel) though it cannot be cancelled via API. **All shapes below are Observed (verbatim).**

- **`POST guest/new`** → id field is **`id`**: `{ "id":20652, "name":"…", "email":null, "phone":null, "address":{…}, "documents":[] }`.
- **`POST booking/new`** (one room, 2 adults, RO) → **HTTP 200**:
  ```json
  { "bookingInternalID": 61706, "number": 1713, "serie": "RSVN1" }
  ```
  Create returns `bookingInternalID` (internal anchor), `number` (guest-facing = `erbonNumber` on reads), `serie`. **No `voucher`/`status` in the create response.**
- **`GET /hotel/{hotelID}/booking/{bookingInternalID}`** and **`POST .../booking/search`** rows share one shape. Key fields (Observed):
  ```json
  {
    "bookingInternalID": 61706,
    "erbonNumber": 1713,
    "onlineSaleChannelNumber": "xbk-qa-…",
    "status": "BOOKING",
    "confirmedStatus": "CONFIRMED",
    "roomTypeID": 2,
    "roomTypeDescription": "LUXO SOLTEIRO",
    "checkInDateTime": "2026-11-10T15:00:00",
    "checkOutDateTime": "2026-11-12T12:00:00",
    "adultQuantity": 2,
    "childrenQuantity": 0,
    "totalBookingRate": 742,
    "totalBookingRateWithTax": 779.1,
    "rateId": 1,
    "rateDesc": "Balcony",
    "currencyId": 2,
    "observations": "…(=commentsBooking)",
    "guestList": [{ "id": 20653, "mainGuest": true, "name": "…", "email": null, "phone": null }]
  }
  ```
  - **The voucher round-trips as `onlineSaleChannelNumber`** (NOT a field named `voucher`). ⇒ reconcile matches on `onlineSaleChannelNumber` client-side.
  - Guest-facing number is **`erbonNumber`**; the main guest sits in **`guestList[]`** (`mainGuest:true`); check-in is **`checkInDateTime`**; state is **`status`/`confirmedStatus`**.
- **`booking/search` honours these filters SERVER-SIDE** (headers), each returning exactly the one booking: `onlineSaleChannelNumber=<voucher>` ✅, `bookingNumber=1713` ✅, `checkin`/`checkout` ✅. ⇒ reconcile can narrow server-side by the voucher; lookup can filter by `bookingNumber`.
- **`rateprices` is keyed by occupancy.** One row **per `numberPAX`** per date (not one row per date): `numberPAX=2 priceRO=370` and `numberPAX=1 priceRO=660` for the same night. Also carries `paxType` ("ADULT") and **`isTaxIncluded`**. ⇒ price MUST be selected by the party's pax; occupancy pricing is available (resolves the `occupancyPriced` question).
- **⚠️ Tax is contradictory — keep the scar.** The rate row says `isTaxIncluded:true`, yet the created booking shows `totalBookingRate 742` vs `totalBookingRateWithTax 779.1` (**+5% added on top**). So the rate price is NOT a settled, tax-final figure. Quote stays `taxesIncluded:false` + caveat until Erbon's tax treatment is pinned (backend #1252). **Question for Giovanni:** what does `isTaxIncluded:true` mean if the booking still adds 5%? and is that 5% always applied?
- **Odd (verify with Giovanni):** 1-pax price (660) > 2-pax price (370) for the same room/date — confirm the `numberPAX` semantics before relying on single-occupancy pricing.

## 8. Update 2026-10-04 — final payload (multi-room + BB + tax) exercised end-to-end

The real backend Gate + Erbon adapters drove the real MCP tool handlers (zod-validated) against the sandbox (`hotelID 964d9ad8…`): 2 rooms of `LUXO SOLTEIRO` (id 2), rate 1, **BB**, 4 adults split 2+2, `2026-11-17 → 2026-11-19`, `totalWithTax: 0` sent. **All Observed.**

- **Prices:** BB rows exist only for `numberPAX=2` (`priceBB` is `null` for `numberPAX=1`). 2-pax BB = 374 + 376 = 750 per room.
- **Create:** two calls, two reservations — `bookingInternalID 61714 / number 1721` (voucher `…-r0`) and `61715 / 1722` (voucher `…-r1`).
- **Readback (`GET booking/{id}`):** `totalBookingRate: 750` (the BB prices were taken), `adultQuantity: 2`, `onlineSaleChannelNumber` = the per-room voucher, `status: BOOKING`, `confirmedStatus: CONFIRMED`. The read row carries **no meal-plan field** — the board is only visible through the price.
- **⚠️ `totalBookingRateWithTax: 0`.** Erbon stores the sent `totalWithTax` verbatim; it does NOT compute the tax separately. Compare §7 (field omitted): `742 → 779.1`, i.e. Erbon applied the hotel's own 5%. **Decision (Sara, 2026-10-04): omit `totalWithTax`** — the hotel configures its tax in Erbon and the PMS owns that calculation.
- **Reconcile:** a second run found both rooms by voucher and created nothing (creates before/after: 2/2).
- **No lodging-tax read exists.** `GET /hotel/{hotelID}/settings/taxes` (AE76) lists taxes for services/products only, and returns `[]` for a BR-fiscal hotel. The hotel profile (`GET /hotel/{hotelID}`) carries no tax rate either. So the backend cannot read the tax Erbon will apply — its quote still uses the per-hotel `ivaRate` set on the connection. **Question for Giovanni:** is there a read for the lodging tax rate (or a tax-inclusive price) so the quote can come from Erbon too?
- **Option A confirmed live (same day).** One room, BB, 2 adults, same dates, `totalWithTax` **omitted** → `bookingInternalID 61716 / number 1723`. Readback: `totalBookingRate: 750`, `totalBookingRateWithTax: 787.5` — Erbon applied the hotel's own 5%, matching the backend quote to the cent (`subtotal 750 + taxes 37.5 = total 787.5`, `ivaRate: 5`). Reconcile adopted it by voucher with no second create.

## 9. Update 2026-10-04 — the lodging tax is readable (new tool `get_lodging_tax`)

Giovanni (2026-10-04): Erbon rates are **always net**; there is **no dedicated tax endpoint** — it depends on how each hotel is configured; most hotels charge the tax on top of the daily rate (Colombia 19%, Brazil 5%). The swagger's own description of `CreateBookingModel.totalWithTax` agrees: when absent, Erbon adds "the taxes the hotel charges on top of the room price (e.g. ISS in Brazil, ISH in Mexico), calculated with the tax settings of the hotel".

**Where those settings live (Observed, read-only):**

- `GET mapping/serviceproducts` (AE49) lists services; it does **not** say which one is the daily rate.
- `GET service/{id}` (AE72) does. On the BR sandbox hotel:
  - `id 2 "Daily"` → `isDailyRate: true`, `isServiceTax: true`, `fiscalCountry: "BR"`, `taxesBR.iss: 5` — **the 5% Erbon added to our bookings** (750 → 787.5).
  - `id 88 "DayUse"` → `isDailyRate: true`, `taxesBR.iss: 0` (`pis: 5`, `cofins: 5`).
- `GET settings/taxes` (AE76) is the tax catalog for **non-BR** hotels (a service's `taxes` block holds ids into it, with `iva` as the percentage); it returns `[]` for this BR hotel. **No non-BR hotel observed yet.**
- `RatePriceModel.isTaxIncluded` is ignored: per Giovanni, rate prices are always net.
- The `POST .../sales/rate/prices*` endpoints are **writes** ("Insert rate prices"), not quotes — never called.

**`mcp_erbon_get_lodging_tax`** (controlPlane, backend-only) returns `{ dailyRateServices, taxes }` verbatim: it reads the service list, the detail of every service (products skipped, 5 at a time; one failed read fails the tool rather than answering partly) and the tax catalog. The backend derives the rate. Live check (dry run, no booking): the backend quote for the §8 stay is `subtotal 750 + taxes 37.5 = 787.5` — what Erbon recorded on 61716 — with no rate typed by anyone.

- **Final code, live (2026-10-05).** Real backend Gate + adapters → these tool handlers, 1 room BB, 2 adults, `2026-11-17 → 2026-11-19`: the quote read the tax from Erbon (`get_lodging_tax` → "Daily" ISS 5%) → `750 + 37.5 = 787.5`; the create omitted `totalWithTax` → `bookingInternalID 61717 / number 1724`; the read-back put `grandTotal: 787.5` on the handoff (what Erbon recorded = the quote, no `TOTAL DRIFT`); a retry reconciled by voucher with no second create.

## 10. Update 2026-10-06 — origin and segment are the hotel's (new tool `get_segment_sources`)

Erbon (2026-10-06), showing booking 61717 in the PMS with **Origin** and **Segment** empty: "none of them
included the origin and segment information; you must send it, or the hotel has to associate it by hand."

- `create_booking` already took `idSource` (origin) and `idSegment` (segment) as optional passthrough;
  the backend sent neither.
- The ids are per hotel: **`GET /hotel/{hotelID}/settings/segmentsources`** ("AE80 — Get the booking
  segments and sources", active only; "use the returned ids in the idSegment and idSource fields of
  AE79"). Observed on the sandbox hotel:
  - sources: `4 DIRETO`, `8 EMPRESA`, `7 INSTAGRAM`, `9 OPERADORA`, `2 OTA`, `5 TELEFONE`, `10 TESTE`,
    `3 WebSite`, `6 WHATSAPP`;
  - segments: `5 Agencia de Viagem`, `2 Direto`, `7 Empresa`, `8 Não informado`, `6 Operadora`.
- **`mcp_erbon_get_segment_sources`** (controlPlane, backend-only) returns that catalogue verbatim. Which
  pair an xcale booking carries is the HOTEL's choice (stored on its backend connection); nothing here
  names one.
- Also observed on 61717: our `voucher` shows in the PMS as **Coupon Code** (open question for Erbon:
  the expected field for an external channel's reference).
- Not exposed by the API (open question for Erbon): which daily-rate service a RATE charges — Giovanni
  confirmed the rate decides it, but `mapping/rates` carries no service id.
