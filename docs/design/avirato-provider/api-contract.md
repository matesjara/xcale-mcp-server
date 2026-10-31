# Avirato Provider — API Contract

> **Module**: `src/providers/avirato/` (xcale-mcp-server). The connection's registration and the mint live in xcale-backend (Rail A); they are referenced here, not specified.
> **Kind**: external-provider adapter contract. It documents three surfaces: (A) **Avirato's API v3, as observed**, (B) the **`credential_exchange` authDescriptor**, (C) the **MCP tools** the provider publishes.
> **Upstream**: [feature-design.md](feature-design.md) · ADR [credential-exchange-response-path-and-token-ttl](../../adr/credential-exchange-response-path-and-token-ttl.md) · the evidence comments on matesjara/xcale-mcp-server#189.
> **Last updated**: 2026-10-30.

> **🔬 Evidence.** Every wire value below was observed against Avirato's real API.
>
> - **Production, 2026-10-30:** read-only calls, plus three test reservations created and cancelled with Sara's go.
> - **Sandbox, 2026-10-31:** all 14 tools through the provider itself, the writes included: create, modify (party, then dates) and cancel, on reservations 238–240.
>
> Nothing here is taken from the spec alone. Where the spec and the wire disagree, the wire is written and the disagreement is named.

---

## 0. Resolved facts at a glance

| Datum              | Value                                                                                                                                                                                                       | Source                               |
| :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------- |
| Base URL           | `https://apiv3.avirato.com/v3` (the sandbox, `https://sandbox.avirato.com/v3`, has a byte-identical spec)                                                                                                   | Observed                             |
| Auth               | `POST /token/login` `{ email, password }` → `201 { status, data: { token, web_codes[] } }`                                                                                                                  | Observed (spec's `expiry` is absent) |
| Token lifetime     | not stated by production (no `expiry`, JWT has no `exp`); the sandbox sometimes sends `expiry`, inconsistently; a token was still accepted after **17 min**; **a second login invalidates the first token** | Observed                             |
| Token placement    | `Authorization: Bearer <token>`                                                                                                                                                                             | Observed                             |
| Context            | `web_code` (a number), query parameter on every call below                                                                                                                                                  | Observed                             |
| Envelope           | every success is `{ status: "success", data }`; every error is `{ statusCode, timestamp, path, errorCode, message, errors? }`                                                                               | Observed                             |
| Rate limit         | 600 requests / 5 min per IP; `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (epoch s)                                                                                                    | Observed (Avirato's email said 750)  |
| Field naming       | snake_case, **except** `/reservation/dates`, which is camelCase                                                                                                                                             | Observed                             |
| Reservation price  | computed by Avirato; the create input `price` is `{ payment_type, is_paid }`, not an amount                                                                                                                 | Observed                             |
| Reconciliation tag | `external_code` on create comes back as `promotional_package`                                                                                                                                               | Observed                             |
| Cancel             | `DELETE` keeps the reservation as `Reserva cancelada`; its draft bill and charges stay                                                                                                                      | Observed                             |
| Modify             | `PATCH /reservation/{reservation_id}` with the room's **full record** (`action: "MODIFY"`, `rateId`, no `quantity`); Avirato reprices; it clears the reconciliation tag                                     | Observed (sandbox)                   |

---

## A. Avirato's API — the observed wire

### A.1 Transport

| Property     | Value                                                        |
| :----------- | :----------------------------------------------------------- |
| Base URL     | `https://apiv3.avirato.com/v3`                               |
| Content-Type | `application/json` on bodies                                 |
| Context      | `?web_code=<number>` on every data call                      |
| TLS          | HTTPS (the `Shop` link Avirato hands out is `http://`, A.10) |

### A.2 Authentication — `POST /token/login`

```json
{ "email": "<API user email>", "password": "<API user password>" }
```

| Outcome        | Status | Body                                                                                           |
| :------------- | :----- | :--------------------------------------------------------------------------------------------- |
| Success        | `201`  | `{ "status": "success", "data": { "token": "<JWT HS256, 172 chars>", "web_codes": ["<n>"] } }` |
| Wrong password | `401`  | `{ "statusCode": 401, "errorCode": "UNAUTHORIZED", "message": "Unauthorized" }`                |
| Unknown user   | `404`  | `{ "statusCode": 404, "errorCode": "USER_NOT_FOUND", "message": "User not found" }`            |

- The JWT's claims are `securityCode` and `iat` only. There is no `exp`, and no `expiry` in the body.
- A second successful login makes the previous token answer `401` (A.3). Concurrent mints break each other.
- A user who is not an **API user** in the hotel's back-office answers `404 USER_NOT_FOUND`, even if it can sign in to the web panel.

### A.3 Errors on data calls

| Status | `errorCode`                        | Observed on                                                                            |
| :----- | :--------------------------------- | :------------------------------------------------------------------------------------- |
| `401`  | `Unauthorized` (`"Invalid token"`) | any data call with a bad or superseded token                                           |
| `400`  | `INPUT_DATA_VALIDATION_FAILED`     | a missing or ill-typed parameter; `errors[]` lists each, in English                    |
| `400`  | `ERROR_RETRIEVING_RESERVATIONS`    | a reservation id that is cancelled or does not exist; an unknown client document       |
| `400`  | `ERROR_RETRIEVING_DATA`            | a modify of a cancelled reservation ("not found or cancelled")                         |
| `400`  | `ERROR_ON_INSERT`                  | a create Avirato cannot insert; on the sandbox, a client without `state` and `country` |
| `400`  | `ERROR_VALIDATING_DATA`            | create/modify payload Avirato rejects (`message` says why)                             |
| `400`  | `ERROR_ON_UPDATE`                  | a modify with a partial record (status alone, status and client)                       |
| `429`  | —                                  | not provoked; the rate-limit headers are present on every response                     |

### A.4 `GET /establishment`

`200 { data: Establishment }`, where `Establishment` has: `name, owner, cif, address, city, zip_code, state, country, currency, phone, mobile_phone, email, website, default_vat` (string), `default_vat_for_extras` (number), `type`, `booking_online { google_maps_address, legal_texts, info_texts, refundable_texts, no_refundable_texts }`. Each `*_texts` is keyed by language (`{ "es": "…" }`).

### A.5 `GET /space`

`200 { data: SpaceType[] }`:

- `SpaceType`: `{ space_type_id, hotel_id, name, space_subtypes: SpaceSubtype[] }`.
- `SpaceSubtype`: `{ space_subtype_id, space_type_id, space_subtype_name, maximum_capacity, maximum_adults, standard_capacity, check_in_time, check_out_time, featured_text, accommodation_type, address, …, spaces: Space[] }`.
- `Space`: `{ space_id, space_name, space_order, … }`.
- Reserva Donato: 1 type, 3 subtypes, one space each.

### A.6 `GET /rate`, `GET /regime`, `GET /extra`, `GET /promotional_codes`

- **`/rate`** → `{ rate_id, rate_name, minimum_stay, maximum_stay, refundable, linked, linked_percentage, master, space_type_id, mode, release_rate }[]`. Channel rates appear here too (Reserva Donato: `Tarifa predeterminada`, `Booking`, `Motor`, `AIRBNB`).
- **`/regime`** → `{ regime_id, name, active }[]`. The name is the regime code a reservation carries (`"BB"`).
- **`/extra`** → `{ extra_id, cost, vat, category, stock, selectable_qty, space_subtype_ids[], rate_ids[], names{lang}, descriptions{lang} }[]`. Languages: `es en fr de it ru pt ca`.
- **`/promotional_codes`** → `[]` for Reserva Donato.
- **`/promotional_codes/{code}`**: an unknown code answers `200 { "status": "success", "data": "" }`. A known code's shape is not observed: the hotel has none.

### A.7 `GET /availability`

Query: `web_code`, `start_date`, `end_date` (`YYYY-MM-DD`, both nights inclusive), optional `space_subtype_id`.

`200 { data: { space_subtypes: [{ space_subtype_id, days: [{ day: "YYYY-MM-DD", available_rooms: number, is_available: boolean }] }] } }`

### A.8 `POST /price/price_for_reservation` — the quote

```json
{
  "start_date": "2027-02-16",
  "end_date": "2027-02-17",
  "rooms": [{ "adults": 2, "children": 0, "space_subtype_id": 2 }],
  "rate_ids": [2]
}
```

- `rate_ids` is optional and **must be numbers**. Strings answer `400 "each value in rateIds must be a number…"`, although the spec types them as strings.
- The call answers `201` and creates nothing. `data` holds one row per rate: `{ check_in_date, check_out_date, space_subtype_id, rate_id, adults, children, price, base, increase: { pax_increase, bed_increase }, regimes: { cost, quantity }, fee: {} }`. **`price` is the total for the stay**, in the establishment's `currency`.
- **Rows may come duplicated.** Two identical rows per rate were observed without `rate_ids`, and one with.

### A.9 Reservations

**Create — `POST /reservation`** → `201 { data: Reservation[] }`

```json
{
  "external_code": "<consumer tag>",
  "rooms": [
    {
      "space_subtype_id": 2,
      "quantity": 1,
      "adults": 2,
      "children": 0,
      "check_in": "2027-02-16T17:00:00.000Z",
      "check_out": "2027-02-17T17:00:00.000Z",
      "regime": "BB",
      "rate_id": 2,
      "status": "RESERVATION",
      "client": { "client_doc": "…", "name": "…", "surname": "…", "email": "…" },
      "price": { "payment_type": "CASH", "is_paid": false },
      "operator_reservation_id": "0",
      "advance": { "total_advance": 0, "advance_type": "CASH" },
      "observations": "…",
      "additional_beds": 0,
      "extras": [],
      "predefinedCharges": []
    }
  ]
}
```

- **Avirato sets the reservation's `price`.** It equalled the quote for the same stay and `rate_id`.
- The response row carries:
  - `reservation_id`, `master_reservation_id` (`""` for a single room), `status: "Reserva"`, `price`, `base`, `client_id`, `client_name`, `check_in_date`/`check_out_date` (`"YYYY-MM-DD HH:mm:ss"`), `is_paid`, `advance`, `advance_type`;
  - `promotional_package`, which holds the `external_code`;
  - `charges[]` (`{ type: "habitacion"|"regimen", concept, price, vat, total, status: "Pendiente" }`) and `billing[]` (`{ bill_id, bill_number: "0", type: "Factura", status: "Pendiente", base, vat, total }`).
- Send the **full** `client`. With `client_doc` alone, an existing client was written as `client_name: "undefined undefined"`. **Send `state` and `country` (ISO3, `COL`) too:** the sandbox refuses a reservation without them with a bare `400 ERROR_ON_INSERT` ("Unable to insert the reservation"), observed 2026-10-31, while production accepted one without them on 2026-10-30. With them, the sandbox created reservation 237 at the quoted price.

**Read by id — `GET /reservation/{reservation_id}`** → `200 { data: [ReservationRow] }`, snake_case.

- `ReservationRow` = `{ reservation_id, rate_id, promotional_code, promotional_package, space_id, space_type_id, space_subtype_id, price, client_id, client_name, check_in_date, check_out_date, regime, adults, children, additional_beds, status, advance, advance_type, operator_id, operator_reservation_id, is_paid, observations, master_reservation_id, created_at, updated_at, client: { client_doc, name, surname, address, city, state, zip_code, country, email, phone, stays, observations, business, vip, birth_date }, guests: [], room_code }`.
- A cancelled or unknown id answers `400 ERROR_RETRIEVING_RESERVATIONS`.

**Read by client document — `GET /reservation/client/{client_doc}`** → `200 { data: ReservationRow[] }`, snake_case, without `created_at`, `updated_at` and `room_code`.

- With three reservations under one document, **one** row came back (the earliest, cancelled).
- An unknown document answers `400 ERROR_RETRIEVING_RESERVATIONS`.

**Cancel — `DELETE /reservation/{reservation_id}`** (optional `delete_group`) → `200 { data: ReservationRow }` with `status: "Reserva cancelada"`. The reservation stays listed by date and is no longer readable by id. Its `charges` and its draft bill stay.

**Modify — `PATCH /reservation/{reservation_id}`** → `200 { data: ReservationRow[] }`, the updated reservation (observed on the sandbox, 2026-10-31).

```json
{
  "rooms": [
    {
      "action": "MODIFY",
      "reservation_id": 239,
      "space_subtype_id": 2,
      "adults": 1,
      "children": 0,
      "check_in": "2027-02-15T17:00:00.000Z",
      "check_out": "2027-02-16T17:00:00.000Z",
      "regime": "BB",
      "rateId": 2,
      "status": "RESERVATION",
      "client": {
        "client_doc": "…",
        "name": "…",
        "surname": "…",
        "email": "…",
        "state": "…",
        "country": "COL"
      },
      "price": { "payment_type": "CASH", "is_paid": false },
      "advance": { "total_advance": 0, "advance_type": "CASH" },
      "operator_reservation_id": "0",
      "observations": "…",
      "additional_beds": 0,
      "extras": []
    }
  ]
}
```

- **The full record, every time.** A partial room (status alone, or status and client) answers `400 ERROR_ON_UPDATE "Unable to modify the reservation"`. `status` is required (`Wrong status type` without it). `quantity` is refused (`Cannot set quantity when modifying.`).
- **The rate is `rateId`** (camelCase), where create takes `rate_id`.
- **The path takes the `reservation_id`.** A single-room reservation has no master (`master_reservation_id` is `""` on create and `0` after a modify).
- **Avirato reprices.** Going from one night to two moved `price` from 395000 to 790000, exactly the two-night quote. Fewer adults on the same night kept 395000.
- **The reconciliation tag is cleared.** After any modify, `promotional_package` reads `""`. A top-level `external_code` is refused on modify (`400 property externalCode should not exist`), although the spec lists it. `observations` are kept, since they are part of the record.
- **A cancelled reservation cannot be modified:** `400 ERROR_RETRIEVING_DATA`.

**Statuses** seen on the wire: `Reserva`, `Reserva confirmada`, `Reserva cancelada`, `Eliminada`. The create input takes `RESERVATION`.

### A.10 `GET /reservation/urls/{reservation_id}`

Query: `web_code`, `type` = `AutoCheck` | `Guest` | `Shop`. → `200 { data: { url } }`. A cancelled reservation answers `400 ERROR_RETRIEVING_RESERVATIONS`.

| `type`      | URL                                                                                                               |
| :---------- | :---------------------------------------------------------------------------------------------------------------- |
| `AutoCheck` | `https://booking.avirato.com/check-in/<code>` → redirects to `https://guest.avirato.com/check-in/<code>`          |
| `Guest`     | `https://guest.avirato.com/…` (a JS application)                                                                  |
| `Shop`      | `http://shop.avirato.com/index.php…` → redirects to `https://shop.avirato.com/productos`, the hotel's online shop |

Which link pays _this reservation_ is P-1. The contract returns each URL verbatim and names none of them "the payment link".

---

## B. The authDescriptor

```ts
export const aviratoAuth: ProviderAuthDescriptor = {
  type: 'credential_exchange',
  credentialDelivery: 'reference',
  tokenEndpoint: 'https://apiv3.avirato.com/v3/token/login',
  method: 'POST',
  bodyFields: { email: 'email', password: 'password' },
  responseFields: { token: 'data.token' },
  tokenTtlSeconds: 900,
  tokenPlacement: 'bearer_header',
};
```

- The connect form collects `email` and `password`. These are field **names**, published by design (ADR 0020).
- The consumer mints single-flight per connection (ADR credential-exchange-response-path-and-token-ttl).
- The login's `web_codes` are what the connect step offers as the connection's `web_code`. Reading them is the consumer's, from its own mint.

**Context schema** (`X-Provider-Metadata`):

```ts
const aviratoContext = z.object({ web_code: z.coerce.number().int().positive() });
```

---

## C. MCP tools

All names are `mcp_avirato_<verb>`. Every handler sends `web_code` from the context.

- Results are Avirato's `data`, **verbatim** (Fidelity over Unification). The only change: on a list, the provider adds nothing, and on the quote, it removes exact duplicate rows.
- Errors map per §D.
- **Menu** tools are published in `tools/list`. **Control-plane** tools are routable but not listed (ADR 0013).

| Tool                         | Wire                                | Surface       | `readOnly` | Identity policy                                                                                                                       |
| :--------------------------- | :---------------------------------- | :------------ | :--------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `get_establishment`          | `GET /establishment`                | menu          | ✓          | none                                                                                                                                  |
| `list_room_types`            | `GET /space`                        | menu          | ✓          | none                                                                                                                                  |
| `list_rates`                 | `GET /rate`                         | menu          | ✓          | none                                                                                                                                  |
| `list_regimes`               | `GET /regime`                       | menu          | ✓          | none                                                                                                                                  |
| `list_extras`                | `GET /extra`                        | menu          | ✓          | none                                                                                                                                  |
| `check_availability`         | `GET /availability`                 | menu          | ✓          | none                                                                                                                                  |
| `validate_promotional_code`  | `GET /promotional_codes/{code}`     | menu          | ✓          | none                                                                                                                                  |
| `get_reservation`            | `GET /reservation/{id}`             | menu          | ✓          | `subject-bound`, `identityFields: []`, `recordOwnershipField: 'reservation_id'`, `recordOwnershipKind: 'avirato:reservation'`         |
| `find_reservations_by_guest` | `GET /reservation/client/{doc}`     | menu          | ✓          | `subject-bound`, `identityFields: ['client_doc']`, `ownedResultField: 'reservation_id'`, `recordOwnershipKind: 'avirato:reservation'` |
| `get_reservation_links`      | `GET /reservation/urls/{id}`        | menu          | ✓          | `subject-bound`, `identityFields: []`, `recordOwnershipField: 'reservation_id'`, `recordOwnershipKind: 'avirato:reservation'`         |
| `quote_stay`                 | `POST /price/price_for_reservation` | control plane | ✓          | none                                                                                                                                  |
| `create_reservation`         | `POST /reservation`                 | control plane |            | none — it reads and changes no existing record; what it creates is owned by its creator (the HiMed `create_appointment` precedent)    |
| `modify_reservation`         | `PATCH /reservation/{id}`           | control plane |            | `subject-bound`, `identityFields: []`, `recordOwnershipField: 'reservation_id'`, `recordOwnershipKind: 'avirato:reservation'`         |
| `cancel_reservation`         | `DELETE /reservation/{id}`          | control plane |            | `subject-bound`, `identityFields: []`, `recordOwnershipField: 'reservation_id'`, `recordOwnershipKind: 'avirato:reservation'`         |

### C.1 Inputs

```ts
// Dates: ISO 8601 calendar dates, "YYYY-MM-DD". Ids: positive integers.
get_establishment:          {}
list_room_types:            {}
list_rates:                 {}
list_regimes:               {}
list_extras:                {}
check_availability:         { start_date: string; end_date: string; space_subtype_id?: number }   // end_date >= start_date
validate_promotional_code:  { code: string }                                                       // 1..64 chars
get_reservation:            { reservation_id: number }
find_reservations_by_guest: { client_doc: string }                                                 // 1..64 chars
get_reservation_links:      { reservation_id: number; type: 'AutoCheck' | 'Guest' | 'Shop' }
quote_stay: {
  start_date: string; end_date: string;                                                            // end_date > start_date
  rooms: Array<{ space_subtype_id: number; adults: number; children: number }>;                    // 1..10 rooms; adults >= 1; children >= 0
  rate_ids?: number[];                                                                             // sent as numbers
}
create_reservation: {
  external_code?: string;                                                                          // the consumer's tag; ≤ 64 chars
  promotional_code?: string;
  rooms: Array<{                                                                                    // 1..10
    space_subtype_id: number; quantity: number; adults: number; children: number;                  // quantity >= 1
    check_in: string; check_out: string;                                                           // ISO 8601 datetimes
    regime: string;                                                                                // a /regime name, e.g. "BB"
    rate_id: number;
    status: 'RESERVATION';                                                                         // the one value observed
    client: { client_doc: string; name: string; surname: string; email?: string; phone?: string;
              state?: string; country?: string; city?: string; address?: string; zip_code?: string }; // country: ISO 3166-1 alpha-3 ("COL")
    payment: { payment_type: 'CASH' | 'CARD' | 'TRANSFER' | 'CREDIT' | 'OTHER'; is_paid: boolean }; // sent as Avirato's `price`
    observations?: string; additional_beds?: number;                                               // default 0
  }>;
}
modify_reservation: {
  reservation_id: number;
  room: {                                                                                           // the FULL record, as it should stand
    space_subtype_id: number; adults: number; children: number;                                    // no quantity
    check_in: string; check_out: string; regime: string; rate_id: number;                          // rate_id is sent as Avirato's `rateId`
    status: 'RESERVATION';
    client: { client_doc: string; name: string; surname: string; email?: string; phone?: string;
              state?: string; country?: string; city?: string; address?: string; zip_code?: string };
    payment: { payment_type: 'CASH' | 'CARD' | 'TRANSFER' | 'CREDIT' | 'OTHER'; is_paid: boolean };
    observations?: string; additional_beds?: number;
  };
}
cancel_reservation:         { reservation_id: number }
```

- **`create_reservation` takes no amount.** Its `payment` input is sent as Avirato's `price` field, renamed so that no reader mistakes it for an amount.
- The provider fills the fields Avirato requires that the consumer has no say in: `operator_reservation_id: "0"`, `advance: { total_advance: 0, advance_type: payment.payment_type }`, `extras: []` and `predefinedCharges: []`.
- `status` accepts only the value observed. A tenant's choice of status widens it by an additive revision once a second value is observed (AD-6).

### C.2 Results

| Tool                                          | `data` returned                                                                                         |
| :-------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| `get_establishment`                           | `Establishment` (A.4)                                                                                   |
| `list_room_types`                             | `SpaceType[]` (A.5)                                                                                     |
| `list_rates` / `list_regimes` / `list_extras` | the arrays of A.6                                                                                       |
| `check_availability`                          | `{ space_subtypes: [...] }` (A.7)                                                                       |
| `validate_promotional_code`                   | `{ valid: false }` when Avirato answers `data: ""`; otherwise `{ valid: true, code: <Avirato's data> }` |
| `get_reservation`                             | `ReservationRow` (A.9), the first element of Avirato's array                                            |
| `find_reservations_by_guest`                  | `{ items: ReservationRow[] }`. An unknown document answers `{ items: [] }`, not an error (§D).          |
| `get_reservation_links`                       | `{ type, url }`                                                                                         |
| `quote_stay`                                  | `{ items: QuoteRow[] }`, exact duplicates removed, Avirato's order kept                                 |
| `create_reservation`                          | `Reservation[]` (A.9), verbatim, `charges` and `billing` included                                       |
| `modify_reservation`                          | `ReservationRow[]` (A.9), the updated reservation, verbatim: Avirato's new `price`, the tag cleared     |
| `cancel_reservation`                          | `ReservationRow` with `status: "Reserva cancelada"`                                                     |

---

## D. Error mapping

| Avirato                                                                          | `ToolResult`                                                                                                                                                                                            |
| :------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `401` on a data call                                                             | `PROVIDER_AUTH_EXPIRED` (the token was superseded or rejected; a fresh mint fixes it)                                                                                                                   |
| `403`                                                                            | `PROVIDER_ERROR` (a permission the API user lacks; a reconnect does not fix it)                                                                                                                         |
| `429`                                                                            | `PROVIDER_RATE_LIMITED` (the core's transport does not hand a provider the response headers, so `X-RateLimit-Reset` is not read in v1)                                                                  |
| `400 INPUT_DATA_VALIDATION_FAILED`                                               | `PROVIDER_INVALID_INPUT`, with Avirato's `errors[]` sentences that are plain words about a parameter (a sentence with quotes, braces, colons, slashes or a credential word is dropped, never forwarded) |
| `400 ERROR_VALIDATING_DATA`                                                      | `PROVIDER_INVALID_INPUT`, with Avirato's `message` under the same rule                                                                                                                                  |
| `400 ERROR_RETRIEVING_RESERVATIONS` on `find_reservations_by_guest`              | success, `{ items: [] }`                                                                                                                                                                                |
| `400 ERROR_RETRIEVING_RESERVATIONS` or `ERROR_RETRIEVING_DATA` on any other tool | `PROVIDER_ERROR`, message `"reservation not found or cancelled"`                                                                                                                                        |
| `5xx`, network failure, timeout                                                  | `PROVIDER_UNAVAILABLE`                                                                                                                                                                                  |

No error message echoes a request URL, header or body (Credential-in-Transit-Only). The login's own `401`/`404` never reach this server: Rail A mints.

---

## E. Mock data (fixtures)

Fixtures live in `src/providers/avirato/__fixtures__/`. They are built from the observed shapes with **invented values**: no guest, client or hotel data from production.

**`check_availability` — success**

```json
{
  "status": "success",
  "data": {
    "space_subtypes": [
      {
        "space_subtype_id": 2,
        "days": [{ "day": "2027-02-16", "available_rooms": 1, "is_available": true }]
      },
      {
        "space_subtype_id": 5,
        "days": [{ "day": "2027-02-16", "available_rooms": 0, "is_available": false }]
      }
    ]
  }
}
```

**`quote_stay` — success with a duplicate row (the tool returns one)**

```json
{
  "status": "success",
  "data": [
    {
      "check_in_date": "2027-02-16",
      "check_out_date": "2027-02-17",
      "space_subtype_id": 2,
      "rate_id": 2,
      "adults": 2,
      "children": 0,
      "price": 395000,
      "base": 395000,
      "increase": { "pax_increase": 0, "bed_increase": 0 },
      "regimes": { "cost": 0, "quantity": 2 },
      "fee": {}
    },
    {
      "check_in_date": "2027-02-16",
      "check_out_date": "2027-02-17",
      "space_subtype_id": 2,
      "rate_id": 2,
      "adults": 2,
      "children": 0,
      "price": 395000,
      "base": 395000,
      "increase": { "pax_increase": 0, "bed_increase": 0 },
      "regimes": { "cost": 0, "quantity": 2 },
      "fee": {}
    }
  ]
}
```

**`create_reservation` — success (trimmed)**

```json
{
  "status": "success",
  "data": [
    {
      "reservation_id": 901,
      "rate_id": 2,
      "space_subtype_id": 2,
      "price": 395000,
      "client_id": "TEST-0001",
      "client_name": "Ana Prueba",
      "check_in_date": "2027-02-16 17:00:00",
      "check_out_date": "2027-02-17 17:00:00",
      "regime": "BB",
      "adults": 2,
      "children": 0,
      "status": "Reserva",
      "is_paid": false,
      "master_reservation_id": "",
      "promotional_package": "xcale-test-0001",
      "charges": [
        {
          "type": "habitacion",
          "price": 359090.91,
          "vat": 10,
          "total": 395000,
          "status": "Pendiente"
        }
      ],
      "billing": [
        {
          "bill_id": 9001,
          "bill_number": "0",
          "type": "Factura",
          "status": "Pendiente",
          "total": 395000
        }
      ]
    }
  ]
}
```

**`get_reservation` — cancelled or unknown → `PROVIDER_ERROR`**

```json
{
  "statusCode": 400,
  "timestamp": "2026-10-30T20:12:46.402Z",
  "path": "/v3/reservation/901?web_code=1",
  "errorCode": "ERROR_RETRIEVING_RESERVATIONS",
  "message": "Unable to retrieve reservations"
}
```

**`quote_stay` — invalid input → `PROVIDER_INVALID_INPUT`**

```json
{
  "statusCode": 400,
  "errorCode": "INPUT_DATA_VALIDATION_FAILED",
  "message": "Input data validation failed",
  "errors": ["each value in rateIds must be a number conforming to the specified constraints"]
}
```

**Any data call — superseded token → `PROVIDER_AUTH_EXPIRED`**

```json
{ "statusCode": 401, "errorCode": "Unauthorized", "message": "Invalid token" }
```

---

## F. Roadmap — what joins this contract, additively

| Item                              | Joins when                                                                             |
| :-------------------------------- | :------------------------------------------------------------------------------------- |
| A second `status` value on create | a tenant needs one and it is observed (AD-6)                                           |
| Which link pays                   | P-1, observed in the Guest application. The tool already returns all three.            |
| A longer token lifetime           | measured in the sandbox. It changes `tokenTtlSeconds`, not a tool.                     |
| A known promotional code's shape  | a hotel with codes. Today `validate_promotional_code` passes Avirato's `data` through. |
