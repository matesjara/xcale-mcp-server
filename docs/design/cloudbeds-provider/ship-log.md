# Cloudbeds Provider — Ship Log

> **Purpose.** The running record of what has actually been built, verified and released for the
> Cloudbeds provider, and where each piece stands. `/git-workflow` Level 2 gate 4 asks for this on a
> feature that has a design folder and a new API surface; it had never been enforced on this folder,
> so every merged Cloudbeds tool PR before 2026-09-10 is absent from it. Backfilling that is not
> attempted here — this log starts where the gate started being applied, and says so rather than
> inventing a history.

## Status

| Slice | State | Where |
|---|---|---|
| Read tools (properties, availability, room types, reservations, rate plans, addons…) | **released** | on `main`, deployed |
| Write path (create/modify reservation, payments) | **released** | on `main`, deployed |
| `get_room_calendar` — forward availability | **in review** | PR #62, branch `feat/cloudbeds-room-calendar` |

---

## `get_room_calendar` — answer WHEN a room is free

### Why

Observed in a live WhatsApp conversation on **2026-09-07**: a guest asked *"¿para cuándo está
disponible esa?"* and the agent could only check dates the guest named. It could confirm a no, never
turn it into a yes, so the sale ended at the first "not available". `get_availability` prices ONE
window; nothing could look forward.

### What it does

One `getRatePlans` call with `detailedRates=true` — no new scope, no reconnect, no guest data — read
as a CALENDAR rather than as a quote: per room type, the date ranges that can really be booked
(`freeWindows`) and the dates that cannot (`unavailable`). `to` is the CHECKOUT date.

**A window guarantees that whole stay and only that.** Arriving on `from` and leaving on `to` is
sellable. It does not promise every shorter stay inside it is, because an interior night can refuse
arrivals or demand a longer stay. The published description says this to the agent in those words —
the first revision promised more than the data supports, and the guest hears that difference.

### Verified

| What | How | When |
|---|---|---|
| Reachable through `tools/call`, not merely declared | A deliberately bad token returns `PROVIDER_AUTH_EXPIRED` — the handler resolved context, built the request and egressed | 2026-09-09 |
| `read:rate` already granted | Among the 24 registered scopes — no reconnect, no consent change | 2026-09-09 |
| **Per-night `roomsAvailable` really arrives** | Live read of `getRatePlans(detailedRates)` against Bio Habitat through the gateway: present on every night of every rate plan. Full row recorded in `functional-design.md` §7.3 | **2026-09-10** |
| **End to end against the live property** | `get_room_calendar` called through the gateway with the real connection: 4 room types, named, 30-night windows, correct checkout dates | **2026-09-10** |
| Unit coverage | 45 tests across `availability-calendar.test.ts` (31) and `room-calendar.test.ts` (14) | 2026-09-10 |

### What the live read changed in the code

`maxLos: 0` is **no maximum**, not a zero-night stay — it is what every observed row carries. Read as
a cap, every window collapses and the tool answers "nothing is free" for a property that is wide
open. The live call above is what proves the reading: all four room types come back with full
30-night windows.

`cutOff` and `lastMinuteBooking` ride the same rows, are `0` everywhere observed, and are
deliberately **not read**. A booking cut-off decides whether a date can still be booked today;
inventing its unit from a field that has only ever been zero would put a guessed rule between a guest
and a real date. Recorded in the design doc, unread in code.

### Ops

None. No migration, no new scope, no config. The tool appears in `tools/list` on deploy;
`schemaVersion` and `providerVersion` are bumped so a consumer keyed on either sees it.

**Cross-repo ordering is hard, and runs opposite to the PR's first description.** Merging to `dev`
does not deploy — DigitalOcean tracks `main`. Meanwhile `xcale-backend`'s paired branch
(`feat/booking-forward-calendar`) edits the booking concierge skill to *instruct* the agent to call
`mcp_cloudbeds_get_room_calendar` after a "not available". **This PR must reach `main` and be
deployed BEFORE that backend release**, or a real guest asks "¿para cuándo?", the prompt tells the
agent to look ahead, the tool is not in `tools/list`, and the agent invents dates or claims it
checked.

### Gates

- `/git-workflow` Level 2 gate 5 (QA scenarios) is **N/A** in this repo: `.claude/skills/qa/` targets
  `xcale-backend`. Marked explicitly rather than passed over.

---

## Known divergence to fix in the consumer

`closedToDeparture` belongs to the **checkout date**, not to the stay's last night. This module was
corrected on 2026-09-10; the consumer's booking Gate
(`xcale-backend/src/modules/booking/adapters/cloudbeds/cloudbeds-stay-truth.adapter.ts`) still reads
it off `nights[nights.length - 1]`, so it fails in both directions: it refuses a stay whose last
night carries the flag even when the morning after is open, and it accepts one whose checkout lands
on a date the property refuses departures.

The same file also applies `minLos` as `nights.length >= max(minLos over ALL nights)`; `minLos` is a
rule about the stay that BEGINS on a night, so only the arrival night's value governs.

Neither is in scope here — this repo cannot fix a consumer — and both need an issue in
`xcale-backend`. Recorded so the divergence is not discovered a third time.
