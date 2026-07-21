# Work Log — PR B: Cloudbeds provider (the pilot)

- **Branch:** `feat/cloudbeds-provider` · **Feature design:** `docs/design/cloudbeds-pilot/feature-design.md`
- **Pattern it follows:** `docs/adr/canonical-provider-pattern.md` (built in PR A).
- **The §10 test (live):** this PR must touch **only** `src/providers/cloudbeds/` plus the one
  registry line in `src/providers/index.ts`. No `src/core|protocol|auth` changes, no consumer code.

---

## Plan (what will be done)

Build the Cloudbeds adapter entirely with the canonical helpers (`createProvider`, `toolFactory`,
`defineTool`, `definePaginatedList`, `requestJson`, `buildPage`):

1. `manifest.ts` — slug `cloudbeds`, `hospitality`, `schemaVersion`, `providerVersion`.
2. `auth.ts` — `oauth2` `ProviderAuthDescriptor` (authorize/token URLs, read scopes, bearer, refresh).
3. `context.ts` — `CloudbedsContext` + `metadataSchema = z.object({ propertyID })` (Explicit Context).
4. `client.ts` — thin Cloudbeds API v1.2 client over `requestJson` (base URL, query params,
   form/JSON, token at egress). Injectable `fetchImpl` for tests. Returns provider data verbatim.
5. `tools.ts` — curated **read-first** tools: `list_reservations` (paginated), `get_reservation`,
   `get_guest`, `get_availability`, `list_room_types`, `get_hotel_details`. Fidelity: `data` = the
   provider's payload.
6. `provider.ts` — `createCloudbedsProvider(deps?)` factory → `createProvider({...})`; default instance.
7. `index.ts` + register the one line in `src/providers/index.ts`.
8. `__fixtures__/` (anonymized) + `__tests__/` — conformance + behavior (success, pagination, 401 →
   `AUTH_EXPIRED`, invalid args → `INVALID_INPUT`, missing `propertyID` → `INVALID_INPUT`), all with
   an injected transport (no network).
9. Update the feature design (mark resolved grill decisions) + this work-log Outcome.

**Out of scope (PR B):** write/mutating tools (R-1 gate); the backend MCP client runtime + Rail A
generic OAuth + frontend (separate repos/PRs); real secrets (the server is stateless — Cloudbeds
`clientId/secret` live in the **backend's** Doppler when that side is built).

**Quality gate:** `tsc` clean · tests green · `format:check` · `npm audit` 0 · CI guard · §10 held.

---

## Outcome (what was actually done)

**Verification:** `tsc` clean · **52/52 tests** · `format:check` clean · CI guard OK · `npm audit` 0.

### 🎯 §10 result — PASS (the architecture held in practice)

Adding Cloudbeds touched **only** `src/providers/cloudbeds/**` **+ one line** in
`src/providers/index.ts`. **Zero** changes to `src/core`, `src/protocol`, `src/auth`, or any
consumer. No `switch`/`if`/special-casing in shared infra. This is the strongest evidence that the
pattern works: the second real provider was a thin, isolated adapter.

### Done

- `manifest.ts`, `auth.ts` (oauth2 descriptor + read scopes), `context.ts` (`propertyID`).
- `client.ts` — Cloudbeds v1.2 over `requestJson` (query params, token at egress, injectable `fetchImpl`).
- `tools.ts` — 6 curated read-first tools: `list_reservations` (via `definePaginatedList`),
  `get_reservation`, `get_guest`, `get_availability`, `list_room_types`, `get_hotel_details`.
  `unwrap()` handles the Cloudbeds `{ success, data }` envelope; **`data` returned verbatim** (fidelity).
- `provider.ts` — `createCloudbedsProvider(deps?)` factory (DI) + default instance.
- `__fixtures__/` (anonymized) + `__tests__/` — conformance + 6 behaviors (pagination envelope, single
  fidelity, 401→`AUTH_EXPIRED`, invalid args→`INVALID_INPUT`, missing `propertyID`→`INVALID_INPUT`,
  oauth2+`contextSchema` published), all via injected transport (no network).
- One registry line in `src/providers/index.ts`.

### Decisions taken during implementation

1. **6 read-first tools; only `list_reservations` paginated.** Small lists (room types) and single
   gets return provider `data` verbatim — pagination only where the dataset is genuinely large.
2. **`unwrap()`** centralizes the Cloudbeds `{success,data}` envelope handling (incl. HTTP-200
   `success:false` → `PROVIDER_ERROR`); it never reshapes entities (fidelity).
3. **Typed metadata**: single-get tools use `toolFactory<CloudbedsContext>()` (typed `ctx.metadata`);
   `definePaginatedList` casts `ctx.metadata` once (its `M` defaults `unknown`) — sound because the
   dispatcher validates it against `metadataSchema` first.
4. **No secrets in this repo** — the server is stateless; Cloudbeds `clientId/secret` belong in the
   **backend's** Doppler when the consumer side is built.

### Open / to confirm before go-live

- **OAuth scope strings + per-endpoint param names** — pagination is now mapped to Cloudbeds'
  `pageNumber`/`resultsPerPage` (fixed in `fix/cloudbeds-review`; a test asserts the translation).
  Exact scope strings + the single-get params (`reservationID`, `guestID`, availability dates) still
  to verify against a live sandbox.
- **Sandbox smoke test** (opt-in, env-gated, outside CI) — add when a Cloudbeds sandbox
  property/token is available.
- **R-1**: confirmed **standard-risk** for read-first; reevaluate the credential model before any
  write/high-impact tool.
- **Consumer side (separate PRs/repos):** backend MCP client runtime (Rail E KD-1) + Rail A generic
  OAuth from the discovered descriptor + frontend connect/usage. The acceptance gate stands: the full
  OAuth lifecycle must work with **zero Cloudbeds-specific code in xcale-backend**.

## Post-merge review (`fix/cloudbeds-review`)

An exhaustive review before consuming Cloudbeds from the backend/frontend:

- **Static:** `tsc` clean · 53 tests · `format:check` · CI guard · `npm audit` 0.
- **Live smoke:** the server boots; `GET /health` → ok; `GET /discover` requires Hop-B (401 without)
  and lists `cloudbeds` with `oauth2` + `supportsRefresh` + `toolCount: 6` + `contextSchema:[propertyID]`.
  The MCP `tools/list` exposes `mcp_cloudbeds_*` through the protocol (integration test asserts it).
- **Findings fixed:** (1) **pagination param** — was sending `pageSize`; Cloudbeds expects
  `resultsPerPage` → fixed + a test now captures the request URL and asserts
  `pageNumber`/`resultsPerPage`/`propertyID`. (2) **`add-provider` template** error-message example
  interpolated `res.body` (could echo provider data) → changed to status/code only. (3) Added the
  protocol-level `tools/list` assertion for a Cloudbeds tool.
- **No tech debt carried:** the one contained `any` (heterogeneous tool collection) is documented;
  `exactOptionalPropertyTypes` off is a tracked ADR; bearer-only `requestJson` and the
  `definePaginatedList` ergonomics are explicit, reviewed choices — not loose ends.
