# Avirato Provider — Implementation Plan

> **Implements**: [feature-design.md](feature-design.md) · [api-contract.md](api-contract.md) · ADR [credential-exchange-response-path-and-token-ttl](../../adr/credential-exchange-response-path-and-token-ttl.md)
> **Issue**: matesjara/xcale-mcp-server#189 · **Branch**: `feat/189-avirato-provider` (one branch, one PR to `dev`)
> **Last updated**: 2026-10-30

## Meta-description

This plan adds `src/providers/avirato/`, a thin adapter over Avirato's API v3. It follows Erbon's shape (`credential_exchange` + `reference`, control-plane money and writes) and Cloudbeds' shape (a numeric context id on every call, identity policies on reservation tools).

The provider publishes the **13 tools of the contract** (§C):

- 10 on the agent's menu: 7 catalog reads and 3 reservation reads;
- 3 control-plane tools: `quote_stay`, `create_reservation` and `cancel_reservation`.

It reaches nothing outside its footprint (its folder, one registry line, its logo). The one core change it needs, the dotted token path and `tokenTtlSeconds`, is **already committed** on this branch with its ADR (`dc793e9`).

**Done** means:

- `server/discover` lists `avirato` with its `authDescriptor` and `contextSchema { web_code }`;
- `tools/list` returns the 10 menu tools;
- the conformance suite, the redaction test and every tool's fixture test are green;
- `npm run typecheck`, `npm run format:check` and `npm test` are clean.

`mcp-contract-qa` against Avirato runs once the sandbox user exists (2026-10-31).

**Out of this plan:**

- `modify_reservation` waits for P-7: Avirato's `PATCH` has not been observed working.
- Which link pays waits for P-1. The tool already returns all three links.

Both join by an additive revision (contract §F).

## Reality check — what was read

| Seam                                      | Anchor                                                                        | What it tells the build                                                                                                                                 |
| :---------------------------------------- | :---------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Registry                                  | `src/providers/index.ts:20-31`                                                | One import and one entry in `PROVIDERS`                                                                                                                 |
| Provider factory                          | `src/core/provider-factory.ts:11,39`                                          | `createProvider({ manifest, auth, metadataSchema, tools, fetchImpl? })`                                                                                 |
| Tool definition                           | `src/core/tool.ts:40-107,118,129`                                             | `toolFactory<M>()`, `ok`/`err`, `identityPolicy`, `readOnly: true`, `controlPlane: true`                                                                |
| Transport result                          | `src/core/http.ts:18-25`                                                      | `RequestResult` = `{ ok, status, data }` or `{ ok:false, status, errorCode, body (≤500 chars) }`. **No response headers.**                              |
| Status → code                             | `src/core/http.ts:8-14`                                                       | 401/403 → `AUTH_EXPIRED`, 429 → `RATE_LIMITED`, 5xx → `UNAVAILABLE`, 400/422 → `INVALID_INPUT`                                                          |
| Identity policy                           | `src/core/types.ts:30-60`                                                     | `subject-bound { identityFields, recordOwnershipField?, ownedResultField?, recordOwnershipKind?, alwaysEnforce? }`, `subject-scoped`, `knowledge-proof` |
| Auth descriptor (with the new fields)     | `src/core/provider-port.ts:99-136`                                            | `responseFields.token` path, `tokenTtlSeconds`                                                                                                          |
| Template — `credential_exchange` provider | `src/providers/erbon/{auth,client,context,errors,manifest,provider,index}.ts` | The file set and the factory/DI shape. `client.ts` builds URLs and takes an `AuthedRequest`.                                                            |
| Template — body-aware error mapping       | `src/providers/lobbypms/errors.ts:1-60`                                       | Read a machine code from the error body, override the status default in named cases, never echo free text                                               |
| Template — date validation                | `src/providers/erbon/tools.ts:21-30`                                          | `isoDate` refine (a real calendar day)                                                                                                                  |
| Conformance                               | `src/core/testing/provider-conformance.ts`                                    | `runProviderConformance(provider)`, plus the new path and TTL checks                                                                                    |

**Contract correction made while planning:** the core's `RequestResult` carries no headers, so `X-RateLimit-Reset` cannot be surfaced. The contract's §D and the design's AD-7 now say a 429 is `PROVIDER_RATE_LIMITED`, with no reset time in v1.

## Target file tree

```
src/providers/avirato/                       NEW
├── auth.ts                                  NEW  aviratoAuth (contract §B)
├── context.ts                               NEW  aviratoContext { web_code }
├── client.ts                                NEW  URL builder + get/post/del over AuthedRequest
├── errors.ts                                NEW  unwrapAvirato + body errorCode reading
├── manifest.ts                              NEW  SLUG, aviratoManifest
├── tools.ts                                 NEW  buildAviratoTools (13 tools)
├── provider.ts                              NEW  createAviratoProvider(deps), aviratoProvider
├── index.ts                                 NEW  re-exports
├── __fixtures__/                            NEW  invented values on observed shapes (contract §E)
│   ├── establishment.json  space.json  rate.json  regime.json  extra.json
│   ├── availability.json  promo-unknown.json  quote-duplicated.json
│   ├── reservation.json  reservations-by-client.json  urls-guest.json
│   ├── create.json  cancel.json
│   └── error-retrieving.json  error-validation.json  error-invalid-token.json
└── __tests__/
    └── avirato.test.ts                      NEW  conformance, auth/context, every tool, errors, redaction
src/providers/index.ts                       MODIFIED  + aviratoProvider
assets/avirato.svg                           NEW  the house tile (black, rx 6, the mark in white)
docs/design/avirato-provider/                UNCHANGED (context) — this plan ticks its checkboxes
src/core/**                                  UNCHANGED in this plan (the ADR change is already on the branch)
```

## Per-file changes

### `auth.ts` — NEW

| Symbol        | Signature                                   | Intent                                                                                                                                                                                                                                                                                  |
| :------------ | :------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aviratoAuth` | `const aviratoAuth: ProviderAuthDescriptor` | The contract's §B verbatim: `credential_exchange`, `reference`, `/v3/token/login`, `bodyFields { email, password }`, `responseFields { token: 'data.token' }`, `tokenTtlSeconds: 900`, `bearer_header`. The doc comment cites the observed login (no expiry, second login invalidates). |

### `context.ts` — NEW

| Symbol           | Signature                                                             | Intent                                                                       |
| :--------------- | :-------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| `aviratoContext` | `z.object({ web_code: z.coerce.number().int().positive() }).strict()` | Explicit Context. Published as `contextSchema`, and the connection identity. |
| `AviratoContext` | `type = z.infer<typeof aviratoContext>`                               |                                                                              |

### `client.ts` — NEW

| Symbol                | Signature                                                                                                                    | Intent                                                                                         |
| :-------------------- | :--------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `AuthedRequest`       | `type = (spec: RequestSpec) => Promise<RequestResult>`                                                                       | Same seam as `erbon/client.ts:9`                                                               |
| `AviratoClientDeps`   | `{ baseUrl?: string }`                                                                                                       | Default `https://apiv3.avirato.com/v3`; the sandbox (`https://sandbox.avirato.com/v3`) for QA  |
| `AviratoClient`       | `{ get(path, request, ctx, query?): Promise<RequestResult>; post(path, request, ctx, body): …; del(path, request, ctx): … }` | Every URL carries `?web_code=` from the context; `query` values are encoded; JSON body on POST |
| `createAviratoClient` | `(deps?: AviratoClientDeps) => AviratoClient`                                                                                | Trims the trailing slash of `baseUrl`, as `erbon/client.ts:42` does                            |

### `errors.ts` — NEW

| Symbol               | Signature                                                | Intent                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| :------------------- | :------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aviratoErrorCode`   | `(body: string) => string \| undefined`                  | Reads `errorCode` from the error JSON when it is a machine code (`/^[A-Za-z][A-Za-z0-9_]{2,63}$/`). Never the free text.                                                                                                                                                                                                                                                                                                                       |
| `NOT_FOUND_CODE`     | `const = 'ERROR_RETRIEVING_RESERVATIONS'`                | The observed "cancelled or unknown" answer                                                                                                                                                                                                                                                                                                                                                                                                     |
| `unwrapAvirato`      | `(res: RequestResult, operation: string) => ToolOutcome` | 2xx → `ok(res.data.data)` (Avirato's envelope stripped). Errors follow contract §D: 403 → `PROVIDER_ERROR` (override of the core's `AUTH_EXPIRED`), `ERROR_RETRIEVING_RESERVATIONS` → `PROVIDER_ERROR` "reservation not found or cancelled", `INPUT_DATA_VALIDATION_FAILED`/`ERROR_VALIDATING_DATA` → `INVALID_INPUT` with the code, the rest by the core's status map. The message names the operation, the status and the machine code only. |
| `validationMessages` | `(body: string) => string[]`                             | Avirato's `errors[]` strings for `INVALID_INPUT`. These are field-validation sentences, safe to forward: they name parameters, never values.                                                                                                                                                                                                                                                                                                   |

### `manifest.ts` — NEW

| Symbol            | Signature          | Intent                                                                                                                                                                                                                                                                                                                                    |
| :---------------- | :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SLUG`            | `'avirato'`        |                                                                                                                                                                                                                                                                                                                                           |
| `aviratoManifest` | `ProviderManifest` | `displayName: 'Avirato'`, `category: 'hospitality'`, `logoUrl: '/assets/avirato.svg'`, `schemaVersion: '2026-10-30'`, `providerVersion: '0.1.0'`. Like Erbon: no `connectionProbe` (the mint proves the credential), no `contextDiscovery` (no endpoint lists a user's establishments; the consumer reads `web_codes` from its own mint). |

### `tools.ts` — NEW

`buildAviratoTools(client: AviratoClient): ReadonlyArray<ToolDefinition<any, AviratoContext>>`. Every handler is `unwrapAvirato(await client.<verb>(…), '<verb>')` unless a row says otherwise. Inputs are exactly the contract's §C.1 zod (dates via an `isoDate` like `erbon/tools.ts:21-30`).

| Tool                         | Flags                      | Identity policy (`src/core/types.ts`)                                                           | Handler notes                                                                                                                                                                                                                                                     |
| :--------------------------- | :------------------------- | :---------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_establishment`          | `readOnly`                 | —                                                                                               | `GET establishment`                                                                                                                                                                                                                                               |
| `list_room_types`            | `readOnly`                 | —                                                                                               | `GET space`                                                                                                                                                                                                                                                       |
| `list_rates`                 | `readOnly`                 | —                                                                                               | `GET rate`                                                                                                                                                                                                                                                        |
| `list_regimes`               | `readOnly`                 | —                                                                                               | `GET regime`                                                                                                                                                                                                                                                      |
| `list_extras`                | `readOnly`                 | —                                                                                               | `GET extra`                                                                                                                                                                                                                                                       |
| `check_availability`         | `readOnly`                 | —                                                                                               | `GET availability` with `start_date`, `end_date`, `space_subtype_id?`; refine `end_date >= start_date`                                                                                                                                                            |
| `validate_promotional_code`  | `readOnly`                 | —                                                                                               | `GET promotional_codes/{code}` (encoded); `data === ""` → `ok({ valid: false })`, else `ok({ valid: true, code: data })`                                                                                                                                          |
| `get_reservation`            | `readOnly`                 | `subject-bound`, `identityFields: ['reservation_id']`, `recordOwnershipField: 'reservation_id'` | `GET reservation/{id}`; returns the first array element                                                                                                                                                                                                           |
| `find_reservations_by_guest` | `readOnly`                 | `subject-bound`, `identityFields: ['client_doc']`                                               | `GET reservation/client/{doc}` (encoded); `ERROR_RETRIEVING_RESERVATIONS` → `ok({ items: [] })`; else `{ items: data }`                                                                                                                                           |
| `get_reservation_links`      | `readOnly`                 | `subject-bound`, `identityFields: ['reservation_id']`, `recordOwnershipField: 'reservation_id'` | `GET reservation/urls/{id}?type=`; returns `{ type, url }` verbatim, `http://` included                                                                                                                                                                           |
| `quote_stay`                 | `readOnly`, `controlPlane` | —                                                                                               | `POST price/price_for_reservation`; `rate_ids` sent as numbers; `{ items }` with exact duplicate rows removed (`JSON.stringify` key, order kept)                                                                                                                  |
| `create_reservation`         | `controlPlane`             | `subject-bound`, `identityFields: ['client_doc', 'email']`                                      | `POST reservation`; maps `payment` → Avirato `price`; fills `operator_reservation_id: "0"`, `advance { 0, payment_type }`, `extras: []`, `predefinedCharges: []`, `additional_beds` default 0; passes `external_code`/`promotional_code`; returns `data` verbatim |
| `cancel_reservation`         | `controlPlane`             | `subject-bound`, `identityFields: ['reservation_id']`, `recordOwnershipField: 'reservation_id'` | `DELETE reservation/{id}`                                                                                                                                                                                                                                         |

Descriptions follow the house style (what it returns, the observed quirks the caller must know). Two quirks must be stated:

- `find_reservations_by_guest`: Avirato was observed returning one reservation of several under the same document.
- `get_reservation_links`: the tool does not say which link pays.

### `provider.ts` / `index.ts` — NEW

| Symbol                  | Signature                                         | Intent                                                                                                                |
| :---------------------- | :------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------- |
| `AviratoProviderDeps`   | `{ fetchImpl?: FetchLike; baseUrl?: string }`     | DI for tests and the sandbox                                                                                          |
| `createAviratoProvider` | `(deps?: AviratoProviderDeps) => IProvider`       | `createProvider({ manifest, auth, metadataSchema: aviratoContext, tools, fetchImpl? })`, as `erbon/provider.ts:22-31` |
| `aviratoProvider`       | `const aviratoProvider = createAviratoProvider()` | The registered default                                                                                                |

### `src/providers/index.ts` — MODIFIED

Add `import { aviratoProvider } from './avirato';` and `aviratoProvider` to `PROVIDERS` (`:20-31`).

### `assets/avirato.svg` — NEW

The house tile (black, `rx 6`, the mark in white), as `assets/erbon.svg`. The mark is traced from Avirato's own logo.

## Vertical slices

Each slice is one `/tdd` loop: tests against `__fixtures__` through `createAviratoProvider({ fetchImpl })` and `callTool`, then the code.

| #   | Slice                    | Builds                                                                                                            | Depends on       | DoD                                                                                                                                                                                                        |
| :-- | :----------------------- | :---------------------------------------------------------------------------------------------------------------- | :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Skeleton + one read      | `auth`, `context`, `client`, `errors`, `manifest`, `provider`, `index`, registry line, logo, `get_establishment`  | —                | Conformance green. Catalog entry shows `responseFields.token: 'data.token'`, `tokenTtlSeconds: 900`, `contextSchema.web_code`. The request URL carries `web_code`; the bearer comes from the materializer. |
| S2  | Catalog reads            | `list_room_types`, `list_rates`, `list_regimes`, `list_extras`, `check_availability`, `validate_promotional_code` | S1               | Each tool's fixture test. `isoDate` refuses `2027-02-30`. Promo `""` gives `{ valid: false }`.                                                                                                             |
| S3  | Errors                   | `errors.ts` paths from contract §D, exercised through S1/S2 tools                                                 | S1               | 401 → `AUTH_EXPIRED`, 403 → `PROVIDER_ERROR`, 429 → `RATE_LIMITED`, 400 validation → `INVALID_INPUT` with `errors[]`, 5xx → `UNAVAILABLE`. No message contains the URL, the token or a body value.         |
| S4  | Quote (control plane)    | `quote_stay`                                                                                                      | S1, S3           | Not in `tools/list`, routable by name. Duplicate rows collapse. `rate_ids` leave as numbers.                                                                                                               |
| S5  | Reservation reads        | `get_reservation`, `find_reservations_by_guest`, `get_reservation_links`                                          | S1, S3           | Identity policies published in `_meta`. Not-found → `PROVIDER_ERROR` for `get_*`, `{ items: [] }` for find.                                                                                                |
| S6  | Writes (control plane)   | `create_reservation`, `cancel_reservation`                                                                        | S1, S3           | The outgoing body matches contract §A.9 exactly (`payment` → `price`, the filled defaults). Not in `tools/list`. One call, one request, no retry.                                                          |
| S7  | Integration              | Full fixture set, the redaction test, the `tools/list` count (10), `npm run typecheck`/`format:check`/`test`      | S1–S6            | All green; checkboxes below ticked                                                                                                                                                                         |
| S8  | Contract QA (2026-10-31) | `mcp-contract-qa` against the sandbox with a non-shared API user (R-6)                                            | S7, sandbox user | Discover → list → call green on every read; one create + cancel round trip, cancelled at once.                                                                                                             |

## Delegation map

Everything below lands in **one folder**, and `tools.ts` is one shared file. Under 4 independent slices and about 12 files, the threshold is not met: **the main agent builds it solo, in order S1 → S7.**

- **Foundation:** S1 and S3.
- **Independent** (sequenced anyway, because they share `tools.ts`): S2, S4, S5, S6.
- **Integration:** S7 and S8.

No sub-issues (Step 6b): one epic, one lane, one PR.

## Definition of Done

- [x] S1 skeleton, `get_establishment`, conformance green (the logo is deferred: Avirato publishes its mark only as a raster image, so the tile gets its own change)
- [x] S2 catalog reads
- [x] S3 error mapping (with a core fix: `redactQueryValues` ends a value at a quote, so Avirato's JSON error bodies stay parseable)
- [x] S4 `quote_stay` (control plane)
- [x] S5 reservation reads with identity policies
- [x] S6 `create_reservation`, `cancel_reservation` (control plane)
- [x] S7 `cd xcale-mcp-server && npm run typecheck && npm run format:check && npm test` clean (881 tests; `himed-credentials.integration.test.ts` times out in its `beforeAll` under the full parallel suite on Windows, passes alone — unrelated)
- [x] S8 `mcp-contract-qa` against the Avirato sandbox (2026-10-31): the surface offline, and all 13 tools live — 16/17 calls, the one failure the expected read of a cancelled reservation; the token still accepted after 17 min; modify observed working (P-7). P-1 cannot be answered on the sandbox (its Guest link opens the production guest app)
- [ ] PR to `dev` with the ADR, the core change and the provider, linked to #189; the backend's consumer issue linked (provider before consumer)
