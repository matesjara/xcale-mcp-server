# Mews provider — design notes

Epic: [xcale-backend#1043](https://github.com/matesjara/xcale-backend/issues/1043) · Status: **building** ·
Author: Juan José, 2026-09-23.

A hotel on Mews connects it, and its agent quotes and books against its real availability. This file holds the
evidence the provider is built on, the decisions it made and what it leaves out. The access request for our own
demo property is in [sandbox-access-request.md](sandbox-access-request.md).

## 1. Evidence — observed against the public demo, 2026-09-23

Everything below comes from calls against `api.mews-demo.com` with the tokens Mews publishes
(`docs.mews.com/connector-api/guidelines/environments`) — enterprise _API Hotel Gross Pricing_, timezone
`Europe/Budapest`. Recordings are in `src/providers/mews/__fixtures__/` (tokens removed, the probe guest
anonymized). A fact read only in the docs is marked **[docs]**; everything else is **[observed]**.

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                | Consequence                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | Every call is `POST /api/connector/v1/<operation>` with a JSON body carrying `ClientToken`, `AccessToken` and `Client`. No header auth exists. [observed]                                                                                                                                                                                                                                           | The core cannot place the credential today — [ADR 0018](../../adr/0018-credential-in-a-json-body-field.md).                                            |
| E2  | `ClientToken` identifies the integration (xcale), `AccessToken` identifies one enterprise. [docs]                                                                                                                                                                                                                                                                                                   | `AccessToken` is the hotel's credential (Rail A). `ClientToken` is ours, deployment config (§3).                                                       |
| E3  | An enterprise has **many** services, and 36 of the demo's are `Bookable` (stays, parking, a restaurant, tours). [observed]                                                                                                                                                                                                                                                                          | Which service is the hotel's accommodation belongs to the hotel. It is the call context, `serviceId`, chosen at connect from `mcp_mews_list_services`. |
| E4  | `services/getAvailability/2024-01-22` answers per resource category and per time unit: `UsableResources`, `Occupied`, `OutOfOrderBlocks`, `PublicAvailabilityAdjustment`, and more. [observed]                                                                                                                                                                                                      | The tool returns those metrics as Mews sends them. The consumer decides what "free" means.                                                             |
| E5  | Time units are **UTC instants of local midnight** (`2026-10-14T22:00:00Z` for 15 October in Budapest). [observed]                                                                                                                                                                                                                                                                                   | A tool taking a date needs the enterprise's timezone to build the instant (§4).                                                                        |
| E6  | `reservations/price` **rejects** `ScheduledStartUtc` (`400 Invalid StartUtc.`) and **accepts** `StartUtc`, which the docs mark as deprecated. It prices by nights: local midnight and the service's check-in time give the same total. [observed]                                                                                                                                                   | The provider sends `StartUtc`/`EndUtc`. Moving to `Scheduled*` is a change we make when Mews accepts it, pinned by a test.                             |
| E7  | `reservations/add` with `StartUtc` and `State: Confirmed` created reservation `130489`, assigned a room, and echoed the `Identifier`. [observed]                                                                                                                                                                                                                                                    | This is the write path. The echoed `Identifier` is the only one Mews gives back.                                                                       |
| E8  | `Identifier` is **not stored**: `reservations/getAll` does not return it, and neither `Notes` nor any other field survives as a lookup key. [observed]                                                                                                                                                                                                                                              | Mews has no idempotency key. The consumer reconciles by customer, dates and category before it retries a create (ADR 0015's split).                    |
| E9  | A second identical `add` failed with **`403`** "this property has no availability for the selected dates": the category had one room. [observed]                                                                                                                                                                                                                                                    | **403 is a business refusal in Mews, not an auth failure** (§5).                                                                                       |
| E10 | A cancel of an already canceled reservation answered **`403` "Please provide reason."** [observed]                                                                                                                                                                                                                                                                                                  | Same as E9.                                                                                                                                            |
| E11 | A bad `AccessToken` answers **`401`** "Cannot perform operation or session has expired." [observed]                                                                                                                                                                                                                                                                                                 | 401, and only 401, is `PROVIDER_AUTH_EXPIRED`.                                                                                                         |
| E12 | The shared demo token returned **`429` "Too many requests."** on the third call of a session, and again under light load: the budget is 200 requests per `AccessToken` per 30 s, sliding window, and other partners spend it. [observed, docs]                                                                                                                                                      | `PROVIDER_RATE_LIMITED`, and the consumer backs off. Automated tests never call the live demo.                                                         |
| E13 | Whether a write that answered `429` was executed is **unknown**: a cancel returned 429, and the reservation was canceled at about that time. [observed]                                                                                                                                                                                                                                             | A write is never retried blind. The consumer reads before it retries (ADR 0015).                                                                       |
| E14 | `reservations/cancel` answered `200` with the canceled ids, and `getAll` then showed `State: Canceled`, `CancellationReason: Other`. [observed]                                                                                                                                                                                                                                                     | This is the cancel path.                                                                                                                               |
| E15 | Malformed ids answer `400 "Invalid JSON."`. [observed]                                                                                                                                                                                                                                                                                                                                              | That is `PROVIDER_INVALID_INPUT`, and the core's default already maps 400 to it.                                                                       |
| E16 | Guests are `customers/add` and must exist before `reservations/add` (`CustomerId`). The reservation records adults and children through `PersonCounts` keyed by **age category**. [observed]                                                                                                                                                                                                        | There is a create-customer tool and an age-categories tool. The consumer maps "2 adults, 1 child" to the categories.                                   |
| E17 | A cancel sent right after a create answered **`403` "Someone else just changed this bill. Refresh to see the latest and try again."**, and the same cancel succeeded 5 s later. [observed]                                                                                                                                                                                                          | That 403 is transient, so it maps to `PROVIDER_UNAVAILABLE`. The consumer re-reads, then retries.                                                      |
| E18 | In the demo, the `Restaurant` service is `Bookable` with `Ordering` 0 and hourly units, and the accommodation has `Ordering` 666. [observed]                                                                                                                                                                                                                                                        | Discovery binds `0.Id`, so `list_services` puts nightly services first. By `Ordering` alone it would bind the restaurant.                              |
| E19 | No resource category in the demo has an image (`ImageIds` is empty on all of them). [observed]                                                                                                                                                                                                                                                                                                      | `images/getUrls` could not be observed, so it is left out of v1 (§7).                                                                                  |
| E20 | **The provider's own code**, run against the demo on 2026-09-23: all 11 read tools answered. A write round trip created reservation `130491` (`StartUtc 2027-01-12T14:00:00Z`, which is 15:00 in Budapest in winter), a duplicate was refused as `PROVIDER_ERROR` with Mews' reason, the cancel hit E17 once and then passed, and a bad `AccessToken` came back `PROVIDER_AUTH_EXPIRED`. [observed] | The fixtures are recordings of the same calls the tools make.                                                                                          |

## 2. Tools

Namespaced `mcp_mews_*`. Reads return Mews' own payload, minus fields the agent has no use for when a
documented projection keeps the result small. **Fidelity over Unification** applies: nothing is renamed.

| Tool                       | Mews operation                        | Why                                                                                                                                                                                     |
| -------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_services`            | `services/getAll`                     | Context discovery and connection probe: the hotel picks its accommodation service. Needs no context. Returns active bookable services only, nightly first and then by `Ordering` (E18). |
| `get_configuration`        | `configuration/get`                   | Name, timezone, currencies, languages: what the agent says about the property.                                                                                                          |
| `list_resource_categories` | `resourceCategories/getAll`           | Room types of the service: names, descriptions, capacity, image ids.                                                                                                                    |
| `list_age_categories`      | `ageCategories/getAll`                | Which person counts a reservation needs (E16).                                                                                                                                          |
| `list_rates`               | `rates/getAll`                        | The rates the service sells.                                                                                                                                                            |
| `get_availability`         | `services/getAvailability/2024-01-22` | Free rooms per category and night (E4).                                                                                                                                                 |
| `get_rate_pricing`         | `rates/getPricing`                    | Nightly prices of a rate for every category.                                                                                                                                            |
| `price_reservation`        | `reservations/price`                  | The exact total of one candidate stay. The quote.                                                                                                                                       |
| `search_customers`         | `customers/getAll`                    | Find the guest by email before creating a duplicate.                                                                                                                                    |
| `add_customer`             | `customers/add`                       | Create the guest (E16).                                                                                                                                                                 |
| `list_reservations`        | `reservations/getAll/2023-06-06`      | By ids, numbers or customer: reconciliation (E8) and "what did I book".                                                                                                                 |
| `create_reservation`       | `reservations/add`                    | Book (E7). One reservation per call, `SendConfirmationEmail` exposed.                                                                                                                   |
| `cancel_reservation`       | `reservations/cancel`                 | Cancel, with a required reason (E10).                                                                                                                                                   |

**Left out on purpose:** payments and bills, products and orders, housekeeping, availability blocks,
companies and travel agencies, and webhooks. The booking vertical does not need them yet. Each can be added
later without breaking the contract.

## 3. Credentials

- **The hotel's `AccessToken`** is the connection's single secret. It is `api_key`, `forwarded`, placed in the
  JSON body field `AccessToken` ([ADR 0018](../../adr/0018-credential-in-a-json-body-field.md)). Mews is not a
  financial provider and moves no money here, so `forwarded` is allowed (ADR 0003).
- **Our `ClientToken`** and the `Client` name are this server's deployment config (`MEWS_CLIENT_TOKEN`,
  `MEWS_CLIENT_NAME`, and `MEWS_BASE_URL` for demo vs production), attached by the client as Siigo attaches its
  `Partner-Id`.
  - **Trade-off, stated:** Mews calls it a token, so it is kept as a secret in Doppler and never logged or put in
    a result. It still passes through the adapter's client, which the golden rule reserves for non-secrets. We
    accept that because the `ClientToken` alone reads nothing: without a hotel's `AccessToken` it opens no
    enterprise. A core-held deployment secret is the alternative if a second provider needs one.
  - Without a `ClientToken`, every call fails closed with `PROVIDER_ERROR` "Mews is not configured on this
    server", before any request goes out.

## 4. Dates

The agent talks in the hotel's dates. The Mews API talks in UTC instants (E5, E6). So the date-taking tools
(`get_availability`, `get_rate_pricing`, `price_reservation`, `create_reservation`) accept `YYYY-MM-DD`
**in the property's local calendar**. The handler reads the enterprise timezone with `configuration/get` on the
same call and converts. This is a translation, not a rule: no stay length, no check-in time and no minimum is
decided here.

- A stay is `checkIn` (first night) and `checkOut` (departure day), the way a guest says it.
- The UTC instant of a local midnight is computed with `Intl` and the IANA zone, so DST is right on both sides of a
  change.
- The extra read costs one request of the 200-per-30 s budget per call. We accept that, so no timezone is cached
  or copied into the context where it could go stale.

## 5. Errors

| Mews                        | Code                     | Why                                                                                                                                                        |
| --------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`                       | `PROVIDER_AUTH_EXPIRED`  | The token is bad or revoked, and reconnecting fixes it (E11).                                                                                              |
| `403`                       | `PROVIDER_ERROR`         | A business refusal: no availability, a missing reason (E9, E10). Reconnecting fixes nothing, and the default map would tell every full hotel to reconnect. |
| `403` that says "try again" | `PROVIDER_UNAVAILABLE`   | A concurrent edit, which passes on retry (E17).                                                                                                            |
| `400`                       | `PROVIDER_INVALID_INPUT` | A malformed call (E6, E15).                                                                                                                                |
| `408`, `429`                | `PROVIDER_RATE_LIMITED`  | Mews documents 408 as "the request demanded too many resources", and it is retryable after backoff like 429 (E12).                                         |
| `5xx`, transport            | `PROVIDER_UNAVAILABLE`   | The core default.                                                                                                                                          |

**The error message carries Mews' `Message` and `RequestId`.** Mews' messages are short, fixed operator English
("no availability for the selected dates", "Please provide reason.") and carry no guest data in anything we
observed. The agent needs the reason to tell a guest the truth: a hotel that is full is not a broken system.
The message is capped at 200 characters and control characters are stripped. `RequestId` identifies the
call in Mews' support.

## 6. What the consumer (xcale-backend) must do

Filed as a consumer issue, through `/cross-repo`:

1. Register the toolbox (`src/modules/mcp/toolboxes.ts`) with the `api_key` connect method and its i18n
   (`mews.connect.method.api_key.label|instructions`), `serviceId` picked from `list_services` at connect.
2. **Make the booking vertical choose its adapters per provider.** Today `booking/wiring.ts` always builds the
   Cloudbeds adapters, and the agent tools stamp `provider: 'cloudbeds'`. This is the precondition for Mews and for
   every PMS after it (Erbon, LobbyPMS).
3. Mews adapters for the booking ports. The Gate reconciles a create by customer, dates and category (E8, E13).

## 7. Open

- **Our own `ClientToken` and a dedicated demo property**: requested (see the access request). Until then the
  provider is proven with recorded fixtures only.
- **Certification**: which operations Mews expects a booking-agent integration to cover. Ask partner success.
- **Room photos** (`images/getUrls`): unobserved (E19). Add the tool once a property with images is reachable,
  from a recorded answer, as the other tools were.
- **Portfolio tokens** (`EnterpriseId` on every call, for chains): out of scope for v1.
