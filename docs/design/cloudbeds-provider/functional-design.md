# Cloudbeds Provider — Functional Design (maturity model)

> **Purpose:** model the **complete** Cloudbeds provider, not just today's 7 read tools — so we can see
> the mature provider and sequence its growth against the real goal: a **conversational Booking core**
> integrated end-to-end (Channels → Conversational System → Booking Agent → Booking Core → xcale-backend
> → MCP → Cloudbeds).
> **Evidence:** current code (`src/providers/cloudbeds/`) + the official Cloudbeds v1.2/v1.3 endpoint
> catalog (`developers.cloudbeds.com/llms.txt`). No capability is invented; every future tool below maps
> to a real Cloudbeds endpoint.
> **Status:** Draft for review. Feeds the gaps / tech-debt / opportunities docs and the Implementation Plan.
> **Last Updated:** 2026-07-10

---

## 0. Framing — what "the provider" is for

The Cloudbeds provider exists to give a **Booking Agent** the capabilities a guest conversation needs:
*discover → check availability → quote → book → modify → reconcile → (later) service the stay*. It is a
**thin, stateless adapter** (soul.md): each tool = one Cloudbeds endpoint, provider `data` verbatim,
`propertyID` via Explicit Context, consumer-agnostic. Business logic (quoting strategy, upsell,
reconciliation, notifications) lives in the **consumer** (Booking Core / xcale-backend), never here.

**Selection principle (per soul.md "curate 30–50, prove-don't-pre-abstract"):** a tool earns its place
only when the Booking conversation actually needs it. We model the full surface but **ship by demonstrated
conversational need**, not by covering the API.

---

## 1. Current state

> **Updated 2026-07-15 — Booking v1 (W1+W2+W3) is shipped on the provider side.** Beyond the seven read
> tools below, the provider now has `get_rate_plans` (the quote), `create_reservation`, and
> `modify_reservation` (cancel / checkoutDate / rooms), plus the external-reference filter on
> `list_reservations`. What remains for a booking conversation is **consumer-side**: the Booking vertical
> module and its gate (which owns reconciliation). See §5 and §7.

### The original read-first pilot (v0.2.0)

Seven read tools (`tools.ts`), all `GET`, read scopes only:

| Tool | Cloudbeds | Booking role |
|:--|:--|:--|
| `list_properties` | `getHotels` | context discovery (`propertyID`) |
| `get_hotel_details` | `getHotelDetails` | property facts |
| `get_availability` | `getAvailableRoomTypes` | availability for a date range |
| `get_room_calendar` | `getRatePlans` (`detailedRates`) | **when** a room is free, looking forward — free windows per room type |
| `list_room_types` | `getRoomTypes` | room types (+ rates, partial) |
| `list_reservations` | `getReservations` | list/search reservations |
| `get_reservation` | `getReservation` | one reservation |
| `get_guest` | `getGuest` | one guest |

**Gap in one line:** the provider can **read** a property but cannot **quote precisely, book, modify, or
reconcile** — i.e. it cannot yet support a real booking conversation end-to-end.

---

## 2. Domain model of the complete provider

Grouped by Booking-relevant domain. Legend: **[HAVE]** shipped · **[E-08]** in the write-path contract ·
**[NEXT]** needed for a functional Booking core · **[LATER]** valuable, not core · **[OUT]** out of the
conversational-Booking scope (different vertical/ops surface).

### 2.1 Discovery & Property
| Capability | Cloudbeds | Status | Why |
|:--|:--|:--|:--|
| List properties | `getHotels` | [HAVE] | context discovery |
| Property details | `getHotelDetails` | [HAVE] | facts, policies |
| Sources / channels | `getSources` | [LATER] | attribute a booking's origin |
| Taxes & fees | `getTaxesAndFees` | **[NEXT]** | **accurate totals when quoting** |
| Currency settings | `getCurrencySettings` | [LATER] | display currency |

### 2.2 Availability & Rates (the "quote")
| Capability | Cloudbeds | Status | Why |
|:--|:--|:--|:--|
| Available room types | `getAvailableRoomTypes` | [HAVE] | what's bookable |
| Room types | `getRoomTypes` | [HAVE] | descriptions/occupancy |
| Rate plans | `getRatePlans` | **[HAVE — W1]** | **the quote**: rateID for create + per-night rates & restrictions via `detailedRates` (§7) |
| Rate detail | `getRate` | **[DROPPED]** | redundant with `get_rate_plans` — evidence §7 |
| Forward calendar | `getRatePlans` (`detailedRates`) | **[HAVE — 2026-09-09]** | shipped as `get_room_calendar`. The same call as the quote, read as a CALENDAR: nightly `roomsAvailable` + restrictions collapsed into bookable windows. No new scope, no guest data. **Unconfirmed live:** per-night `roomsAvailable` is not in §7's observed field list — the tool refuses rather than reporting a false "nothing is free" if a property omits it |
| Rooms with fees/taxes | `getRoomsFeesAndTaxes` | [BLOCKED] | all-in nightly price — **scope not granted** (§7) |
| Eligible rates / policies | `getEligibleRates` | [LATER] | policy-aware quoting |
| Packages | `getPackages` / `getPackageNames` | **[OUT]** | `Package: Read` **not granted** to the app (§7) |

> **Key insight:** a trustworthy conversational **quote** needs `getRatePlans` + `getRate` (+ taxes/fees),
> and `postReservation` needs `roomRateID`/`rateID` — so **Rates is the highest-value missing domain**,
> a hard dependency of a correct booking.

### 2.3 Reservations (read + write)
| Capability | Cloudbeds | Status | Why |
|:--|:--|:--|:--|
| List / search | `getReservations` | [HAVE] + [E-08] ext-ref filter | search + reconciliation |
| Get one | `getReservation` | [HAVE] | detail |
| With rate details | `getReservationsWithRateDetails` | [LATER] | richer read |
| Assignments / room details | `getReservationAssignments`, `getReservationRoomDetails` | [LATER] | ops |
| **Create** | `postReservation` | **[HAVE — W2]** | **the booking** |
| **Modify / cancel** | `putReservation` | **[HAVE — W3]** | cancel via `status`; extend/shorten via `checkoutDate`; change `rooms`. **Check-in date is NOT modifiable** (§7) |
| Notes | `postReservationNote` / `getReservationNotes` | [LATER] | agent annotations |

### 2.4 Guests
| Capability | Cloudbeds | Status | Why |
|:--|:--|:--|:--|
| Get guest | `getGuest` | [HAVE] | detail |
| Guest list / search | `getGuestList`, `getGuestsByFilter` | [LATER] | returning-guest lookup |
| Create / update | `postGuest` / `putGuest` | [LATER] | `postReservation` already creates the guest inline |

### 2.5 Groups & Allotments
| Capability | Cloudbeds | Status | Why |
|:--|:--|:--|:--|
| Group accounts, allotment blocks | `getGroups`, `createAllotmentBlock`, `getAllotmentBlocks`, … | [LATER] | multi-room/group bookings (a later Booking capability) |

### 2.6 Payments & Charges
| Capability | Cloudbeds | Status | Why |
|:--|:--|:--|:--|
| Charge / payment / void / credit card | `postCharge`, `postPayment`, `postVoidPayment`, `postCreditCard`, `getPaymentMethods`, `getPaymentsCapabilities` | **[OUT]** | **payment is a separate risk vertical** — re-triggers the credential ADR gate (FD §5). Booking-only stays out. |

### 2.7 Stay operations (post-booking)
| Capability | Cloudbeds | Status | Why |
|:--|:--|:--|:--|
| Check-in / check-out / assign | `postRoomCheckIn`, `postRoomCheckOut`, `postRoomAssign` | [LATER] | front-desk ops, beyond the booking conversation |
| Housekeeping | `getHousekeepingStatus`, … | [OUT] | ops domain, not guest-facing booking |
| Door locks | `getDoorlockKeys`, … | [OUT] | ops |

### 2.8 Communications
| Capability | Cloudbeds | Status | Why |
|:--|:--|:--|:--|
| Email templates / schedule | `getEmailTemplates`, `postEmailSchedule` | [OUT] | xcale narrates lifecycle via its **own** channels (WhatsApp/Telegram) + the order-lifecycle-notifier pattern; Cloudbeds email is redundant for the conversational core |

### 2.9 Lifecycle signals
| Capability | Cloudbeds | Status | Why |
|:--|:--|:--|:--|
| Webhooks | `postWebhook`, `getWebhooks`, `deleteWebhook` | [LATER — architectural] | reservation lifecycle events could drive agent-narrated post-booking notifications (mirrors the Shopify order-lifecycle notifier). Design impact — see §4. |

### 2.10 Analytics / Reports / Insights / Events / Items / Amenities / Market Segmentation
`getReports*`, `getCharts`, `getItems`, `getAmenityCatalog`, `listEvents`, market-segmentation, stock
reports, etc. → **[OUT]** of the conversational Booking core (BI/ops/PMS-admin surfaces). Modeled here for
completeness; not on the Booking roadmap.

---

## 3. What a "functional Booking core" minimally requires

Ordered by dependency. This is the **[NEXT]** set beyond [HAVE] + [E-08]:

1. **Rates/quote** — `getRatePlans`, `getRate` (+ `getTaxesAndFees`, `getRoomsFeesAndTaxes`). *Hard
   dependency of a correct `postReservation` (needs `roomRateID`) and of an honest conversational quote.*
2. **Create** — `postReservation` (**[E-08]**, contract frozen).
3. **Modify/cancel** — `putReservation`. *A booking conversation that can't change or cancel is incomplete.*
4. **Reconciliation read** — `list_reservations` + external-ref filter (**[E-08]**).

Everything else is [LATER]/[OUT]. **Booking v1 = Rates + Create + Modify + Reconcile**, on top of the
existing availability/property reads.

---

## 4. Architectural notes (end-to-end, not provider-in-isolation)

- **Quoting stays in the consumer.** The provider exposes `getRate`/`getRatePlans` verbatim; the *quote
  computation, upsell, and policy choices* are Booking Core logic (backend-driven). The provider must not
  compute prices.
- **Create needs a rate reference.** `postReservation.rooms[].roomRateID` comes from the rates domain →
  the Booking Agent flow is *availability → rate plans/quote → confirm → create*. This sequences the
  [NEXT] rates tools **before** create is conversationally useful, even though create is contract-ready.
- **Lifecycle notifications** should reuse xcale's existing **order-lifecycle-notifier** pattern (agent
  narrates payment/confirmation/reminders over WhatsApp/Telegram), fed by Cloudbeds **webhooks**
  (`postWebhook`) — not by Cloudbeds email. This is the cleanest reuse of the conversational architecture
  already built for Commerce.
- **Multi-property** is already first-class (`propertyID` via Explicit Context / `accountKey`). No change.
- **Statelessness holds** across the whole model: every tool is a verbatim pass-through; no server state.

---

## 5. Maturity roadmap (ship by conversational need)

| Wave | Tools | Unlocks | Depends on |
|:--|:--|:--|:--|
| **W0 (done)** | 7 read tools | "browse a property" | — |
| **W1 — Quote (done 2026-07-15)** | `get_rate_plans` (`getRatePlans`, incl. `detailedRates`) | honest conversational pricing (per-night + restrictions); supplies the `rateID` create needs | W0 |
| **W2 — Book (done 2026-07-15)** | `create_reservation` (`postReservation`) + ext-ref filter | the booking + reconciliation | W1 (rate ref), auth `write:reservation` |
| **W3 — Manage (done 2026-07-15)** | `modify_reservation` (`putReservation`): cancel via status, `checkoutDate`, `rooms` | change/cancel a booking | W2 |
| **W4 — Notify** | Cloudbeds `postWebhook` wiring → lifecycle notifier reuse | agent-narrated post-booking updates | W2, backend notifier |
| **Later** | notes, sources, guest CRUD, groups/allotments, stay ops | richer/group/ops flows | as needed |
| **Out** | payments, housekeeping, door locks, BI/reports, comms email | separate verticals / ops / admin | — |

> Note the sequencing correction the evidence forces: **W1 (Rates) precedes conversational use of W2
> (Create)** — `postReservation` needs a `roomRateID`, and a booking conversation needs a real quote.
> E-08's contract is frozen, but W1 is a prerequisite for the *flow* to be truthful.

---

## 6. Decisions (resolved 2026-07-15)

1. **Booking v1 scope = W1 + W2 + W3** (quote + book + modify/cancel). A booking conversation that
   cannot change or cancel is incomplete, so W3 is in v1. W4 (notifications) stays deferred — and is
   additionally scope-blocked (§7).
2. **Rates modeling = expose the raw endpoints.** No `get_quote` convenience tool: quoting strategy,
   upsell and policy are Booking Core logic. A quote tool would put business logic in the provider and
   couple it to one consumer — both forbidden by soul.md.
3. **Webhooks (W4) = deferred by scope choice, NOT by capability.** ⚠️ **Corrected 2026-07-15** — an
   earlier version of this doc claimed W4 was *scope-blocked*. **That was wrong** (§7.1): webhooks work
   with the token we already hold. W4 stays out of v1 because v1 is W1+W2+W3, not because it is
   impossible.

---

## 7. Sandbox evidence (observed 2026-07-15, property `320754`) — corrections to this doc

Probed live with a write-scoped token. **Three corrections to the model above:**

| Endpoint | Observed | Consequence |
|:--|:--|:--|
| `getRatePlans` | `startDate` **required**; returns per room type `rateID`, `roomRate`/`totalRate` **for the whole range**, `roomsAvailable`. With `detailedRates=true` it adds `roomRateDetailed[]`: **per-night** `rate` **plus stay restrictions** (`minLos`, `maxLos`, `closedToArrival`, `closedToDeparture`, `blocked`). | **This one endpoint is the whole quote.** Shipped as `get_rate_plans` (W1). |
| `getRate` | Requires `roomTypeID` + `startDate` (**not** `rateID`, as §2.2 assumed). Returns the same fields as one `getRatePlans` entry, for a single room type (as strings: `"700.00"`). | **Strictly redundant** with `get_rate_plans`. **Not shipped** — per §0's selection principle, it has not earned its place. Revisit only if a conversation proves the narrower call is needed. |
| `getTaxesAndFees` | `{"success": false, "message": "Scope required for this call was not granted by property."}` | **Scope-blocked.** The app authorizes *Taxes and Fees: Read*, but the **token** carries only the 7 scopes the descriptor requests. Needs the taxes scope added to `auth.ts` **and a reconnect**. Same for `getRoomsFeesAndTaxes` (which additionally requires `roomsTotal` **and** `roomsCount`). |
| `putReservation` (W3) | Sent as **POST** → `404 {"status":false,"error":"Unknown method."}`. Sent as **HTTP PUT** → works. | **Cloudbeds maps the method-name prefix to the HTTP verb** (`get*`→GET, `post*`→POST, `put*`→PUT). Getting this wrong fails as *"the endpoint does not exist"*, not as a bad request — a trap worth pinning with a test. The core's `HttpMethod` gained `'PUT'` (a generic transport verb, no provider knowledge in core). |
| `putReservation` mutable set | `"At least one of the following parameter(s): [ customFields, estimatedArrivalTime, rooms, status, checkoutDate, dateCreated ] is(are) required"` | **§2.3's "change dates" was wrong.** `startDate`/`endDate` are **not** modifiable: only **`checkoutDate`** (extend/shorten). Moving a check-in means cancel + re-create. `status: "canceled"` **verified working** end-to-end (create → cancel → `getReservation` shows `canceled`), which confirms the cancel path given `Reservation: Delete` is not granted. An invalid status returns `"Incorrect status. You cannot change status"` — surfaced as an error, never a false success. |

**Wire trap (now covered by a test):** Cloudbeds answers a **bad request with HTTP 200 + `success:false`**
— missing param *and* ungranted scope both look like a success at the status-code level. The envelope, not
the status, decides. Every tool must unwrap through the shared `unwrap()`; a tool that trusted the 200
would hand the agent a phantom empty result.

### 7.1 Webhooks are NOT scope-blocked — a correction, and the lesson behind it

**Observed 2026-07-15 with the token we already hold** (7 scopes, no webhook scope among them):

| Call | Result |
|:--|:--|
| `getWebhooks` | `{"success": true, "data": []}` — **works.** No scope error. |
| `postWebhook` | Required-param chain `endpointUrl` → `object` → `action`, then **created a real subscription** (`{"success":true,"data":{"subscriptionID":"…"}}`). |
| `deleteWebhook` | Works — but params must ride the **query string**; a DELETE body is not parsed. |

**Webhooks require no scope at all.** A previous version of this doc asserted W4 was "scope-blocked" —
**inferred from the absence of "Webhook" in the app's grant list, never observed.** The wire disagrees.
The lesson is the same one `resultsPerPage` and the `patch-id` episode taught: *absence of evidence was
read as evidence of absence.* **Probe before declaring something impossible.**

**Two wire facts W4 must design around:**
- **Cloudbeds does not validate `action`.** `action: 'bogus_action'` was accepted and created a live
  subscription. So the event vocabulary cannot be discovered from an error, and a typo silently yields a
  subscription that never fires. W4 must treat the action list as **doc-sourced and verified by
  observing a real delivery**, not by trusting a 200.
- **The subscription's read shape uses `id`**, while `postWebhook` returns `subscriptionID` — the same
  value under two names.

**Why this matters strategically:** unlike Meta, **we own the subscription end-to-end via the API** —
`endpointUrl` is ours to set, no third-party console. So W4's trigger is **not blocked by anything
external**; it only needs a public URL (ngrok in dev). That removes the reason W4 looked impossible.

### 7.2 The event vocabulary — observed, not inferred (2026-07-15)

§7.1 said the action list could only be trusted after a real delivery. It has now been observed. Method:
because `endpointUrl` is ours, every candidate action was subscribed to **its own URL**
(`/obs/<object>__<action>`), so the delivery identifies itself by which path it reaches. A real booking
was created and cancelled against sandbox 320754.

**All 12 candidate subscriptions returned `success:true` — including `reservation/zzz_bogus_action`,
invented as a negative control.** Only 4 ever delivered. The 200 is worth exactly nothing; the control
never fired, so the method discriminates.

| Subscribed | Delivered? |
|:--|:--|
| `reservation/created` | ✅ on create |
| `guest/created` | ✅ on create |
| `guest/assigned` | ✅ on create |
| `reservation/status_changed` | ✅ on cancel |
| `reservation/cancelled`, `modified`, `updated`, `changed`, `dates_changed`, `deleted`, `accommodation_status_changed` | ❌ never |
| `reservation/zzz_bogus_action` (control) | ❌ never |

**A cancel is a `status_changed`, not a `cancelled`.** There is no `cancelled` action — the plausible
name is the wrong one, which is precisely why guessing would have produced a notifier that never fires.

**One create emits TWO OR THREE deliveries, and the count is not fixed.** A booking for a *new* guest
emits `guest/created` → `guest/assigned` → `reservation/created` (~1s apart, out of causal order by
timestamp). A booking for a guest Cloudbeds already knows (same email ⇒ same `guestID`) emits only
`guest/assigned` + `reservation/created` — **no `guest/created`**. Observed both ways. So a consumer
cannot count deliveries to decide when a booking is "complete", and one that notifies per delivery
notifies two-to-three times per booking. **Dedup on the reservation, not on the delivery.**

#### The payload (verbatim, `reservation/status_changed`)

```json
{"reservationID":"2326925352181","propertyID":320754,"propertyID_str":"320754",
 "status":"canceled","previousStatus":"confirmed",
 "actor":{"type":"api-client","id":"xcale_D1V3aoC7zjl2pJOPrfwQvFXg"},
 "subReservations":[{"id":"233559641","roomId":"","subReservationId":"2326925352181",
                     "startDate":"2026-09-14","endDate":"2026-09-16"}],
 "version":"1.0","event":"reservation/status_changed","timestamp":1784141201.429757}
```

What the wire settles for W4's design:

- **The payload self-identifies** via `event: "<object>/<action>"`. The per-action URL was a discovery
  device; production needs **one** endpoint and can dispatch on `event`.
- **`status` + `previousStatus` carry the transition.** A status notification needs no re-read.
- **🔑 `actor` solves the echo problem — and the discriminator is now OBSERVED, not assumed.** The same
  cancel was performed twice, once through our API and once by a human clicking *Cancel reservation* in
  the Cloudbeds admin UI:

  | Cancel performed by | `actor` |
  |:--|:--|
  | our API client | `{"type":"api-client","id":"xcale_D1V3aoC7zjl2pJOPrfwQvFXg"}` |
  | a human in the Cloudbeds UI | `{"type":"user","id":"196623333724237"}` |

  **`actor.type` is the echo discriminator.** `api-client` + our own client id ⇒ our write, which the
  agent already narrated in-band ⇒ **skip**. `type:"user"` ⇒ a human at the property changed the booking
  ⇒ **notify**. Matching on `actor.id` (not just the type) matters: another integration on the same
  property would also be `api-client`, and its writes ARE out-of-band for us.
  Note `guest/created` and `reservation/created` carried **no** `actor` field at all — absence must be
  handled, not assumed.
- **Casing is inconsistent across objects.** `reservation/*` uses `propertyID`/`reservationID`;
  `guest/*` uses `propertyId`/`guestId`/`reservationId`. Same concept, different spelling per object —
  the parser must be per-event, not shared.
- **`propertyID` arrives as a JSON number AND as `propertyID_str`.** Use the `_str` twin; property ids
  are identifiers, and a 64-bit id through a JSON float is a silent corruption.
- **No event/delivery id.** Dedup must be synthesized (`event` + entity id + `timestamp`).
- **No retry observed** (none needed — we answered 200). Retry semantics remain **unknown**.

#### 🚨 Deliveries are UNAUTHENTICATED

```
user-agent: CloudBeds-Webhooks/4.0.0     from 54.186.119.140 (AWS)
```

**No signature. No HMAC. No shared secret. No auth header of any kind.** Unlike Shopify
(`x-shopify-hmac-sha256`) and Meta (`x-hub-signature-256`), Cloudbeds proves nothing. Anyone who learns
the endpoint URL can post a forged `reservation/status_changed`.

Since soul.md ranks Security first, the receiver **must not trust the payload as a business fact**. The
mitigation is threefold and none of it is optional:
1. **An unguessable per-subscription secret in the path** — the URL is ours to set, so it doubles as the
   bearer. It must therefore be treated as a credential (never logged, rotatable).
2. **Re-read from Cloudbeds before acting on anything that matters.** The payload is a *hint that
   something changed*, never the truth of what it changed to.
3. **Never let a webhook mutate state directly** — it triggers a reconciliation, it does not perform one.

`subscriptionID` is **deterministic**: deleting all 12 subscriptions and re-creating them returned the
byte-identical ids, so it is a hash of (property, endpointUrl, object, action). Re-subscribing is
therefore naturally idempotent — `ensure`, not `create`.

**The reservation status vocabulary** (read off the admin UI's own status dropdown, so it is the
property-facing truth): `Confirmed`, `Confirmation Pending`, `Canceled`, `In-House`, `Checked Out`,
`No-Show`. The wire value for a cancel is `canceled` (one `l`).

**Still unknown (do not guess):** the retry policy and timeout; what `accommodation_status_changed` and
`dates_changed` respond to (a checkout-date change was never tried); whether `deleted` exists at all;
whether the other statuses (`no-show`, `checked out`, `in-house`) each emit `status_changed` — only
`confirmed → canceled` has been observed.

**Scope reality vs the app's grant list.** The app is authorized for 31 scopes, but the **descriptor**
decides what the token actually carries. Anything outside the requested set fails at runtime with the
scope message above — so *"the app allows it"* is **not** enough. `Package: Read` is **not** granted at
all → **Packages move from [LATER] to [OUT]** (§2.2). `Reservation: Delete` is **not** granted → cancel
**must** go through `putReservation` status, which is what §2.3/W3 already assumed. ✔
