# SiteMinder provider — design notes

Status: built 2026-09-24 against SiteMinder's published contract, with the auth path observed live. **No
hotel key has been used yet** — see §6. Consumer epic: [xcale-backend#1041](https://github.com/matesjara/xcale-backend/issues/1041)
(*SiteMinder / Little Hotelier integration — the incoming customer's PMS*).

## 1. Which SiteMinder API, and why

SiteMinder publishes five APIs ([catalogue](https://developer.siteminder.com/get-started/siteminder-apis.md)).
The customer runs **Little Hotelier**, and that settles the choice:

| API | What it gives a hotel's own agent | What it takes | Verdict |
|---|---|---|---|
| **Direct Booking** | Property facts, room types, rates, **live quotes** (price and availability) | A key the **property itself** generates — no partnership | **v1** |
| Channels Plus | The only API that **books** (lock → confirm with card or VCC → modify/cancel) | A partnership and certification (~60 days), the hotel opting in to an OTA product at 15–17% commission, and card custody (PCI DSS) on us; Little Hotelier eligibility undocumented | Not v1 |
| SMX | Reservation events pushed to us over SOAP | A partnership; **no ARI for Little Hotelier** | Not v1 — later, only to learn that a guest booked |
| pmsXchange, SiteConnect | For a PMS or an OTA with direct contracts | — | Not a fit |

So v1 **quotes live and hands the guest a pre-filled link to the hotel's own booking engine**, where the
guest picks the rate and pays under the hotel's rules and gateway. No card data touches us, and the price
and deposit stay the hotel's. What v1 cannot do is book inside the chat or know afterwards that a booking
happened — the consumer must never say one did.

## 2. Evidence

**D** = documented by SiteMinder (cited); **E** = observed on the live API. The Direct Booking YAML
(v0.0.1) is stale against the OpenAPI embedded in the reference pages; where they disagree the reference
pages are treated as the newer contract.

| # | Fact | Source |
|---|---|---|
| D1 | Read-only: "does not create, retrieve, modify, or cancel reservations" | [integration requirements](https://developer.siteminder.com/direct-booking-api/guides/integration-requirements.md) |
| D2 | The property's Admin generates the key; "properties on Little Hotelier can generate keys from the API integration tab"; the Property ID is shown on the same screen | [generate API key](https://developer.siteminder.com/direct-booking-api/additional-resources/generate-api-key.md) |
| D3 | Header `x-sm-api-key`, never in the query; keys do not expire; revoked by hand | integration requirements · [quick start](https://developer.siteminder.com/direct-booking-api/guides/quick-start.md) |
| D4 | `GET /properties/{uuid}/quotes`: `checkIn`, `checkOut` (≤ 31 nights), `adults`, `children`, `infants`, `withBreakdown`, `promocode` — the YAML says `promoCode` | [quotes reference](https://developer.siteminder.com/direct-booking-api/reference/quotes.md) |
| D5 | `/quotes` returns an **array**, one element per bookable rate: `roomTypeUuid`, `roomRateUuid`, `availability`, `price {gross, net, tax, serviceCharge}`, `breakdown[]` | quotes reference |
| D6 | Lists page with `page`/`perPage` (1–50); the list field is `results` in the reference pages, `items` in the quick start | [room types](https://developer.siteminder.com/direct-booking-api/reference/room-types.md) · quick start |
| D7 | `Property.bookingEngineUrl` (uri, nullable), `currencyIsoCode`, `timezone`, policies, photos | [property](https://developer.siteminder.com/direct-booking-api/reference/property.md) |
| D8 | Three published error bodies: `errors[].name`, `errors[].code`, and a flat `{error, message}` | reference pages · quick start · YAML |
| D9 | 100 calls per minute per key; handle 429 with backoff; do not cache long | integration requirements |
| D10 | No sandbox, no Postman workspace, no webhooks for this API | by absence ([llms.txt](https://developer.siteminder.com/llms.txt)) |
| D11 | Booking-engine parameters: `check_in_date`, `check_out_date`, `number_adults`, `number_children`, `number_infants`, `num_rooms`, `promotion_code`, `locale`, `currency`; the help centre also shows `promocode`, `ratePlanId`, `room_type` (numeric engine ids) | [Little Hotelier integration guide](https://downloads.littlehotelier.com/en/little-hotelier-website-integration-guide_sync.pdf) §3 · [help centre](https://helpcentre.littlehotelier.com/en/articles/9451551-create-unique-links-for-your-booking-engine) |
| E1 | Invalid key → `401 {"errors":[{"code":"Unauthorized","message":"Invalid API key"}]}` | live, 2026-09-24, fake key and property |
| E2 | No key → `401 {"errors":[{"code":"Unauthorized","message":"Missing API key"}]}` | live, 2026-09-24 |
| E3 | The key is checked before the path or query: a bad key on a 40-night `/quotes` and on the group-only `/properties` is the same 401 | live, 2026-09-24 |
| E4 | A 401 carries no `X-SM-TRACE-TOKEN` and no rate-limit headers | live, 2026-09-24 |

## 3. Tools

All reads. The context is `propertyUuid` (pasted by the owner: a property key cannot list properties, D2),
and it is also the account identity.

| Tool | Endpoint | Notes |
|---|---|---|
| `mcp_siteminder_get_property` | `GET /properties/{uuid}` | The `connectionProbe`. Currency, timezone, policies, directions, `bookingEngineUrl` |
| `mcp_siteminder_list_room_types` | `GET …/room-types` | `definePaginatedList`; a `pageSize` above 50 is refused before a call (D6) |
| `mcp_siteminder_list_room_rates` | `GET …/room-rates` | Names, free-text cancellation policy, `promotionOnly` |
| `mcp_siteminder_get_room_type_photos` | `GET …/room-types/{id}/photos` | |
| `mcp_siteminder_get_room_type_amenities` | `GET …/room-types/{id}/amenities` | |
| `mcp_siteminder_get_room_type_bedrooms` | `GET …/room-types/{id}/bedrooms` | |
| `mcp_siteminder_get_quotes` | `GET …/quotes` | Verbatim array. Impossible dates and stays over 31 nights are refused before a call. `adults` is required: the price depends on it and SiteMinder's default of 1 would quote a couple as one guest |
| `mcp_siteminder_build_booking_link` | `GET /properties/{uuid}` + URL building | `bookingEngineUrl` with the stay appended; https only; returns `holdsRoom: false, createsReservation: false` |

Left out on purpose: `/properties` (group keys only), `/media` (its room photos are not tied to a room
type), `/views` (at most one view), `/room-types/{id}` (the list already returns the full `RoomType`).

**Fidelity.** Quotes name the room type and rate only by uuid; the agent joins them with the two list
tools. The adapter does not join them: that would be three calls reshaped into a model of ours.

## 4. The booking link

The one piece that is not a single HTTP call, kept in `stay.ts` as pure functions.

- Appended to whatever `bookingEngineUrl` returns (its host varies by region: `direct-book.com` for
  AMER/EMEA, `book-directonline.com` for APAC); a query it already carries is kept, a stale search is
  overwritten.
- **Dates as `YYYY-MM-DD`.** The guide's table says `dd-mm-yyyy`, every worked example says `YYYY-MM-DD`
  (Q3).
- **The promo code under both `promotion_code` and `promocode`.** Guide and help centre disagree; an
  unknown query parameter is ignored, a wrong one silently drops the guest's discount (Q3).
- **The rate is not pre-selected.** `ratePlanId`/`room_type` are numeric engine ids the API never returns
  (Q4). The guest picks the rate on the engine.
- A URL that is not https is never returned: nothing else is safe to hand a guest.

## 5. Errors

| Status | Code | Why |
|---|---|---|
| 401 | `PROVIDER_AUTH_EXPIRED` | The key is revoked or wrong (E1, E2); only a new key fixes it |
| 403 | `PROVIDER_AUTH_EXPIRED` | Core default (ADR 0007). Documented as `AccessDenied` (a key that cannot see this property, or no Direct Booking subscription), never observed, and how a *revoked* key answers is unknown: hiding a revocation behind `PROVIDER_ERROR` would leave the agent silently broken. Narrow it on the observed identifier once Q2 records a live 403 |
| 400 | `PROVIDER_INVALID_INPUT` | core default |
| 404 | `PROVIDER_ERROR` | core default |
| 429 | `PROVIDER_RATE_LIMITED` | the consumer decides whether to retry a read (ADR 0009) |
| 5xx, transport | `PROVIDER_UNAVAILABLE` | core default |

The message carries the operation, the status and SiteMinder's error identifier (`errors[0].name` or
`.code`, or the flat `name`/`error`), accepted only if it is letters alone (≤ 40), so nothing shaped like
a key or a uuid can reach it. SiteMinder's own
`message` never reaches it ("Do not surface raw API error messages to guests", D9's page).

## 6. Open — what only a hotel's key or SiteMinder can answer

The first live session with the customer's key (read-only, no guest data) must close these, record them
as E-rows, and replace `__fixtures__/documented/` with recordings:

1. **Q1** — `promocode` or `promoCode` on `/quotes`? Is an unavailable stay `200 []`? Is a 32-night stay a
   400, and with which body? Is `infants` honoured?
2. **Q2** — the error body for 403, 404 and 429 (E1 settled 401), and whether a 429 sends `Retry-After`.
3. **Q3** — open one generated link: which date format and which promo parameter the engine honours; then
   drop the loser from `stay.ts`.
4. **Q4** — can anything map the API's uuids to the engine's numeric `room_type`/`ratePlanId`
   (`RoomType.code`?), so the link can pre-select the quoted rate?
5. **Q5** — is `bookingEngineUrl` ever null for a Little Hotelier property with Direct Booking active?
6. **Q6** — is `gross` exactly what the engine charges for the same stay?
7. **Q7** (SiteMinder) — does the customer's Little Hotelier plan include Direct Booking and the API
   integration tab, or is it a paid add-on? Can a Little Hotelier property join Channels Plus?

## 7. What the consumer must do

Filed on xcale-backend#1041: register the toolbox (`src/modules/mcp/toolboxes.ts`) with the pasted
`propertyUuid` as the account key, give a hotel's agent these tools and a skill that quotes from
`get_quotes` and closes with `build_booking_link`, and never tells a guest that a booking exists.
