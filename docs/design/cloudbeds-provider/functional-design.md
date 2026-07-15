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

## 1. Current state (v0.2.0 — read-first pilot)

Seven read tools (`tools.ts`), all `GET`, read scopes only:

| Tool | Cloudbeds | Booking role |
|:--|:--|:--|
| `list_properties` | `getHotels` | context discovery (`propertyID`) |
| `get_hotel_details` | `getHotelDetails` | property facts |
| `get_availability` | `getAvailableRoomTypes` | availability for a date range |
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
| Rate plans | `getRatePlans` | **[NEXT]** | **priceable rate options (rateID/roomRateID for create)** |
| Rate detail | `getRate` | **[NEXT]** | **exact price for dates → the quote** |
| Rooms with fees/taxes | `getRoomsFeesAndTaxes` | [NEXT] | all-in nightly price |
| Eligible rates / policies | `getEligibleRates` | [LATER] | policy-aware quoting |
| Packages | `getPackages` / `getPackageNames` | [LATER] | package offers |

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
| **Create** | `postReservation` | **[E-08]** | **the booking** |
| **Modify** | `putReservation` | **[NEXT]** | **change dates/rooms; cancel via status** |
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
| **W1 — Quote** | `getRatePlans`, `getRate`, `getTaxesAndFees` | honest conversational pricing; supplies `roomRateID` | W0 |
| **W2 — Book (E-08)** | `create_reservation` (`postReservation`) + ext-ref filter | the booking + reconciliation | W1 (rate ref), auth `write:reservation` |
| **W3 — Manage** | `modify_reservation` (`putReservation`), cancel | change/cancel a booking | W2 |
| **W4 — Notify** | Cloudbeds `postWebhook` wiring → lifecycle notifier reuse | agent-narrated post-booking updates | W2, backend notifier |
| **Later** | notes, sources, guest CRUD, groups/allotments, stay ops | richer/group/ops flows | as needed |
| **Out** | payments, housekeeping, door locks, BI/reports, comms email | separate verticals / ops / admin | — |

> Note the sequencing correction the evidence forces: **W1 (Rates) precedes conversational use of W2
> (Create)** — `postReservation` needs a `roomRateID`, and a booking conversation needs a real quote.
> E-08's contract is frozen, but W1 is a prerequisite for the *flow* to be truthful.

---

## 6. Open decisions for review

1. **Booking v1 scope** = W1 + W2 + W3 (+ W4 notifications)? Or W1+W2 only for the first end-to-end demo?
2. **Rates modeling:** one `get_rate_quote` tool that the agent calls per date-range, or expose
   `getRatePlans`/`getRate` separately? (Consumer-agnostic + fidelity argues for exposing the raw
   endpoints; a "quote" convenience risks putting business logic in the provider.)
3. **Webhooks (W4):** is lifecycle-driven notification in scope for the first Booking core, or deferred?
