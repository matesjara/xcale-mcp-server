# Profitroom Read-Only Provider — Implementation Plan

> **Upstream**: [feature-design.md](feature-design.md) · [api-contract.md](api-contract.md) · ADR [credential-less-provider-auth](../../adr/0022-credential-less-provider-auth.md)
> **Issue**: matesjara/xcale-mcp-server#142 · **Status**: Planned · **Last updated**: 2026-10-14
> **Language note**: English per this repo's `CLAUDE.md` (design docs are durable).

## Meta-description

Two phases, **two PRs** to `dev`. **Phase 0** adds the `none` auth variant to the core: one union member, one early return in the materializer, one conformance case, plus tests. It ships alone because it reaches `src/core`, which the autonomous pipeline escalates and Mateo reviews on its own. **Phase 1** builds `src/providers/profitroom/` on top of it. That means a fixed-base, header-only client with a 15-minute in-memory cache for static resources and zod validation of every response (fail closed), five money-free menu tools, a `controlPlane` `get_stay_prices`, the booking-link builder, a one-line registration, and a daily drift workflow that reuses the provider's own zod schemas.

Done means: `tools/list` shows the five menu tools and not `get_stay_prices`. A `tools/call` against live `hotellapausa` returns real rooms, rates, calendar and options (`mcp-contract-qa`). Every fail-closed rule in contract §C.4 has a fixture test. The drift workflow runs green on `workflow_dispatch`.

> **Why two PRs, not one.** The skill's default is one PR per plan. Here the repo rule wins: Provider Self-Containment forbids `src/core` in a provider PR, and ADR 0017 makes the pipeline escalate anything that reaches `src/core|protocol|auth`. Phase 1 branches from `dev` **after** phase 0 merges.

> **Detail does not taper.** Both phases touch code that exists today, so both are specified per file.

---

## Phase 0 — `none` auth variant (core)

**Branch**: the current `docs/142-profitroom-provider-design` (already carries the ADR, `CONTEXT.md` terms and these design docs). PR title: `feat(core): credential-less providers — the none auth variant`.

### 0.1 Target tree

```
src/core/
  provider-port.ts                         MODIFIED
  auth/authentication-materializer.ts      MODIFIED
  auth/__tests__/authentication-materializer.test.ts   MODIFIED
  testing/provider-conformance.ts          MODIFIED
  __tests__/catalog.test.ts                MODIFIED
docs/adr/0022-credential-less-provider-auth.md  NEW (written)
docs/adr/README.md                         MODIFIED (written)
CONTEXT.md                                 MODIFIED (written)
docs/design/profitroom-read-only-provider/ NEW (written)
```

### 0.2 Per-file changes

| File                                              | Symbol                                           | Change    | Intent                                                                                                                                                                                               | Seam                                                                                                      |
| :------------------------------------------------ | :----------------------------------------------- | :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `src/core/provider-port.ts:16`                    | `ProviderAuthDescriptor`                         | MODIFIED  | Add union member `{ readonly type: 'none' }`: no `fields`, no `credentialDelivery`                                                                                                                   | Every `switch (auth.type)` becomes a compile error until handled                                          |
| `src/core/auth/authentication-materializer.ts:18` | `materialize(auth, resolved, spec): HttpRequest` | MODIFIED  | Return the plain request when `auth.type === 'none'`, **before** the reveal at `:25`. Add `case 'none'` to the switch at `:27` (unreachable, keeps `assertNever` exhaustive). Update the doc comment | Single reveal statement unchanged; CI grep is per file (`docs/security/credential-boundary-review.md:75`) |
| `src/core/testing/provider-conformance.ts:16`     | `assertAuthDescriptorShape(auth, label): void`   | MODIFIED  | `case 'none'`: nothing to assert beyond the existing JSON round-trip                                                                                                                                 | Conformance for every provider                                                                            |
| `src/protocol/mcp-server.ts:85`                   | —                                                | UNCHANGED | `credentialDelivery ?? 'forwarded'` already covers `none` (no field); the empty-token wrap from `src/auth/token.ts:9` is never revealed                                                              | —                                                                                                         |

### 0.3 Tests

| File                                                          | Test                                                  | Asserts                                                                                                                  |
| :------------------------------------------------------------ | :---------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `src/core/auth/__tests__/authentication-materializer.test.ts` | `none: sends the request untouched and never reveals` | headers and URL equal the spec; a `SecretString` whose `reveal` is spied is never called                                 |
| `src/core/__tests__/catalog.test.ts`                          | `publishes a none descriptor verbatim`                | a test provider with `auth: { type: 'none' }` appears in `buildCatalog` as `{ type: 'none' }` and passes the secret scan |
| conformance                                                   | via an inline test provider                           | `runProviderConformance` passes for a `none` provider                                                                    |

### 0.4 Definition of Done (phase 0)

- [ ] `npm run typecheck` clean
- [ ] `npm test` green (new tests + all existing providers' conformance)
- [ ] `npm run format:check` clean
- [ ] PR opened as Sarasaenz12, reviewed and merged to `dev` by Mateo

---

## Phase 1 — `profitroom` provider

**Branch**: `feat/142-profitroom-provider` from `dev` after phase 0 merges. The raw 2026-10-14 responses are captured (uncommitted) in the design worktree under `src/providers/profitroom/__fixtures__/`; S1 commits them. If they are lost, recapture with the same queries (contract §D).

### 1.1 Target tree

```
src/providers/profitroom/
  index.ts                 NEW   re-exports profitroomProvider
  manifest.ts              NEW   SLUG, manifest
  auth.ts                  NEW   { type: 'none' }
  context.ts               NEW   contextSchema + URL parsing
  schemas.ts               NEW   zod wire schemas (exported; shared with the drift probe)
  client.ts                NEW   fixed-base GET + validation + error remap + cache
  mappers.ts               NEW   wire → contract types (HotelInfo, RoomType, Rate, RateTerms, CalendarDay)
  stay.ts                  NEW   shared quote pipeline for check_availability / get_stay_prices
  booking-url.ts           NEW   §A.8 link builder
  tools.ts                 NEW   6 tool definitions
  provider.ts              NEW   createProvider wiring + DI
  __fixtures__/*.json      NEW   (captured)
  __tests__/profitroom.test.ts   NEW
src/providers/index.ts     MODIFIED  +1 import, +1 list entry
assets/profitroom.svg      NEW   (logo — source to confirm, see §1.6)
scripts/profitroom-drift.ts               NEW
.github/workflows/profitroom-drift.yml    NEW
docs/onboarding.md         MODIFIED  add `profitroom` (credential-less) to the provider list at :44
```

> `.github/workflows/` and `scripts/` sit outside the provider footprint listed in `CLAUDE.md`. Call it out in the PR body: both files are Profitroom-only and touch no shared code.

### 1.2 Per-file changes

| File                                     | Symbol                                                                                                                                                                                             | Change   | Intent                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Seam                                                    |
| :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------- |
| `manifest.ts`                            | `SLUG = 'profitroom'`, `profitroomManifest: ProviderManifest`                                                                                                                                      | NEW      | `category: 'hospitality'`, `logoUrl: /assets/profitroom.svg`, `schemaVersion: '2026-10-14'`, `providerVersion: '0.1.0'`; mirrors `src/providers/erbon/manifest.ts`                                                                                                                                                                                                                                                                                                | Catalog                                                 |
| `auth.ts`                                | `profitroomAuth`                                                                                                                                                                                   | NEW      | `{ type: 'none' } as const satisfies ProviderAuthDescriptor`                                                                                                                                                                                                                                                                                                                                                                                                      | Phase 0                                                 |
| `context.ts`                             | `profitroomContext: z.ZodObject`                                                                                                                                                                   | NEW      | `{ bookingEngineUrl }` with `.refine(isProfitroomEngineUrl)` (no transform, so the published schema stays a string)                                                                                                                                                                                                                                                                                                                                               | `provider-factory.ts:87` validates before every handler |
| `context.ts`                             | `isProfitroomEngineUrl(url: string): boolean`                                                                                                                                                      | NEW      | Contract §B rules: https, exact host, `/{locale}/{hotelKey}`                                                                                                                                                                                                                                                                                                                                                                                                      | SSRF guard                                              |
| `context.ts`                             | `hotelKeyFrom(url: string): string`                                                                                                                                                                | NEW      | Extract `hotelKey`; only called after the refine passed                                                                                                                                                                                                                                                                                                                                                                                                           | Client                                                  |
| `schemas.ts`                             | `detailsSchema`, `roomsSchema`, `offersSchema`, `calendarSchema`, `availabilitySchema`                                                                                                             | NEW      | Only the fields contract §A.2–A.6 lists, `.passthrough()` on objects so new upstream fields never fail                                                                                                                                                                                                                                                                                                                                                            | Client + drift probe                                    |
| `client.ts`                              | `createProfitroomClient(opts?: { baseUrl?: string; now?: () => number; ttlMs?: number }): ProfitroomClient`                                                                                        | NEW      | Closure over a `Map` cache; `baseUrl` defaults to `https://booking.profitroom.com/api/` (tests only)                                                                                                                                                                                                                                                                                                                                                              | Tools                                                   |
| `client.ts`                              | `ProfitroomClient.get<T>(request, hotelKey, resource, query, schema, opts?: { cache?: boolean; locale?: string }): Promise<ClientResult<T>>`                                                       | NEW      | Build URL from the fixed base, always add `X-Requested-With`, call `ctx.request`, remap errors (contract §C.5: 401/403 → `PROVIDER_UNAVAILABLE`, 404 `auth.site_not_found` → `PROVIDER_INVALID_INPUT`), `safeParse` → `PROVIDER_ERROR` naming endpoint and path. Cache key `hotelKey                                                                                                                                                                              | resource                                                | locale`, TTL 15 min | `ToolHandlerContext.request` (`src/core/tool.ts:33`), `RequestResult` (`src/core/http.ts:18`) |
| `client.ts`                              | `ProfitroomClient.invalidate(hotelKey: string): void`                                                                                                                                              | NEW      | Drop static entries; used by the unknown-ID refresh                                                                                                                                                                                                                                                                                                                                                                                                               | `stay.ts`                                               |
| `mappers.ts`                             | `toHotelInfo(details, locale, bookingEngineUrl): HotelInfo`, `toRoomType(room, locale): RoomType`, `toRate(offer, locale): Rate`, `toTerms(profile): RateTerms`, `toCalendarDay(day): CalendarDay` | NEW      | Pick the translation for `locale` (fallback `defaultLocale`, then first), strip HTML, map `elastic` → `flexible` keeping `rawKind`, never interpret `mealPlanType`                                                                                                                                                                                                                                                                                                | Contract §C.3                                           |
| `mappers.ts`                             | `resolveLocale(details, requested?: string): Result<string>`                                                                                                                                       | NEW      | Live locales only; unknown → `PROVIDER_INVALID_INPUT`                                                                                                                                                                                                                                                                                                                                                                                                             | All tools with `locale`                                 |
| `stay.ts`                                | `runStay(client, ctx, input: StayInput, withPrices: boolean): Promise<ToolOutcome>`                                                                                                                | NEW      | Pipeline: load `details`; validate dates (`checkIn` ≥ today in `details.timeZone`, `checkOut` > `checkIn`) and child ages vs `personTypes` C; call `availability`; >1 group or echo ≠ request → `available: false, reason: 'party_does_not_fit_one_room'`; join with `rooms`/`offers` (missing ID → `invalidate` + reload once → still missing `PROVIDER_ERROR`); check currency and amount; with `withPrices`, add price fields + `taxesIncluded` + `bookingUrl` | Contract §C.4                                           |
| `booking-url.ts`                         | `buildBookingUrl(args: { locale; hotelKey; checkIn; checkOut; adults; childrenAges; currency; roomTypeId; rateId; details }): string`                                                              | NEW      | §A.8; children param chosen by `details.enabledNewChildrenOccupancyPicker` (`r1_child{min}-{max}={count}` vs `r1_children_age`)                                                                                                                                                                                                                                                                                                                                   | `get_stay_prices`                                       |
| `tools.ts`                               | `buildProfitroomTools(client): ReadonlyArray<ToolDefinition<any, ProfitroomContext>>`                                                                                                              | NEW      | Six `tool({...})` entries named `mcp_${SLUG}_*`; five with `readOnly: true, audience: 'customer'`; `get_stay_prices` with `controlPlane: true`. Descriptions say "no prices" on `check_availability`                                                                                                                                                                                                                                                              | `src/providers/erbon/tools.ts:65` pattern               |
| `provider.ts`                            | `createProfitroomProvider(deps?: { fetchImpl?: FetchLike; now?: () => number }): IProvider`, `profitroomProvider`                                                                                  | NEW      | `createProvider({ manifest, auth, metadataSchema: profitroomContext, tools, fetchImpl })`; mirrors `src/providers/toteat/provider.ts:22`                                                                                                                                                                                                                                                                                                                          | Registry                                                |
| `src/providers/index.ts:17`              | `PROVIDERS`                                                                                                                                                                                        | MODIFIED | Add `profitroomProvider`                                                                                                                                                                                                                                                                                                                                                                                                                                          | Only registration touchpoint                            |
| `scripts/profitroom-drift.ts`            | `main(): Promise<void>`                                                                                                                                                                            | NEW      | Fetch the 5 endpoints for `hotellapausa` (+30 days) and `safeParse` with `schemas.ts`; print each result; exit 1 on any failure                                                                                                                                                                                                                                                                                                                                   | Shares `schemas.ts`                                     |
| `.github/workflows/profitroom-drift.yml` | job `drift`                                                                                                                                                                                        | NEW      | `schedule` daily + `workflow_dispatch`; `npx tsx scripts/profitroom-drift.ts`; on failure, `gh issue` create-or-comment with label `profitroom-drift` (`permissions: issues: write`)                                                                                                                                                                                                                                                                              | GitHub Actions                                          |

### 1.3 Vertical slices

| #   | Slice                                                          | Band        | Owns (writes)                                                                                      | Needs          | Done when                                                                                                                                                                                                                     |
| :-- | :------------------------------------------------------------- | :---------- | :------------------------------------------------------------------------------------------------- | :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Foundation: manifest, auth, context, schemas                   | foundation  | `manifest.ts`, `auth.ts`, `context.ts`, `schemas.ts`                                               | phase 0 merged | URL rule tests (accept/reject table §B) green; every fixture parses with its schema                                                                                                                                           |
| S2  | Client: fixed base, header, remap, validation, cache           | foundation  | `client.ts`                                                                                        | S1             | Tests: header present; base never derived from input; 401/403/404/422/429/5xx mapping; schema miss → `PROVIDER_ERROR` with path; cache hit within TTL, miss after (fake `now`)                                                |
| S3  | Static tools: `get_hotel`, `list_room_types`, `list_rates`     | independent | `mappers.ts` (static mappers), `tools.ts` (3 entries)                                              | S2             | Fixture tests match contract §C.3 shapes; `locale=en` returns English names; unknown locale → `INVALID_INPUT`                                                                                                                 |
| S4  | `get_availability_calendar`                                    | independent | `tools.ts` (1 entry), `mappers.ts` (`toCalendarDay`)                                               | S2             | > 60 days / `to < from` → `INVALID_INPUT`; fixture maps to `CalendarDay[]`                                                                                                                                                    |
| S5  | Stay pipeline: `check_availability` + `get_stay_prices` + link | independent | `stay.ts`, `booking-url.ts`, `tools.ts` (2 entries)                                                | S2, S3 mappers | Every §C.4 row has a test (`availability-dropped-child.json` → `party_does_not_fit_one_room`; child age 7 → `INVALID_INPUT`; unknown ID refresh); `check_availability` output has **no** money field; link matches §D exactly |
| S6  | Integration                                                    | integration | `provider.ts`, `index.ts`, `src/providers/index.ts`, `assets/profitroom.svg`, `docs/onboarding.md` | S3–S5          | `runProviderConformance(profitroomProvider)` green; `tools/list` lacks `get_stay_prices`, `routableToolNames()` has it; audience-coverage test green                                                                          |
| S7  | Drift probe + workflow                                         | independent | `scripts/profitroom-drift.ts`, `.github/workflows/profitroom-drift.yml`                            | S1             | `npx tsx scripts/profitroom-drift.ts` exits 0 live; the workflow runs green via `workflow_dispatch` after merge                                                                                                               |

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

| Item                               | Action                                                                           |
| :--------------------------------- | :------------------------------------------------------------------------------- |
| Logo for `assets/profitroom.svg`   | Ask Mateo for an approved asset; ship without `logoUrl` if none (it is optional) |
| `room-id`/`offer-id` pre-selection | Retest on dates with ≥ 2 room types open; record the result in the contract §A.8 |
| `r1_children_age` (new picker)     | Leave as Inferred; La Pausa uses the old picker                                  |
| Rate-limit window                  | Note `X-RateLimit-*` across the build; record in the contract                    |

### 1.7 Definition of Done (phase 1)

- [ ] S1–S7 done-when checks green
- [ ] `npm run typecheck` clean
- [ ] `npm test` green
- [ ] `npm run format:check` clean
- [ ] `npm audit` unchanged (no new dependency)
- [ ] Live contract probe: rooms, rates, calendar, an option and a priced option for `hotellapausa`
- [ ] PR to `dev` as Sarasaenz12; body flags the `.github/` and `scripts/` files and links #142, #1598, #1599
