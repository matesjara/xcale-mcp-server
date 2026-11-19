# Restofy Provider — Implementation Plan

> **Implements**: [feature-design.md](feature-design.md) · [api-contract.md](api-contract.md)
> **Issues**: epic matesjara/xcale-backend#2933 · adapter #2935 · the provider's own issue in this repo (to open with the PR) · **Branch**: `feat/restofy-provider` (one branch, one PR to `dev`)
> **Last updated**: 2026-11-18

## Meta-description

This plan adds `src/providers/restofy/`, a thin adapter over Restofy's API. It follows Avirato's shape (`credential_exchange` + `reference` with a dotted token path and a declared TTL, control-plane writes) and borrows WooCommerce's and Cloudbeds' identity policies for orders, reservations and the record lookup by phone.

The provider publishes the **16 tools of the contract** (§C):

- 13 on the agent's menu, every one `audience: 'customer'`: the business profile, channels, menu, quote, order status, the two contact tools and six reservation tools;
- 3 control plane: `create_order`, `find_order_by_reference`, `list_reservations`.

It reaches nothing outside its footprint (its folder, one registry line, its logo). **No core change**: every mechanism it uses exists on `dev`.

**Done** means:

- `server/discover` lists `restofy` with its `authDescriptor` and no `contextSchema`;
- `tools/list` returns the 13 menu tools, each with `audience` and, where the contract says so, `_meta` identity policy;
- the conformance suite, the audience-coverage test, the redaction test and every tool's fixture test are green;
- `npm run typecheck`, `npm run format:check` and `npm test` are clean;
- `mcp-contract-qa` against the test restaurant is green.

**Out of this plan:** payment, deposits, reservation changes, the backend's consumer (Phase 2, its own issue).

## Reality check — what was read

| Seam                  | Anchor                                                                                     | What it tells the build                                                                                                                                                                              |
| :-------------------- | :----------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry              | `src/providers/index.ts:2-13,22-35`                                                        | One import and one entry in `PROVIDERS`                                                                                                                                                              |
| Provider factory      | `src/core/provider-factory.ts:39-51`                                                       | `createProvider({ manifest, auth, tools, fetchImpl? })`; control-plane tools are routable and filtered out of `tools/list`                                                                           |
| Tool definition       | `src/core/tool.ts:40-131`                                                                  | `defineTool`, `ok`/`err`, `identityPolicy`, `audience`, `readOnly: true`, `controlPlane: true`; `ctx.request(spec)`                                                                                  |
| Identity policy       | `src/core/types.ts:9-101`                                                                  | `subject-bound` with `recordOwnershipField`/`Kind`/`recordAction`, record lookups (`recordLookup`, `resultItemsPath`, `resultIdentityFields`, `resultRecordIdField`, `projection`), `subject-scoped` |
| Audience              | `src/core/types.ts:122-135`, `core/__tests__/audience-coverage.test.ts`                    | Mark every published tool or none                                                                                                                                                                    |
| `credential_exchange` | `src/core/provider-port.ts:107-136`                                                        | `bodyFields`, dotted `responseFields.token`, `tokenTtlSeconds`, `tokenPlacement: 'bearer_header'` — all present                                                                                      |
| Request spec          | `src/core/auth/http-request.ts:24-30`                                                      | A provider may set headers (our `Idempotency-Key`); auth is added by materialization                                                                                                                 |
| Transport result      | `src/core/http.ts:18-28`                                                                   | `{ ok, status, data }` or `{ ok: false, status, errorCode, body ≤500 }`. **No response headers.**                                                                                                    |
| Errors                | `src/core/errors.ts:7-12`                                                                  | `PROVIDER_AUTH_EXPIRED`, `RATE_LIMITED`, `UNAVAILABLE`, `INVALID_INPUT`, `PROVIDER_ERROR`                                                                                                            |
| Template              | `src/providers/avirato/` (`auth.ts`, `client.ts`, `errors.ts`, `tools.ts`, `__tests__/`)   | The file set and the tests to mirror                                                                                                                                                                 |
| Identity precedents   | `src/providers/woocommerce/tools.ts:1505-1572`, `src/providers/cloudbeds/tools.ts:393,997` | `get_order` ownership; record lookup by phone                                                                                                                                                        |

## Target file tree

```
src/providers/restofy/
├── manifest.ts          NEW  slug, displayName, category 'restaurant-pos', logo, versions
├── auth.ts              NEW  the credential_exchange descriptor (contract §B)
├── client.ts            NEW  POST-only client, base https://restofy.pro/api, envelope unwrap
├── errors.ts            NEW  RequestResult → ToolOutcome per contract §D, the redaction rule
├── idempotency.ts       NEW  derive the Idempotency-Key and the quote reference (AD-6)
├── order-body.ts        NEW  OrderDraft → Restofy's flat create-order body
├── tools.ts             NEW  the 16 tools
├── provider.ts          NEW  createRestofyProvider(deps?) factory
├── index.ts             NEW  default instance export
├── __fixtures__/        NEW  contract §E
└── __tests__/
    ├── restofy.test.ts          NEW  conformance, catalog entry, every tool against fixtures
    ├── errors.test.ts           NEW  contract §D, the redaction rule
    ├── idempotency.test.ts      NEW  determinism, sensitivity to the body, UUID shape
    ├── order-body.test.ts       NEW  the draft → body mapping
    └── identity-policy.test.ts  NEW  the policies of contract §C, published in _meta
src/providers/index.ts   MODIFIED  +1 import, +1 entry
assets/restofy.svg       NEW  the house tile
```

## Per-file changes

### `manifest.ts` — NEW

`SLUG = 'restofy'`; `restofyManifest: ProviderManifest = { slug, displayName: 'Restofy', category: 'restaurant-pos', logoUrl: '/assets/restofy.svg', schemaVersion: '2026-11-18', providerVersion: '0.1.0' }`. No `connectionProbe` (mint proves the credential), no `contextDiscovery`, no `accountContextKeys`. A doc comment says why, as Avirato's does.

### `auth.ts` — NEW

`export const restofyAuth: ProviderAuthDescriptor` exactly as contract §B. Doc comment: observed facts (7-day JWT, no expiry field, restaurant sealed in the token), why one day.

### `client.ts` — NEW

```ts
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;
export interface RestofyClientDeps {
  readonly baseUrl?: string;
} // default https://restofy.pro/api
export interface RestofyClient {
  call(
    path: string,
    request: AuthedRequest,
    body?: Record<string, unknown>,
    headers?: Readonly<Record<string, string>>,
  ): Promise<RequestResult>; // POST `${base}/${path}`, JSON
}
export function createRestofyClient(deps?: RestofyClientDeps): RestofyClient;
/** `{ success, message, data }` → `{ ok: true, data }` or `{ ok: false, message }`; anything else → malformed. */
export function unwrapEnvelope(result: RequestResult): Unwrapped;
```

One call is one request, never retried. `path` is a fixed `module/action` literal from `tools.ts`, never built from input.

### `errors.ts` — NEW

`export function toOutcome(u: Unwrapped, notFound?: 'found-false'): ToolOutcome` and `safeMessage(raw: string): string | undefined` (≤300 chars, no `{ } http Bearer token= key=`). Status → code per contract §D. Parses the ≤500-char error body as JSON to read `message`; an unparsable body gives the generic message.

### `idempotency.ts` — NEW

```ts
/** UUID-shaped SHA-256 of `ref ‖ canonicalJson(body)`; same input → same key (node:crypto, no dependency). */
export function idempotencyKey(ref: string, body: Record<string, unknown>): string;
/** The externalReference a dry run sends: `quote-` + the first 32 hex of the body's hash. */
export function quoteReference(body: Record<string, unknown>): string;
export function canonicalJson(value: unknown): string; // sorted keys, no whitespace
```

### `order-body.ts` — NEW

`export function toCreateOrderBody(draft: OrderDraft, ref: string, dryRun: boolean): Record<string, unknown>` — `customer.*` → `customerName`/`customerPhone`, `delivery.*` → top-level, items passed as given, `dryRun` only when true. Pure; no I/O.

### `tools.ts` — NEW

`export function restofyTools(client: RestofyClient): ToolDefinition[]` with plain `defineTool` (no metadata). Shared zod pieces: `uuid` (36), `e164` (`/^\+[1-9]\d{6,14}$/`), `isoDate`, `isoDateTime`, `orderLine`, `orderDraft`. Per tool, contract §C:

| Tool                                | Handler                                                                                                                                                                                                                                                  |
| :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_business_profile`              | `business-profile/get-business-profile` `{}`                                                                                                                                                                                                             |
| `list_fulfillments`                 | `integration/list-fulfillments`                                                                                                                                                                                                                          |
| `list_catalog`                      | `integration/list-catalog-products`, `limit` default 100                                                                                                                                                                                                 |
| `quote_order`                       | body = `toCreateOrderBody(draft, quoteReference(…), true)`; header `Idempotency-Key: idempotencyKey(ref, body)`                                                                                                                                          |
| `create_order` (control)            | same with the caller's `externalReference`, `dryRun` absent                                                                                                                                                                                              |
| `get_order`                         | `integration/get-order` `{ orderUuid }`                                                                                                                                                                                                                  |
| `find_order_by_reference` (control) | `{ externalReference }`; the not-found 400 → `ok({ found: false })`                                                                                                                                                                                      |
| `find_contact_by_phone`             | `parties/get-party-by-phone`; `party: null` → `{ found: false }`; else the 4-field contact                                                                                                                                                               |
| `create_contact`                    | `get-party-by-phone` first; found → `{ created: false, contact }` with **no write**; else `set-party { name, phone }` → `{ created: true, contact }`                                                                                                     |
| `list_reservation_areas`            | `list-reservation-areas`, then `get-reservation-area` per row (sequential, at most 20); merge, drop `schedule`/`scheduleId`                                                                                                                              |
| `list_reservation_slots`            | `tenants/get-tenant-info` → `slug`; empty → `{ slots: [], reason: 'no_public_address' }`; then `list-reservation-areas` row for `areaUuid` with `isOnlineBookable: 0` → `reason: 'not_bookable_online'`; else `diner-reservation/list-reservation-slots` |
| `create_reservation`                | `reservations/create-reservation`, verbatim input                                                                                                                                                                                                        |
| `find_reservations_by_phone`        | `list-reservations { scope, search: phone }`, filter `partyPhone === phone`, project, `{ items }`                                                                                                                                                        |
| `get_reservation`                   | `get-reservation-detail`                                                                                                                                                                                                                                 |
| `cancel_reservation`                | `cancel-reservation`                                                                                                                                                                                                                                     |
| `list_reservations` (control)       | `list-reservations`, verbatim                                                                                                                                                                                                                            |

Descriptions carry the facts of contract §C.2 (kitchen stages invisible; capacity not checked; never renames a contact; E.164; empty channels mean none created).

### `provider.ts` / `index.ts` — NEW

`createRestofyProvider(deps: { fetchImpl?; baseUrl? } = {})` → `createProvider({ manifest: restofyManifest, auth: restofyAuth, tools: restofyTools(createRestofyClient({ baseUrl })), fetchImpl })`. `index.ts` exports `restofyProvider = createRestofyProvider()`.

### `src/providers/index.ts` — MODIFIED

`import { restofyProvider } from './restofy';` and `restofyProvider,` at the end of `PROVIDERS`.

### `assets/restofy.svg` — NEW

The house tile (black, rx 6, the mark in white), traced from Restofy's app icon. If the mark is only a raster, defer the tile to its own change, as Avirato did.

## Vertical slices

Each slice is one `/tdd` loop: tests against `__fixtures__` through `createRestofyProvider({ fetchImpl })` and `callTool`, then the code.

| #   | Slice               | Builds                                                                                                                             | Depends on                        | DoD                                                                                                                                                                                                                           |
| :-- | :------------------ | :--------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Skeleton + one read | `manifest`, `auth`, `client`, `errors`, `provider`, `index`, registry line, `get_business_profile`                                 | —                                 | Conformance green. Catalog shows `responseFields.token: 'data.accessToken'`, `tokenTtlSeconds: 86400`, no `contextSchema`. Request is `POST …/business-profile/get-business-profile`; the bearer comes from the materializer. |
| S2  | Errors              | `errors.ts` paths of contract §D through the S1 tool                                                                               | S1                                | 401 → `AUTH_EXPIRED`, 400 → `INVALID_INPUT` with Restofy's message, a message with `{` or `http` → generic, 5xx → `UNAVAILABLE`. No message contains the URL, the token or a body value.                                      |
| S3  | Menu                | `list_fulfillments`, `list_catalog`                                                                                                | S1, S2                            | Empty channels fixture → `fulfillments: []`. `limit` defaults to 100 and refuses 101. `page` passes through.                                                                                                                  |
| S4  | Quote and order     | `idempotency.ts`, `order-body.ts`, `quote_order`, `create_order` (control), `get_order`, `find_order_by_reference` (control)       | S1, S2                            | Same draft → same key; any body change → another key. `quote_order` sends `dryRun: true` and a `quote-` reference. `create_order` and `find_order_by_reference` not in `tools/list`. Not-found → `{ found: false }`.          |
| S5  | Contacts            | `find_contact_by_phone`, `create_contact`                                                                                          | S1, S2                            | `party: null` → `{ found: false }`. **An existing phone makes no `set-party` call** (asserted on the fake fetch). A non-E.164 phone is refused before any request.                                                            |
| S6  | Reservation reads   | `list_reservation_areas`, `list_reservation_slots`, `find_reservations_by_phone`, `get_reservation`, `list_reservations` (control) | S1, S2                            | Areas merged with their rules. Slots: both `reason`s and the happy path. Find keeps only exact `partyPhone`. Identity policies in `_meta`.                                                                                    |
| S7  | Reservation writes  | `create_reservation`, `cancel_reservation`                                                                                         | S6                                | Verbatim body; cancel's `recordAction: 'cancel'`; a past `reservedAt` 400 → `INVALID_INPUT` with Restofy's sentence.                                                                                                          |
| S8  | Integration         | Full fixture set, identity-policy test, audience coverage (13 marked), redaction test, logo, `typecheck`/`format:check`/`test`     | S1–S7                             | All green.                                                                                                                                                                                                                    |
| S9  | Contract QA         | `mcp-contract-qa` against the test restaurant                                                                                      | S8, the test key in Doppler `dev` | Discover → list → call green on every read; one order (reference `xcale-qa-…`), one contact, one reservation created and cancelled.                                                                                           |

## Delegation map

One folder and one shared `tools.ts`, about 12 files: under the threshold. **The main agent builds it solo, in order S1 → S9.** Foundation S1–S2; S3–S7 sequenced because they share `tools.ts`; S8–S9 integration. No sub-issues: one lane, one PR.

## Definition of Done

- [ ] S1 skeleton and `get_business_profile`, conformance green
- [ ] S2 error mapping and the redaction rule
- [ ] S3 channels and menu
- [ ] S4 quote, order (control plane), order reads; the derived idempotency key
- [ ] S5 contacts, with no rename possible
- [ ] S6 reservation reads with identity policies
- [ ] S7 reservation create and cancel
- [ ] S8 `npm run typecheck && npm run format:check && npm test` clean
- [ ] S9 `mcp-contract-qa` against the test restaurant
- [ ] The test key in Doppler `xcale-mcp-server` `dev` (`RESTOFY_API_KEY`, `RESTOFY_TENANT_KEY`), so CI-adjacent QA never reads a local file
- [ ] PR to `dev` linked to xcale-backend#2935; the backend's consumer issue opened and linked (provider before consumer)
