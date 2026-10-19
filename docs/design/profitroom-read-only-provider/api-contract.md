# Profitroom Read-Only Provider — API Contract

> **Module**: `src/providers/profitroom/` (xcale-mcp-server). Connection registration and the `StayQuote` live in xcale-backend (Rail A + booking module, matesjara/xcale-backend#1599), referenced here, not re-specified.
> **Kind**: External-provider adapter contract (NOT an internal `/api/v1` REST module). It documents three surfaces: (A) the **Profitroom booking-engine API** as Observed, (B) the **`authDescriptor` + context** (concrete), (C) the **MCP tool contract** the provider publishes.
> **Upstream**: [feature-design.md](feature-design.md) · ADR [credential-less-provider-auth](../../adr/0022-credential-less-provider-auth.md).
> **Status**: Draft.
> **Language note**: English per this repo's `CLAUDE.md` (design docs are durable).
> **Last updated**: 2026-10-14.

> **🔬 Evidence discipline.** Every wire value in §A is **Observed** live against `hotellapausa` on 2026-10-14 unless marked **Inferred**. There is no sandbox and no documentation: this is the engine's internal API. The raw responses captured that day become the fixtures (§D).

---

## 0. Resolved facts at a glance

| Datum                          | Value                                                                                                                                                  | Source                                                          |
| :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| Base URL                       | `https://booking.profitroom.com/api/{hotelKey}/` (fixed host)                                                                                          | Observed                                                        |
| Auth                           | none; header `X-Requested-With: XMLHttpRequest` on every call                                                                                          | Observed                                                        |
| Hotel identity                 | `hotelKey` parsed from `bookingEngineUrl` (`https://booking.profitroom.com/{locale}/{hotelKey}`)                                                       | Decision AD-1/AD-2                                              |
| Language                       | every response carries all translations; `lang` is not needed and not sent — the provider picks the locale                                             | Observed                                                        |
| Unknown hotel                  | HTTP 404 `{ "message": "auth.site_not_found" }`                                                                                                        | Observed                                                        |
| Missing params                 | HTTP 422 `{ "<field>": ["The … field is required."] }`                                                                                                 | Observed                                                        |
| Rate limit header              | `X-RateLimit-Limit: 1500`, `X-RateLimit-Remaining` (window unknown)                                                                                    | Observed                                                        |
| Prices                         | net of taxes when `config["be.taxesPresentationMode"] = "net"`; no tax amount anywhere before checkout                                                 | Observed                                                        |
| Party that no single room fits | engine **re-splits the party** into a multi-room suggestion: a child outside the child age range becomes an adult and a second occupancy group appears | Observed (2 adults + age 7 → groups `{2 adults}` + `{1 adult}`) |
| Write surface                  | none used (checkout is `https://checkout.profitroom.com`, out of scope)                                                                                | Observed                                                        |

---

## A. Profitroom booking-engine API — Observed wire surface

### A.1 Base + transport

| Property             | Value                                                                                      |
| :------------------- | :----------------------------------------------------------------------------------------- |
| Base URL             | `https://booking.profitroom.com/api/{hotelKey}/` — built from a constant, never from input |
| Method               | `GET` only                                                                                 |
| Required header      | `X-Requested-With: XMLHttpRequest`                                                         |
| Response             | `application/json`                                                                         |
| Cache headers        | `Cache-Control: no-cache, private`, `upstream-cache-valid-time: 30`                        |
| Latency (2026-10-14) | `rooms` 1.36 s / 45 KB · `offers` 0.66 s · `details` 0.65 s · `availability` 0.74 s        |

### A.2 `GET details` — hotel (fields used)

| Field                                                                              | Type                                                                     | Example                         |
| :--------------------------------------------------------------------------------- | :----------------------------------------------------------------------- | :------------------------------ |
| `translations[].locale` / `.messages[{fieldName: 'name' \| 'description', value}]` | array                                                                    | `es` → `name: "Hotel La Pausa"` |
| `defaultCurrency.code`                                                             | string                                                                   | `"COP"`                         |
| `locales[]`                                                                        | `{ locale: string, isLive: boolean }[]`                                  | `es`, `en` (both live)          |
| `defaultLocale`                                                                    | string                                                                   | `"es"`                          |
| `timeZone`                                                                         | string (IANA)                                                            | `"America/Bogota"`              |
| `address`                                                                          | `{ street, city, postalCode, country, coordinates{latitude,longitude} }` | El Peñol, CO                    |
| `config["Hotel.CheckinAfter"]` / `config["Hotel.CheckoutBefore"]`                  | string `HH:mm`                                                           | `"15:00"` / `"12:00"`           |
| `config["be.taxesPresentationMode"]`                                               | `"net"` \| other                                                         | `"net"`                         |
| `config["be.maxRoomsPerReservation"]`                                              | numeric string                                                           | `"5"`                           |
| `personTypes[]`                                                                    | `{ type: 'A' \| 'C', minAge: number \| null, maxAge: number \| null }`   | `C`: 0–2                        |
| `enabledNewChildrenOccupancyPicker`                                                | boolean                                                                  | `false`                         |

### A.3 `GET rooms` — room types (fields used)

| Field                                  | Type                                                        | Example                            |
| :------------------------------------- | :---------------------------------------------------------- | :--------------------------------- |
| `id`                                   | number                                                      | `230226`                           |
| `translations[].messages[]` fieldNames | `name`, `description` (HTML), `bedsDescription`, `sight`    | `name: "Cabaña Doble con Jacuzzi"` |
| `attributes.area`                      | `{ from: number, to: number, unit: string }`                | 65 m²                              |
| `attributes.maxOccupancy.people`       | number                                                      | `3`                                |
| `limits.max.occupancy`                 | `{ adults: number, children: [{ minAge, maxAge, count }] }` | 2 adults + 1 child 0–2             |
| `totalRooms`                           | number                                                      | —                                  |
| `offerIds`                             | number[]                                                    | —                                  |

### A.4 `GET offers?status=1` — rates (fields used)

| Field                                          | Type                                                                           | Example                   |
| :--------------------------------------------- | :----------------------------------------------------------------------------- | :------------------------ |
| `id`                                           | number                                                                         | `380900`                  |
| `translations[].messages[]` fieldNames         | `name`, `description` (HTML), `intro`                                          | `name: "Tarifa Estándar"` |
| `roomIds`                                      | number[]                                                                       | —                         |
| `profiles[].profileId`                         | number                                                                         | `212614`                  |
| `profiles[].type`                              | string                                                                         | `"elastic"`               |
| `profiles[].deposit.percentage`                | number \| null                                                                 | `30`                      |
| `profiles[].params.cancelTime` / `.cancelUnit` | numeric string / string                                                        | `"7"` / `"days"`          |
| `profiles[].params.remainingPaymentType`       | string                                                                         | `"upon_arrival"`          |
| `restrictions`                                 | `{ availableFrom, availableTo, minNights, availableWeekDays[], shutsDates[] }` | —                         |

> `attributes.mealPlanType` (observed `19`) is an undocumented code; it is **not** interpreted. Inclusions reach the guest through the rate's own `name`/`description`.

### A.5 `GET calendar?from={YYYY-MM-DD}&to={YYYY-MM-DD}`

```json
{
  "offerID": 380898,
  "roomID": 0,
  "rooms": [230226, 230228, 230230, 230232, 506622, 513440],
  "from": "2026-10-20",
  "to": "2026-10-26",
  "dates": [
    { "date": "2026-10-20", "availability": true, "minLOS": 1, "maxLOS": null, "CTD": false }
  ]
}
```

Hotel-wide: `availability` means _at least one_ room type is open that night. `CTD` = closed to departure.

### A.6 `GET availability?checkIn&checkOut&occupancy[0][adults]=N[&occupancy[0][children][i]=age]`

```json
[
  {
    "occupancy": { "adults": 2, "children": [{ "minAge": 1, "maxAge": 1, "count": 1 }] },
    "proposals": [
      {
        "proposal": {
          "OfferID": 380900,
          "RoomID": 230226,
          "profileId": 212614,
          "price": { "amount": 1411000, "currency": "COP" },
          "originalPrice": { "amount": 1510000, "currency": "COP" },
          "discounts": [
            { "amount": -99000, "availableTo": "2026-10-30T00:00:00-05:00", "isMobile": false }
          ],
          "stay": { "from": "2026-10-23", "to": "2026-10-25" },
          "occupancy": { "adults": 2, "children": [] }
        },
        "roomCount": 4
      }
    ]
  }
]
```

- `price.amount` is the **whole stay** for the occupancy, in the hotel currency, net of taxes when the mode is `net`.
- The response is **one group per room** the engine suggests; each group's `occupancy` is the engine's **echo** of what it priced. When the requested party does not fit one room as asked, the engine re-splits it (`details.isMultiroomSuggestionsEnabled`): observed for 2 adults + a 7-year-old → two groups, `{adults: 2}` and `{adults: 1}`, each with its own proposals. A child outside `personTypes` C is re-classified as an adult.
- `children[i]` must be an integer age; `children[i][age]` → 422 `"must contain an integer minAge"`.

### A.7 Errors (Observed)

| Case                                     | Status | Body                                                                                                 |
| :--------------------------------------- | :----- | :--------------------------------------------------------------------------------------------------- |
| Unknown `hotelKey`                       | 404    | `{ "message": "auth.site_not_found" }`                                                               |
| Missing `from`/`to` on `calendar`        | 422    | `{ "from": ["The from field is required."], "to": [...] }`                                           |
| Missing `checkIn`/`checkOut`/`occupancy` | 422    | `{ "checkIn": ["The check in field is required when check in months is not present."], ... }`        |
| Bad child format                         | 422    | `{ "occupancy.0.children.0": ["The occupancy.0.children.0 field must contain an integer minAge."] }` |
| 429 / 5xx                                | —      | **Inferred** (not triggered)                                                                         |

### A.8 Booking-engine link (Observed in the browser)

```
https://booking.profitroom.com/{locale}/{hotelKey}/pricelist/rooms/{RoomID}?check-in={YYYY-MM-DD}&check-out={YYYY-MM-DD}&r1_adults={n}{children}&currency={code}
```

| `details.enabledNewChildrenOccupancyPicker` | `{children}`                                                                               | Verified                              |
| :------------------------------------------ | :----------------------------------------------------------------------------------------- | :------------------------------------ |
| `false` (La Pausa)                          | `&r1_child{minAge}-{maxAge}={count}` per child `personTypes` bucket, e.g. `&r1_child0-2=1` | ✅ engine shows "2 adultos • 1 niño"  |
| `true`                                      | `&r1_children_age={a},{b}`                                                                 | **Inferred** (from the engine bundle) |

`/pricelist/rooms/{RoomID}` opens that room with its rates expanded and its "book now" button (verified 2026-10-14 on 2026-11-13 → 15, four room types open). `room-id`/`offer-id` query params are accepted but pre-select nothing, and no parameter pre-selects a rate: the room page lists them all.

---

## B. `authDescriptor` and context (concrete)

```ts
// src/providers/profitroom/auth.ts
export const profitroomAuth = { type: 'none' } as const satisfies ProviderAuthDescriptor;

// src/providers/profitroom/context.ts — published as contextSchema (as built 2026-10-15)
export const profitroomContext = z
  .object({
    /** Public booking-engine address the owner pasted, e.g. https://booking.profitroom.com/es/hotellapausa */
    bookingEngineUrl, // string + URL refine (rules below)
    /** The hotel's identity, discovered by the consumer from get_hotel at connect. */
    hotelKey: z.string().regex(/^[a-z0-9-]{1,64}$/),
  })
  .strict()
  .refine((c) => hotelKeyOf(c.bookingEngineUrl) === c.hotelKey); // they must name the same hotel

// The connect-time context: the URL alone. get_hotel validates it itself (see B.1).
export const bookingEngineUrlContext = z.object({ bookingEngineUrl });
```

### B.1 Connect support (manifest, for a consumer's credential-less connection)

| Manifest field       | Value                                                                           | Why                                                                                                                                                                           |
| :------------------- | :------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectionProbe`    | `{ tool: 'mcp_profitroom_get_hotel' }`                                          | Proves the pasted URL names a real Profitroom hotel before a consumer saves a connection. Without it xcale-backend's `buildCredentialConfig` refuses to register the provider |
| `contextDiscovery`   | `{ key: 'hotelKey', tool: 'mcp_profitroom_get_hotel', resultPath: 'hotelKey' }` | The owner is asked only for the URL; the consumer reads `hotelKey` out of the probe's own response                                                                            |
| `accountContextKeys` | `['hotelKey']`                                                                  | The account is the hotel, not the URL: `/es/hotellapausa` and `/en/hotellapausa/home` are one connection                                                                      |

`get_hotel` is the discovery tool, and the core exempts it from `contextSchema` validation (`src/core/provider-factory.ts:82-87`) because `hotelKey` cannot exist yet. So it parses its own context with `bookingEngineUrlContext`: a foreign URL is still refused with `PROVIDER_INVALID_INPUT` and no upstream call. Observed live 2026-10-15: `get_hotel` with only `https://booking.profitroom.com/en/hotellapausa/home?currency=COP` → `hotelKey: "hotellapausa"`.

`isProfitroomEngineUrl` / `hotelKeyFrom` rules:

| Rule                                                                                             | Reject example                                                          |
| :----------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| Protocol is `https:`                                                                             | `http://booking.profitroom.com/es/x`                                    |
| Host is exactly `booking.profitroom.com` (no port, no userinfo)                                  | `https://evil.com/es/x`, `https://booking.profitroom.com.evil.com/es/x` |
| Path starts `/{locale}/{hotelKey}` with `locale` = `[a-z]{2}` and `hotelKey` = `[a-z0-9-]{1,64}` | `https://booking.profitroom.com/hotellapausa`                           |
| Trailing path and query ignored                                                                  | — (`/es/hotellapausa/home?currency=COP` → `hotellapausa`)               |

The parsed URL is **never** fetched. A failing refine is rejected by the core's context validation (`src/core/provider-factory.ts:87-95`) → `PROVIDER_INVALID_INPUT`, before any upstream call.

---

## C. MCP tool contract

All tools via `tool({...})` with zod `input` as the single source of truth. `hotelKey` comes from context, never from tool input. All five menu tools are `readOnly: true`, `audience: 'customer'`.

### Common inputs

```ts
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/); // YYYY-MM-DD, hotel-local date
const locale = z
  .string()
  .regex(/^[a-z]{2}$/)
  .optional(); // validated against details.locales (isLive); default details.defaultLocale
const room = z
  .object({
    adults: z.number().int().min(1).max(10),
    childrenAges: z.array(z.number().int().min(0).max(17)).max(6).optional(),
  })
  .strict();
const stayInput = z
  .object({
    checkIn: isoDate,
    checkOut: isoDate, // > checkIn
    rooms: z.array(room).min(1).max(1), // v1: exactly one room
    locale,
  })
  .strict();
```

Handler-level validation (before any upstream call): `checkOut > checkIn`; `checkIn` ≥ today in `details.timeZone`; `locale` is a live locale; every child age within the hotel's `personTypes` C range, otherwise `PROVIDER_INVALID_INPUT` with `"children older than {maxAge} count as adults at this hotel"`.

### C.1 Published to the agent (`listTools`) — no money

| Tool                                       | `input`                                                     | Backs                                              | Returns (`data`)               |
| :----------------------------------------- | :---------------------------------------------------------- | :------------------------------------------------- | :----------------------------- |
| `mcp_profitroom_get_hotel`                 | `{ locale? }`                                               | `details`                                          | `Hotel`                        |
| `mcp_profitroom_list_room_types`           | `{ locale? }`                                               | `rooms`                                            | `Room[]`                       |
| `mcp_profitroom_list_rates`                | `{ locale? }`                                               | `offers`                                           | `Offer[]`                      |
| `mcp_profitroom_get_availability_calendar` | `{ from: isoDate, to: isoDate }` (≤ 60 days, `to` ≥ `from`) | `calendar`                                         | `Calendar`                     |
| `mcp_profitroom_check_availability`        | `stayInput`                                                 | `availability` + cached `rooms`/`offers`/`details` | `StayAvailability` (no prices) |

### C.2 Routable but NOT published (`controlPlane: true`) — the money guard

| Tool                             | `input`     | Backs                        | Consumer                                                            |
| :------------------------------- | :---------- | :--------------------------- | :------------------------------------------------------------------ |
| `mcp_profitroom_get_stay_prices` | `stayInput` | same as `check_availability` | xcale-backend `profitroom-stay-truth` adapter → `StayQuote` (#1599) |

> `get_stay_prices` is the only tool that returns money. Keeping it out of `listTools()` means the agent cannot narrate a raw, pre-tax figure; it only ever sees the consumer's `StayQuote`.

### C.3 Output types — projection, original names (ADR 0009 Fidelity over Unification)

Every field keeps Profitroom's **name and meaning**. The provider only **projects** (drops fields the agent does not need) and **flattens one locale** out of `translations[]` (`translations[locale].messages[fieldName] → fieldName`; HTML descriptions stay HTML). Nothing is renamed or re-coded: `profiles[].type` stays `"elastic"`, `CTD` stays `CTD`. Joins **nest** the referenced resource under its own name next to the proposal and never merge fields. The few fields that do not exist upstream are marked **derived**, with their rule.

```ts
// get_hotel — projection of `details`
interface Hotel {
  name: string; // translations[locale].name
  description?: string; // translations[locale].description (HTML, verbatim)
  defaultCurrency: { code: string }; // verbatim
  timeZone: string; // verbatim, IANA
  locales: { locale: string; isLive: boolean }[]; // verbatim, live only
  defaultLocale: string;
  address?: {
    street?: string;
    city?: string;
    postalCode?: string;
    country?: string;
    coordinates?: { latitude: number; longitude: number };
  };
  personTypes: { type: string; minAge: number | null; maxAge: number | null }[]; // verbatim
  config: {
    // verbatim subset of `config`, original keys
    'Hotel.CheckinAfter'?: string;
    'Hotel.CheckoutBefore'?: string;
    'be.taxesPresentationMode'?: string;
    'be.maxRoomsPerReservation'?: string;
  };
  bookingEngineUrl: string; // derived: https://booking.profitroom.com/{locale}/{hotelKey}
  hotelKey: string; // derived: the hotel's identity (read by a consumer as contextDiscovery)
}

// list_room_types — projection of each `rooms[]` item
interface Room {
  id: number;
  name: string; // translations[locale].name
  description?: string; // translations[locale].description (HTML)
  bedsDescription?: string;
  sight?: string;
  attributes: {
    area?: { from: number; to: number; unit: string };
    maxOccupancy?: { people: number; extraBeds: number | null }; // extraBeds null on 2 of 6 La Pausa rooms (Observed)
  };
  limits: { min: Occupancy; max: Occupancy }; // verbatim
  totalRooms: number;
  offerIds: number[];
}
interface Occupancy {
  numberOfPeople: number;
  occupancy: { adults: number; children: { minAge: number; maxAge: number; count: number }[] };
}

// list_rates — projection of each `offers[]` item
interface Offer {
  id: number;
  type: string;
  name: string; // translations[locale].name
  description?: string; // translations[locale].description (HTML) — inclusions live here
  intro?: string;
  roomIds: number[];
  profiles: Profile[]; // verbatim projection
  restrictions: {
    availableFrom: string | null;
    availableTo: string | null;
    minNights: number | null;
    availableWeekDays: number[];
  };
}
interface Profile {
  profileId: number;
  type: string; // e.g. "elastic" — not re-coded
  deposit: { percentage: number | null; nights: number | null } | null;
  params: {
    cancelTime: string | null;
    cancelUnit: string | null;
    remainingPaymentType: string | null;
  };
}

// get_availability_calendar — projection of `calendar`
interface Calendar {
  from: string;
  to: string;
  dates: {
    date: string;
    availability: boolean;
    minLOS: number;
    maxLOS: number | null;
    CTD: boolean;
  }[];
}

// check_availability — no money
interface StayAvailability {
  checkIn: string;
  checkOut: string;
  occupancy: { adults: number; childrenAges: number[] }; // the request, echoed
  available: boolean; // derived: proposals.length > 0
  reason?: 'party_does_not_fit_one_room'; // derived, see C.4
  proposals: StayProposal[];
}
interface StayProposal {
  OfferID: number;
  RoomID: number;
  profileId: number;
  roomCount: number; // engine's value, verbatim — meaning unconfirmed (4 observed for a room with totalRooms 1); never a count of rooms left
  room: { id: number; name: string }; // nested from list_room_types
  offer: { id: number; name: string; description?: string }; // nested from list_rates
  profile: Profile; // nested: the offer's profile with this profileId
}

// get_stay_prices — controlPlane only
interface StayPrices extends Omit<StayAvailability, 'proposals'> {
  currency: string; // details.defaultCurrency.code
  taxesPresentationMode: string; // verbatim config value, e.g. "net"
  taxesIncluded: boolean; // derived: taxesPresentationMode !== 'net'
  proposals: PricedStayProposal[];
}
interface PricedStayProposal extends StayProposal {
  price: { amount: number; currency: string }; // verbatim — whole stay, this occupancy
  originalPrice: { amount: number; currency: string } | null; // verbatim
  discounts: { amount: number; availableTo: string }[]; // verbatim projection
  bookingUrl: string; // derived: §A.8 with the request's dates, occupancy, locale and RoomID
}
```

### C.4 Behavior rules (fail closed)

| Rule                                                                                            | Result                                                                                                                                                                                   |
| :---------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A response fails its zod schema (fields used only)                                              | `PROVIDER_ERROR` "unexpected response from Profitroom ({endpoint}: {zod path} {issue})" — the path, never the body. Providers have no logger seam; the consumer logs `ToolResult` errors |
| A proposal's `RoomID`/`OfferID`/`profileId` not in the cache                                    | refresh `rooms`+`offers` once; still missing → `PROVIDER_ERROR`                                                                                                                          |
| More than one group in the response, or the single group's echoed occupancy ≠ the requested one | success, `available: false`, `proposals: []`, `reason: 'party_does_not_fit_one_room'` — never a price for a different party or a partial split                                           |
| `proposal.price.currency` ≠ `details.defaultCurrency.code`                                      | `PROVIDER_ERROR`                                                                                                                                                                         |
| `price.amount` not a finite number > 0                                                          | `PROVIDER_ERROR`                                                                                                                                                                         |
| `[]` or empty `proposals`                                                                       | success, `available: false`, `proposals: []`                                                                                                                                             |
| Cache                                                                                           | `details`, `rooms`, `offers` per `hotelKey` and request URL, 15 min, in memory; `availability`/`calendar` never                                                                          |

### C.5 Error mapping

| Profitroom                | `ProviderErrorCode`                   | Note                                                                                                                         |
| :------------------------ | :------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------- |
| 404 `auth.site_not_found` | `PROVIDER_INVALID_INPUT`              | the connection points at no hotel                                                                                            |
| 400 / 422                 | `PROVIDER_INVALID_INPUT`              | core default                                                                                                                 |
| 429                       | `PROVIDER_RATE_LIMITED`               | core default; no internal retry                                                                                              |
| 5xx, timeout, network     | `PROVIDER_UNAVAILABLE`                | core default (timeout = core's 15 s; no per-provider override, to keep core untouched)                                       |
| **401 / 403**             | **`PROVIDER_UNAVAILABLE`** (override) | core maps these to `PROVIDER_AUTH_EXPIRED`, but a `none` provider has nothing to reconnect; a 403 here means we were blocked |
| other non-2xx             | `PROVIDER_ERROR`                      | core default                                                                                                                 |

---

## D. Mock data (fixtures + conformance)

Fixtures are the raw 2026-10-14 responses, saved under `src/providers/profitroom/__fixtures__/` (`details.json`, `rooms.json`, `offers.json`, `calendar.json`, `availability.json`, `availability-child.json`, `availability-dropped-child.json`, `site-not-found.json`).

**`check_availability` — available** (2 adults, 2026-10-23 → 2026-10-25, `locale: es`):

```json
{
  "checkIn": "2026-10-23",
  "checkOut": "2026-10-25",
  "occupancy": { "adults": 2, "childrenAges": [] },
  "available": true,
  "proposals": [
    {
      "OfferID": 380900,
      "RoomID": 230226,
      "profileId": 212614,
      "roomCount": 4,
      "room": { "id": 230226, "name": "Cabaña Doble con Jacuzzi" },
      "offer": { "id": 380900, "name": "Tarifa Estándar", "description": "<p>…</p>" },
      "profile": {
        "profileId": 212614,
        "type": "elastic",
        "deposit": { "percentage": 30, "nights": null },
        "params": {
          "cancelTime": "7",
          "cancelUnit": "days",
          "remainingPaymentType": "upon_arrival"
        }
      }
    }
  ]
}
```

**`get_stay_prices` — same search** (controlPlane): the same object, plus these fields at the top and on each proposal:

```json
{
  "currency": "COP",
  "taxesPresentationMode": "net",
  "taxesIncluded": false,
  "proposals": [
    {
      "price": { "amount": 1411000, "currency": "COP" },
      "originalPrice": { "amount": 1510000, "currency": "COP" },
      "discounts": [{ "amount": -99000, "availableTo": "2026-10-30T00:00:00-05:00" }],
      "bookingUrl": "https://booking.profitroom.com/es/hotellapausa/pricelist/rooms/230226?check-in=2026-10-23&check-out=2026-10-25&r1_adults=2&currency=COP"
    }
  ]
}
```

**No availability:** `{ "available": false, ..., "proposals": [] }` (success).

**Child out of range** (`childrenAges: [7]` at La Pausa): `{ isError: true, code: "PROVIDER_INVALID_INPUT", message: "children older than 2 count as adults at this hotel" }`.

**Wrong URL in context** (`https://evil.com/es/x`): `{ isError: true, code: "PROVIDER_INVALID_INPUT", message: "bookingEngineUrl is not a Profitroom booking engine address" }`, no upstream call.

**Drift** (`price` renamed upstream): `{ isError: true, code: "PROVIDER_ERROR", message: "unexpected response from Profitroom" }`.

---

## E. Drift probe

`scripts/profitroom-drift.ts`, run by `.github/workflows/profitroom-drift.yml` (daily cron + `workflow_dispatch`): calls `details`, `rooms`, `offers`, `calendar` (+30 days, 14-day window) and `availability` (+30 days, 2 nights, 2 adults) on `hotellapausa`, and parses each with the **same exported zod schemas** the provider uses. Any failure exits non-zero and opens or comments on an issue labeled `profitroom-drift`. An empty availability is a pass.

---

## F. Roadmap

| Phase             | Scope                                                                                  | Trigger                                |
| :---------------- | :------------------------------------------------------------------------------------- | :------------------------------------- |
| 0                 | `none` auth variant (core)                                                             | ADR accepted                           |
| **This contract** | 5 menu reads + `controlPlane` `get_stay_prices`; parsing; errors; drift probe          | after phase 0                          |
| Fast-follow       | `rooms` max > 1 (additive)                                                             | demand                                 |
| Consumer          | `profitroom-stay-truth` → `StayQuote` (with unknown-tax handling), secret-less connect | matesjara/xcale-backend#1599           |
| Partner API       | real bookings, CRM sync                                                                | matesjara/xcale-backend#1600 (blocked) |
