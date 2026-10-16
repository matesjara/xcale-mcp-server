# Profitroom Read-Only Provider — Implementation Plan

> **Upstream**: [feature-design.md](feature-design.md) · [api-contract.md](api-contract.md) · ADR [credential-less-provider-auth](../../adr/credential-less-provider-auth.md)
> **Issue**: matesjara/xcale-mcp-server#142 · **Status**: Planned · **Last updated**: 2026-10-14
> **Language note**: English per this repo's `CLAUDE.md` (design docs are durable).

## Meta-description

Two phases on **one code branch** (`feat/implementation-profitroom-provider`), one PR to `dev`, with the core and the provider in **separate commits** so the core change can be reviewed on its own. **Phase 0** adds the `none` auth variant to the core: one union member, one early return in the materializer, one conformance case, plus tests. **Phase 1** builds `src/providers/profitroom/` on top of it. That means a fixed-base, header-only client with a 15-minute in-memory cache for static resources and zod validation of every response (fail closed), five money-free menu tools, a `controlPlane` `get_stay_prices`, the booking-link builder, a one-line registration, and a daily drift workflow that reuses the provider's own zod schemas.

Done means: `tools/list` shows the five menu tools and not `get_stay_prices`. A `tools/call` against live `hotellapausa` returns real rooms, rates, calendar and proposals (`mcp-contract-qa`). Every fail-closed rule in contract §C.4 has a fixture test. The drift workflow runs green on `workflow_dispatch`.

> **One PR, not two (changed 2026-10-14).** The first draft split phase 0 and phase 1 into two PRs, because Provider Self-Containment keeps `src/core` out of a provider PR and ADR 0017 escalates core changes. With no stacked PRs allowed, a separate phase 1 PR would have to wait for phase 0 to merge. Sara chose one code branch over the docs branch (#143) instead. The core change stays isolated in its own commit (`feat(core): …`), is escalated to Mateo by nature (this is a manual PR, not `/implement`), and the PR body calls it out.

> **Detail does not taper.** Both phases touch code that exists today, so both are specified per file.

---

## Phase 0 — `none` auth variant (core)

**Branch**: `feat/implementation-profitroom-provider`, cut from the docs branch `docs/142-profitroom-provider-design` (matesjara/xcale-mcp-server#143), which stays docs-only and is this branch's base. Its PR targets `dev` (no stacked PRs) and merges **after** #143; until then its diff also shows the docs commits. PR title: `feat(core): credential-less providers — the none auth variant`.

### 0.1 Target tree

```
src/core/
  provider-port.ts                              MODIFIED
  auth/authentication-materializer.ts           MODIFIED
  testing/provider-conformance.ts               MODIFIED
  __tests__/credential-less-provider.test.ts    NEW
docs/adr/credential-less-provider-auth.md       NEW
docs/adr/README.md                              MODIFIED
CONTEXT.md                                      MODIFIED
docs/design/profitroom-read-only-provider/      NEW
```

### 0.2 Per-file changes (as built 2026-10-14)

| File                                              | Symbol                                           | Change        | Intent                                                                                                                                 | Seam                                                                                                      |
| :------------------------------------------------ | :----------------------------------------------- | :------------ | :------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `src/core/provider-port.ts:16`                    | `ProviderAuthDescriptor`                         | MODIFIED      | New first member `{ readonly type: 'none'; readonly credentialDelivery?: never }`                                                      | `credentialDelivery?: never` keeps `src/protocol/mcp-server.ts:85` compiling untouched                    |
| `src/core/auth/authentication-materializer.ts:18` | `materialize(auth, resolved, spec): HttpRequest` | MODIFIED      | Early `return plainRequest(...)` for `none` **before** the reveal; TS narrowing removes `none` from the switch, so no unreachable case | Single reveal statement unchanged (CI grep is per file, `docs/security/credential-boundary-review.md:75`) |
| `src/core/auth/authentication-materializer.ts`    | `plainRequest(spec, headers, url): HttpRequest`  | NEW (private) | The request-building tail, shared by `none` and the authenticated path                                                                 | —                                                                                                         |
| `src/core/testing/provider-conformance.ts:16`     | `assertAuthDescriptorShape(auth, label): void`   | MODIFIED      | `case 'none'`: nothing to assert beyond the JSON round-trip                                                                            | Conformance for every provider                                                                            |
| `src/protocol/mcp-server.ts:85`                   | —                                                | UNCHANGED     | `credentialDelivery ?? 'forwarded'` resolves `none` like `forwarded`; the wrapped token is never revealed                              | —                                                                                                         |

### 0.3 Tests (as built)

One file, through the highest seam (`createProvider` → `callTool` → real materializer → injected `fetchImpl`), instead of the three per-file tests first planned: it covers the same behaviors once, end to end.

| `src/core/__tests__/credential-less-provider.test.ts`                                | Asserts                                                                                                  |
| :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| `sends its requests untouched — no auth header, no credential in the URL`            | URL is the handler's; header keys are exactly `accept` (added by the transport) + the handler's own      |
| `never reveals whatever arrived in the credential slot`                              | a spied `SecretString.reveal` is never called; the stray token appears nowhere in the request            |
| `passes provider conformance`                                                        | `runProviderConformance` green for a `none` provider                                                     |
| `is published in the catalog as { type: none } — no fields, no secret, context only` | `buildCatalog` entry `authDescriptor` equals `{ type: 'none' }`; `contextSchema` carries the routing key |

### 0.4 Definition of Done (phase 0)

- [x] `npm run typecheck` clean (2026-10-14)
- [x] `npm test` green: 41 files, 549 tests, incl. every provider's conformance (2026-10-14)
- [x] `npm run format:check` clean (2026-10-14)
- [ ] PR opened as Sarasaenz12, reviewed and merged to `dev` by Mateo

### 0.5 Build log

| Slice                                                                   | Red                                                     | Green                       | Note                                                                                                                                                                                                                                                                                                                     |
| :---------------------------------------------------------------------- | :------------------------------------------------------ | :-------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0.1 — `none` provider sends unauthenticated requests and never reveals | `assertNever` threw in `materialize` ("Unhandled case") | union member + early return | First green attempt failed one assertion: the transport adds `accept: application/json`; the test now asserts "nothing auth-shaped" instead of an exact header set. `tsc` then flagged `mcp-server.ts:85` (`credentialDelivery` absent on `none`), fixed with `credentialDelivery?: never` rather than a protocol change |
| S0.2 — conformance + catalog                                            | `assertNever` threw in `assertAuthDescriptorShape`      | `case 'none'`               | One red was the test's own fixture (tool name did not match the `mcp_{slug}_` prefix); fixed in the test                                                                                                                                                                                                                 |

---

## Phase 1 — `profitroom` provider

**Branch**: the same `feat/implementation-profitroom-provider`, on top of phase 0. The raw 2026-10-14 responses are captured (uncommitted) under `src/providers/profitroom/__fixtures__/`; S1 commits them. If they are lost, recapture with the same queries (contract §D).

### 1.1 Target tree (as built 2026-10-14)

```
src/providers/profitroom/
  index.ts                 NEW   re-exports profitroomProvider
  manifest.ts              NEW   SLUG, manifest (no logoUrl yet — §1.6)
  auth.ts                  NEW   { type: 'none' }
  context.ts               NEW   contextSchema + URL parsing
  schemas.ts               NEW   zod wire schemas (exported; shared with the drift probe)
  client.ts                NEW   fixed-base GET + validation + error remap + cache
  mappers.ts               NEW   wire → projections (Hotel, Room, Offer), original names
  stay.ts                  NEW   shared pipeline for check_availability / get_stay_prices
  booking-url.ts           NEW   §A.8 link builder
  tools.ts                 NEW   6 tool definitions
  provider.ts              NEW   createProvider wiring + DI
  __fixtures__/*.json      NEW   9 raw engine responses (2026-10-14)
  __tests__/profitroom.test.ts   NEW
src/providers/index.ts     MODIFIED  +1 import, +1 list entry
scripts/profitroom-drift.ts                     NEW
scripts/__tests__/profitroom-drift.test.ts      NEW
.github/workflows/profitroom-drift.yml          NEW
docs/onboarding.md         MODIFIED  `profitroom` listed as the credential-less reference
```

> `.github/workflows/` and `scripts/` sit outside the provider footprint listed in `CLAUDE.md`. Call it out in the PR body: both are Profitroom-only and touch no shared code. No `assets/profitroom.svg` yet (§1.6).

### 1.2 Per-file changes (as built)

| File                                     | Symbol                                                                                                                                                                                                        | Intent                                                                                                                                                                                                                                                                                                    | Seam                                                                                          |
| :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| `manifest.ts`                            | `SLUG = 'profitroom'`, `profitroomManifest`                                                                                                                                                                   | `category: 'hospitality'`, `schemaVersion: '2026-10-14'`, `providerVersion: '0.1.0'`; no `logoUrl` until an approved asset exists                                                                                                                                                                         | Catalog                                                                                       |
| `auth.ts`                                | `profitroomAuth`                                                                                                                                                                                              | `{ type: 'none' } as const satisfies ProviderAuthDescriptor`                                                                                                                                                                                                                                              | Phase 0                                                                                       |
| `context.ts`                             | `profitroomContext`                                                                                                                                                                                           | `{ bookingEngineUrl }` with a refine (not a transform, so the published schema stays a string)                                                                                                                                                                                                            | `provider-factory.ts:87` validates before every handler                                       |
| `context.ts`                             | `hotelKeyFrom(url: string): string`                                                                                                                                                                           | Extract the hotel key from an already-validated URL (https, exact host, no port/userinfo, `/{xx}/{key}`)                                                                                                                                                                                                  | SSRF guard                                                                                    |
| `schemas.ts`                             | `detailsSchema`, `roomsSchema`, `offersSchema`, `profileSchema`, `calendarSchema`, `availabilitySchema`                                                                                                       | Only the fields contract §A lists; zod's default strip means an added upstream field never fails                                                                                                                                                                                                          | Client + drift probe                                                                          |
| `client.ts`                              | `createProfitroomClient(opts?: { now?: () => number }): ProfitroomClient`                                                                                                                                     | Closure over a `Map` cache (15 min, `details`/`rooms`/`offers`, keyed by hotel + request URL; failures not cached)                                                                                                                                                                                        | Tools                                                                                         |
| `client.ts`                              | `ProfitroomClient.get(request, hotelKey, resource, schema, opts?: { query? }): Promise<ClientResult<T>>`                                                                                                      | Fixed base + `X-Requested-With`; remap (status 0 → UNAVAILABLE "did not answer", 401/403 → UNAVAILABLE, 404 `auth.site_not_found` → INVALID_INPUT); schema miss → `PROVIDER_ERROR` naming endpoint and path                                                                                               | `ToolHandlerContext.request` (`src/core/tool.ts:33`), `RequestResult` (`src/core/http.ts:18`) |
| `client.ts`                              | `ProfitroomClient.invalidate(hotelKey: string): void`                                                                                                                                                         | Drop a hotel's cached resources                                                                                                                                                                                                                                                                           | `stay.ts` refresh-once                                                                        |
| `mappers.ts`                             | `translated(translations, locale, defaultLocale)`, `resolveLocale(details, requested?)`, `toHotel(details, locale, hotelKey)`, `toRoom(room, locale, defaultLocale)`, `toOffer(offer, locale, defaultLocale)` | Projection only (ADR 0009): flatten one locale (fallback `defaultLocale`, then first), keep original names and values; unknown locale → INVALID_INPUT. The calendar needs no mapper: its parsed response IS the projection                                                                                | Contract §C.3                                                                                 |
| `stay.ts`                                | `runStay(client, scope: StayScope, stay: StayRequest, withPrices: boolean): Promise<ToolOutcome>`                                                                                                             | `checkIn` ≥ today in `details.timeZone`; child ages vs `personTypes` C; `availability`; re-split or echo mismatch → `available: false, reason`; `resolveCatalog` (refresh once on unknown IDs, then `PROVIDER_ERROR`); with prices: currency/amount guard, verbatim price fields, `taxMode`, `bookingUrl` | Contract §C.4                                                                                 |
| `booking-url.ts`                         | `buildBookingUrl(args: { locale; hotelKey; checkIn; checkOut; adults; childrenAges; currency; RoomID; details }): string`                                                                                     | `/pricelist/rooms/{RoomID}?…` (§A.8); children by the hotel's picker                                                                                                                                                                                                                                      | `get_stay_prices`                                                                             |
| `tools.ts`                               | `buildProfitroomTools(client, now): ReadonlyArray<ToolDefinition<any, ProfitroomContext>>`                                                                                                                    | Five menu tools (`readOnly`, `audience: 'customer'`) + `get_stay_prices` (`controlPlane`); `stayInput` refines `checkOut` ≥ `checkIn` + 1; calendar range ≤ 60 days; real calendar dates only                                                                                                             | `src/providers/erbon/tools.ts:65` pattern                                                     |
| `provider.ts`                            | `createProfitroomProvider(deps?: { fetchImpl?; now? }): IProvider`, `profitroomProvider`                                                                                                                      | One clock for cache and "today"                                                                                                                                                                                                                                                                           | Registry                                                                                      |
| `src/providers/index.ts`                 | `PROVIDERS`                                                                                                                                                                                                   | `+ profitroomProvider`                                                                                                                                                                                                                                                                                    | Only registration touchpoint                                                                  |
| `scripts/profitroom-drift.ts`            | `runDriftProbe(opts?: { fetchImpl?; today? }): Promise<DriftReport>`, `main()`                                                                                                                                | 5 live endpoints of `hotellapausa` (+30 days) parsed with `schemas.ts`; exit 1 on drift or non-200                                                                                                                                                                                                        | Shares `schemas.ts`                                                                           |
| `.github/workflows/profitroom-drift.yml` | job `drift`                                                                                                                                                                                                   | Daily cron + `workflow_dispatch`; on failure create-or-comment an issue labeled `profitroom-drift`                                                                                                                                                                                                        | GitHub Actions                                                                                |

### 1.3 Vertical slices

| #   | Slice                                                          | Band        | Owns (writes)                                                             | Needs          | Done when                                                                                                                                                                                                                     |
| :-- | :------------------------------------------------------------- | :---------- | :------------------------------------------------------------------------ | :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Foundation: manifest, auth, context, schemas                   | foundation  | `manifest.ts`, `auth.ts`, `context.ts`, `schemas.ts`                      | phase 0 merged | URL rule tests (accept/reject table §B) green; every fixture parses with its schema                                                                                                                                           |
| S2  | Client: fixed base, header, remap, validation, cache           | foundation  | `client.ts`                                                               | S1             | Tests: header present; base never derived from input; 401/403/404/422/429/5xx mapping; schema miss → `PROVIDER_ERROR` with path; cache hit within TTL, miss after (fake `now`)                                                |
| S3  | Static tools: `get_hotel`, `list_room_types`, `list_rates`     | independent | `mappers.ts` (static mappers), `tools.ts` (3 entries)                     | S2             | Fixture tests match contract §C.3 shapes; `locale=en` returns English names; unknown locale → `INVALID_INPUT`                                                                                                                 |
| S4  | `get_availability_calendar`                                    | independent | `tools.ts` (1 entry), `mappers.ts` (`toCalendar`)                         | S2             | > 60 days / `to < from` → `INVALID_INPUT`; fixture projects to `Calendar` with original keys                                                                                                                                  |
| S5  | Stay pipeline: `check_availability` + `get_stay_prices` + link | independent | `stay.ts`, `booking-url.ts`, `tools.ts` (2 entries)                       | S2, S3 mappers | Every §C.4 row has a test (`availability-dropped-child.json` → `party_does_not_fit_one_room`; child age 7 → `INVALID_INPUT`; unknown ID refresh); `check_availability` output has **no** money field; link matches §D exactly |
| S6  | Integration                                                    | integration | `provider.ts`, `index.ts`, `src/providers/index.ts`, `docs/onboarding.md` | S3–S5          | `runProviderConformance(profitroomProvider)` green; `tools/list` lacks `get_stay_prices`, `routableToolNames()` has it; audience-coverage test green                                                                          |
| S7  | Drift probe + workflow                                         | independent | `scripts/profitroom-drift.ts`, `.github/workflows/profitroom-drift.yml`   | S1             | `npx tsx scripts/profitroom-drift.ts` exits 0 live; the workflow runs green via `workflow_dispatch` after merge                                                                                                               |

`tools.ts` is written by S3, S4 and S5, so those slices run **sequentially** on it (or each slice adds a builder function that S6 concatenates; either way, no parallel writes).

### 1.4 Delegation map

- **Orchestrator, sequential:** S1 → S2 (foundation), then S3 → S4 → S5 (shared `tools.ts`/`mappers.ts`), then S6.
- **Parallel subagent (optional):** S7 only. It depends on S1 alone and owns two files nobody else touches. Brief: the contract §E, `schemas.ts`, this plan; goal "daily live parse of the five endpoints with the shared schemas"; DoD as in the S7 row.
- **Recommendation:** build solo. It is about 14 files and only one slice is independent, which is under the fan-out threshold (> 4 independent slices).
- **Sub-issues (Step 6b):** not triggered. No real parallelism and a reviewable diff, so it stays 1:1:1.

### 1.5 Test strategy

- All unit tests run on the captured fixtures through an injected `fetchImpl` (no network in CI), like `src/providers/erbon/__tests__/erbon.test.ts`.
- A fixed "today" (`now`) before 2026-10-23 so the fixture dates stay valid forever.
- `mcp-contract-qa` / `scripts/contract-probe.mjs` against a local server with metadata `{ bookingEngineUrl: 'https://booking.profitroom.com/es/hotellapausa' }`, live, once before the PR.

### 1.6 Open items to close during the build

| Item                                   | Action                                                                                                                |
| :------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| Logo for `assets/profitroom.svg`       | Ask Mateo for an approved asset; ship without `logoUrl` if none (it is optional)                                      |
| ~~`room-id`/`offer-id` pre-selection~~ | Resolved during the build: they pre-select nothing; the link uses `/pricelist/rooms/{RoomID}` instead (contract §A.8) |
| `r1_children_age` (new picker)         | Leave as Inferred; La Pausa uses the old picker                                                                       |
| Rate-limit window                      | Note `X-RateLimit-*` across the build; record in the contract                                                         |

### 1.7 Definition of Done (phase 1)

- [x] S1–S7 done-when checks green (2026-10-14)
- [x] `npm run typecheck` clean
- [x] `npm test` green: 43 files, 617 tests
- [x] `npm run format:check` clean
- [x] `npm audit` unchanged — no dependency added
- [x] Live contract probe (`scripts/contract-probe.mjs --live`, 2026-11-13 → 15, 2 adults): `server/discover` shows `auth none · 5 tools · context required`; `check_availability` returned four room types with no money; `get_stay_prices` returned COP 1,710,000 for the Cabaña Doble con Jacuzzi y Muelle, `taxesIncluded: false`, and a working link
- [x] `npx tsx scripts/profitroom-drift.ts` live: 5/5 `ok`
- [ ] The drift workflow green via `workflow_dispatch` (only possible once the file is on GitHub)
- [ ] PR to `dev` as Sarasaenz12; body flags the `.github/` and `scripts/` files and links #142, #1598, #1599

### 1.8 Build log

Each slice was built test-first through its highest seam: the context schema, `client.get` with the core's `request` faked, and otherwise `createProfitroomProvider().callTool` over a fake engine answering from the live fixtures.

| Slice                  | Commit    | Red → green                                                                                    | What the build taught us                                                                                                                                                                                                                     |
| :--------------------- | :-------- | :--------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —                      | `ecf4594` | (docs)                                                                                         | Before any code: the first contract renamed upstream fields (`RoomID` → `roomTypeId`, `elastic` → `flexible`), which ADR 0009 forbids. Outputs now keep Profitroom's names; joins nest `room`/`offer`/`profile`                              |
| S1 context + schemas   | `4c6bb8e` | Missing module → 13 URL cases; schema test failed on the live `rooms` fixture                  | `maxOccupancy.extraBeds` is `null` on 2 of 6 La Pausa rooms — recorded in the contract                                                                                                                                                       |
| S2 client              | `088e384` | Each behavior red first: drift → `PROVIDER_ERROR` with path; 401/403/404 remaps; then status 0 | The core reports a timeout as status 0; without a branch the message read "HTTP 0"                                                                                                                                                           |
| S3 static tools        | `bc2da65` | `get_hotel`, `list_room_types`, `list_rates`, `status=1` each red then green                   | One rate only has a Spanish translation: an English call falls back to the hotel language                                                                                                                                                    |
| S4 calendar            | `db82fc3` | Tracer red → green                                                                             | The three range guards passed at first run (written with the tracer) — not seen red                                                                                                                                                          |
| S5a check_availability | `25003bc` | Tracer; unknown-room refresh; party checks; dates                                              | `let` + closures lost TS narrowing → refactored into `resolveCatalog`. "Today" must be the hotel's (Bogotá), not UTC                                                                                                                         |
| S5b get_stay_prices    | `617642e` | controlPlane + priced proposal red → green                                                     | The children link and the currency/zero-price guards passed at first run (covered by the same implementation) — not seen red                                                                                                                 |
| S6 integration         | `b587098` | Registry test red → one line                                                                   | —                                                                                                                                                                                                                                            |
| S7 drift probe         | `eefc889` | Missing module → 4 tests green; live run 5/5                                                   | —                                                                                                                                                                                                                                            |
| Link fix               | `f32230b` | Two link expectations red → path form                                                          | With four room types open on 2026-11-13, `room-id`/`offer-id` pre-selected nothing; `/pricelist/rooms/{RoomID}` opens the room with its rates and "book now". The unused `lang` client option was removed: responses carry every translation |

### 1.9 Connect support for the consumer (backend #1599 phase 0, 2026-10-15)

Found while designing xcale-backend #1599: the consumer's generic credential connect registers a provider only when it publishes a `connectionProbe`, and keys the account on every required context key unless told otherwise. Built test-first on this branch:

| Cycle                                            | Red                                                                                              | Green                                                                                                                                                                            |
| :----------------------------------------------- | :----------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest publishes probe, discovery and identity | test on `manifest` failed                                                                        | `connectionProbe`, `contextDiscovery`, `accountContextKeys: ['hotelKey']`; schema `2026-10-15`, provider `0.2.0`                                                                 |
| Foreign URL still refused                        | the existing S3 test went red: as discovery tool, `get_hotel` lost the core's context validation | `get_hotel` parses `bookingEngineUrlContext` itself                                                                                                                              |
| `hotelKey` discovered from the URL alone         | new test red                                                                                     | `toHotel` returns `hotelKey`                                                                                                                                                     |
| Other tools require a matching `hotelKey`        | new test red                                                                                     | `profitroomContext` gains `hotelKey` + a refine that it matches the URL; the four S1 URL-rule tests moved to `bookingEngineUrlContext` (they test the URL, not the full context) |

- [x] `npm run typecheck`, `npm test` (43 files, 620 tests), `npm run format:check` green
- [x] Catalog entry: `auth none`, `connectionProbe`, `contextDiscovery`, `accountContextKeys: ['hotelKey']`, context required `bookingEngineUrl` + `hotelKey`
- [x] Live: `get_hotel` with the English URL plus extra path → `hotelKey: "hotellapausa"`
