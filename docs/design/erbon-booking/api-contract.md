# Erbon Booking Write-Path — API Contract

> **Module**: `src/providers/erbon/` (xcale-mcp-server) — three new `controlPlane` tools on the existing provider. Write-**safety** lives in `xcale-backend` (separate phase).
> **Kind**: External-provider adapter contract (write extension). Auth (B) and context (`hotelID`) are unchanged from `../erbon-read-only-provider/api-contract.md` — not repeated here.
> **Upstream**: [grill-notes.md](grill-notes.md) · ADR 0015 (fiscal-write-path, the boundary) · ADR 0013 (control-plane-tools).
> **Status**: Draft. Concrete params are **Observed** (swagger + `../erbon-read-only-provider/sandbox-evidence.md` §6); request/response **bodies** are **Inferred** (not POSTed — a create is irreversible) and confirmed on first live test.
> **Last updated**: 2026-09-28.

> **Boundary (ADR 0015).** These are **thin passthrough** tools: validate input shape, call Erbon, return verbatim. No dedup, no idempotency ledger, no availability decision, no retry. **One tool call = at most one external mutation.** All write-safety — availability guard, `voucher` idempotency, **human-gated** propose→confirm — is the backend's. Erbon has **no cancel/modify and no compensating action**, so a created booking cannot be undone via API.

---

## A. Erbon write/read endpoints used

| Op | Method + Path | Input | Body/response | Evidence |
|:--|:--|:--|:--|:--|
| Create booking | `POST /hotel/{hotelID}/booking/new` | JSON body (A.1) | returns created booking (id/localizer) | params Observed (swagger AE79); body Inferred |
| Search guest | `GET /hotel/{hotelID}/guest/search` | headers: `guestID` **or** `documenttype`+`documentnumber` | guest(s) | params Observed (AE21); response Inferred |
| Create/update guest | `POST /hotel/{hotelID}/guest/new` | JSON body (A.2) | returns guest id | params Observed (AE23); body Inferred |

### A.1 `booking/new` body (Giovanni's principal fields + swagger)
```jsonc
{
  "idBookingStatus": "RESERVA",
  "checkInDate": "2026-09-29", "checkOutDate": "2026-09-30",
  "idRoomTypeReserved": 2, "idRoomTypeOccupied": 2,
  "numberAdults": 2, "numberChildren": 0, "numberChildren2": 0, "numberBabies": 0,
  "idConfigPension": "BB",              // RO|BB|HB|FB|AI
  "idRate": 10,
  "ratePrices": [ { "date": "2026-09-29", "price": 270.00 } ],  // price to charge per night
  "isDirect": false, "isCompany": true, "idCompany": 3, "idAgency": 4,
  "idSource": 3, "idSegment": 2, "voucher": "api123", "isRateDefault": true,
  "commentsBooking": "Reserva API Empresa X",
  "guests": [ { "idGuest": 29, "isHolder": true } ]
}
```
> Swagger `required: []` (Erbon validates server-side). One room per reservation — no room array.

### A.2 `guest/new` body (props, Observed from swagger)
`id, name, email, phone, birthDate, genderID, nationality, professionID, profession, vehicleRegistration, isClient, isProvider, address, documents`. (`id` present ⇒ update; absent ⇒ insert.)

---

## C. MCP tool contract (all `controlPlane: true` — routable, NOT in `listTools()`)

Declared with `toolFactory<ErbonContext>()`; `hotelID` from context; data verbatim; `unwrapErbon` error mapping (401/403→`AUTH_EXPIRED`, 429→`RATE_LIMITED`, 5xx→`UNAVAILABLE`, 400/422→`INVALID_INPUT`).

### C.1 `mcp_erbon_create_booking`
```ts
input: z.object({
  // required (coherent minimum)
  checkInDate: isoDate, checkOutDate: isoDate,
  idRoomTypeReserved: z.number().int().positive(),
  idRoomTypeOccupied: z.number().int().positive(),
  idRate: z.number().int().positive(),
  idConfigPension: z.enum(['RO','BB','HB','FB','AI']),
  numberAdults: z.number().int().positive(),
  ratePrices: z.array(z.object({ date: isoDate, price: z.number().nonnegative() })).min(1),
  guests: z.array(z.object({ idGuest: z.number().int().positive(), isHolder: z.boolean() })).min(1),
  // optional passthrough (backend fills / omits)
  voucher: z.string().optional(),                       // idempotency — backend's, per ADR 0015
  idBookingStatus: z.string().optional(),
  numberChildren: z.number().int().nonnegative().optional(),
  numberChildren2: z.number().int().nonnegative().optional(),
  numberBabies: z.number().int().nonnegative().optional(),
  isDirect: z.boolean().optional(), isCompany: z.boolean().optional(),
  idCompany: z.number().int().optional(), idAgency: z.number().int().optional(),
  idSource: z.number().int().optional(), idSegment: z.number().int().optional(),
  isRateDefault: z.boolean().optional(), commentsBooking: z.string().optional(),
}).strict()
```
Backs `POST booking/new` with the args as the JSON body (client `post`). Returns Erbon's create response verbatim.

### C.2 `mcp_erbon_search_guest`
```ts
input: z.object({
  guestID: z.number().int().positive().optional(),
  documentType: z.string().optional(),
  documentNumber: z.string().optional(),
}).strict().refine(v => v.guestID != null || (v.documentType && v.documentNumber),
  'Provide guestID, or documentType + documentNumber')
```
Backs `GET guest/search` with the values in headers (`guestID`/`documenttype`/`documentnumber`). Returns verbatim.

### C.3 `mcp_erbon_create_guest`
```ts
input: z.object({
  name: z.string().min(1),
  id: z.number().int().positive().optional(),          // present ⇒ update
  email: z.string().optional(), phone: z.string().optional(),
  birthDate: isoDate.optional(), genderID: z.number().int().optional(),
  nationality: z.string().optional(),
  documents: z.array(z.record(z.unknown())).optional(), // shape confirmed on build
}).passthrough()   // faithful — allow Erbon's other guest fields through
```
Backs `POST guest/new` with the args as the JSON body. Returns the guest id verbatim. Lower-stakes correctable write (editable via `guests/update`).

---

## D. Fixtures / testing
Unit tests via injected `fetchImpl` (as read-only): assert body/headers built correctly, `controlPlane` split (all three in `routableToolNames()`, none in `listTools()`), and error mapping. A **live** `create_booking` test is deferred — it creates an **un-cancellable** sandbox booking; run it only as part of the backend propose→confirm work, or once, deliberately, to capture the response shape (then remove the Inferred marks).

## E. Out of scope (backend phase)
Availability guard, `voucher` idempotency/dedup (search-before-create), human-gated propose→confirm, `StayQuote`-driven `ratePrices` composition. All per ADR 0015 + grill-notes Q4.
