# Autocore Hotels Provider — Implementation Plan

> **Inputs**: [`feature-design.md`](./feature-design.md) · [`api-contract.md`](./api-contract.md) · [`grill-notes.md`](./grill-notes.md) · [`sandbox-evidence.md`](./sandbox-evidence.md) · ADR [`timestamped-hash-token-auth-scheme`](../../adr/timestamped-hash-token-auth-scheme.md)
> **Issue**: matesjara/xcale-mcp-server#188 · **Branch**: `feat/188-autocore-provider` (docs and code, one PR to `dev`)
> **Status**: Draft · **Last updated**: 2026-11-13
>
> Symbols and intent, **no bodies**. Every change to an existing file is anchored to a real `file:line` on the
> branch's base, `dev` @ `154b65f`.

## Meta

A new auth variant in the core, then a new provider, `autocore`, following the canonical pattern of
`src/providers/wompi/` (`auth`/`context`/`manifest`/`client`/`errors`/`tools`/`provider`/`index` + `__fixtures__`/
`__tests__`).

**Shape of the change:**

- **Phase 1 — the core (breaks Provider Self-Containment once, by ADR).** The additive `timestamped_hash_token`
  variant: its descriptor in `ProviderAuthDescriptor`, its branch in `materialize()` (still the only reveal), an
  injectable clock threaded from `ProviderSpec` to `materialize()`, a typed failure for a malformed composed secret,
  the `CONTEXT.md` entry. Own commit, "Touches the core" section in the PR, a separate CTO review; `/implement` does
  not merge it (ADR 0017).
- **Phase 2 — the provider, for the contracted surface.** `mcp_autocore_check_credentials`,
  `mcp_autocore_create_payment_link` and `mcp_autocore_deactivate_payment_link`, all `controlPlane`, the base URL
  chosen from `environment`.
- **Phase 3 — `mcp_autocore_get_transaction_status` and the account's `source`** (slices S1 and A5), built once Autocore
  fixed its Staging checkout and real test payments were observed (2026-11-13).

**"Done" for Phases 1–2 means:** the variant passes the ADR's six binding tests; the two tools are callable and
absent from `tools/list`; each Staging response is covered by a fixture test; no Autocore body, token, key or link
URL reaches an outcome or a log; `typecheck`, `format:check` and `test` are green. The PR can merge with Phases 1–2
only if the consumer accepts a provider without its status tool; otherwise it waits for Phase 3 (§ Phases).

**Detail tapers by phase (rolling-wave).** Phases 1 and 2 are anchored to code that exists today. Phase 3 is at
slice level by design — not a gap.

## Target tree

```
CONTEXT.md                                          # MOD — glossary entry for the variant; the "swap point" line names it
src/core/
├── provider-port.ts                                # MOD — new union member `timestamped_hash_token`
├── provider-factory.ts                             # MOD — `ProviderSpec.clock?`; passes it to materialize; maps CredentialShapeError
├── auth/
│   ├── authentication-materializer.ts              # MOD — new case; clock parameter; secret split (inside the one reveal)
│   └── __tests__/
│       └── authentication-materializer.test.ts     # MOD — the ADR's binding tests
└── __tests__/
    └── provider-factory.test.ts                    # MOD — clock seam; malformed composed secret → typed outcome
src/providers/
├── index.ts                                        # MOD — import + one PROVIDERS entry
└── autocore/                                       # NEW
    ├── auth.ts                                     # NEW — timestamped_hash_token descriptor, reference delivery
    ├── context.ts                                  # NEW — zod { hotelId, environment }
    ├── manifest.ts                                 # NEW — slug, probe, accountContextKeys
    ├── client.ts                                   # NEW — base URL by environment; get/post over the core request
    ├── errors.ts                                   # NEW — unwrapAutocore: status → ProviderErrorCode, never the body
    ├── tools.ts                                    # NEW — check_credentials, create_payment_link, deactivate_payment_link
    ├── provider.ts                                 # NEW — createAutocoreProvider / autocoreProvider
    ├── index.ts                                    # NEW
    ├── __fixtures__/                               # NEW — contract §4
    └── __tests__/
        ├── errors.test.ts                          # NEW — mapping + redaction
        └── autocore.test.ts                        # NEW — tools against fakeFetch + conformance round trip
assets/autocore.svg                                 # NEW — logo (.svg or .webp)
```

## Anchors (existing code read on `dev` @ `154b65f`)

| Seam                             | File:line                                                                                                                                                                               | Use                                                              |
| :------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
| Auth descriptor union            | `src/core/provider-port.ts:39-126`; `basic` with label-only `fields` at `:71-89`                                                                                                        | New member, shaped like `basic` plus `header`                    |
| The one reveal                   | `src/core/auth/authentication-materializer.ts:38`                                                                                                                                       | Stays the only reveal; the split happens after it                |
| Exhaustive switch                | `src/core/auth/authentication-materializer.ts:40-80` (`assertNever` at `:79`)                                                                                                           | New `case 'timestamped_hash_token'`                              |
| `materialize` signature          | `src/core/auth/authentication-materializer.ts:19-29`                                                                                                                                    | Gains a clock parameter after `group`                            |
| Per-request materialization      | `src/core/provider-factory.ts:127-132`                                                                                                                                                  | Passes the spec's clock; a token per HTTP request comes for free |
| `ProviderSpec`                   | `src/core/provider-factory.ts:11-28` (`fetchImpl` at `:27`)                                                                                                                             | Gains `clock?` beside `fetchImpl`                                |
| Typed outcome instead of a throw | `src/core/provider-factory.ts:112-121` (the credential-group precedent)                                                                                                                 | Same treatment for a malformed composed secret                   |
| Error codes / status policy      | `src/core/errors.ts:6-15`; `src/core/http.ts:8`                                                                                                                                         | Mapping                                                          |
| `RequestResult`, transport       | `src/core/http.ts:18`, `:65`                                                                                                                                                            | Client                                                           |
| Core redaction (query only)      | `src/core/http.ts:47`                                                                                                                                                                   | Why the provider redacts its own                                 |
| Tool helpers                     | `src/core/tool.ts:16` (`ok`), `:20` (`err`), `:107` (`controlPlane`), `:129` (`toolFactory`)                                                                                            | Tools                                                            |
| Glossary                         | `CONTEXT.md:206-212` (Authentication Materialization, "swap point")                                                                                                                     | New entry                                                        |
| Provider template                | `src/providers/wompi/` — `client.ts:16-21` (`WompiClientDeps`, `WompiClient`), `:43-47` (base URL per call), `:59` (`createWompiClient`); `errors.ts:21` (`unwrapWompi`); `provider.ts` | Same shape                                                       |
| Provider list                    | `src/providers/index.ts:20` (`PROVIDERS`), `:30` (`wompiProvider`)                                                                                                                      | Add `autocoreProvider`                                           |
| Materializer tests               | `src/core/auth/__tests__/authentication-materializer.test.ts`                                                                                                                           | Binding tests                                                    |
| Connect-method parity            | `src/core/__tests__/auth-materialization-parity.test.ts`                                                                                                                                | Unchanged; must stay green                                       |

## Per-file changes

### Phase 1 — core

| File / symbol                                           | Kind | Signature                                                                                                                                                                                                     | Intent                                                                                                                                                                                                                                                  |
| :------------------------------------------------------ | :--- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `provider-port.ts` `ProviderAuthDescriptor`             | MOD  | `\| { readonly type: 'timestamped_hash_token'; readonly credentialDelivery?: CredentialDelivery; readonly header: string; readonly fields: ReadonlyArray<{ readonly key: string; readonly label: string }> }` | The ADR's descriptor: the header name and the two label-only inputs (`fields[0]` the key in the token, composition `fields[0]:fields[1]`). JSDoc states the fixed recipe and cites the ADR.                                                             |
| `authentication-materializer.ts` `materialize`          | MOD  | `materialize(auth, resolved, spec, group?: string, now: () => number = Date.now): HttpRequest`                                                                                                                | New case: split the revealed secret at its first `:`; `ts = String(Math.floor(now() / 1000))`; `digest = sha256(utf8(secret + ts))` lowercase hex; `headers[auth.header] = base64(utf8(key + ';' + ts + ';' + digest))`. Other branches byte-identical. |
| `authentication-materializer.ts` `CredentialShapeError` | NEW  | `class CredentialShapeError extends Error` (fixed message, no credential material)                                                                                                                            | Thrown when the composed secret has no `:` or an empty part, before any request.                                                                                                                                                                        |
| `provider-factory.ts` `ProviderSpec`                    | MOD  | `readonly clock?: () => number`                                                                                                                                                                               | Test seam beside `fetchImpl` (`:27`).                                                                                                                                                                                                                   |
| `provider-factory.ts` `createProvider`                  | MOD  | the `request` executor at `:127-132` passes `spec.clock`; the tool call catches `CredentialShapeError`                                                                                                        | A malformed composed secret becomes `toolError(AUTH_EXPIRED, 'Stored credential is malformed — reconnect the account')` — a reconnect fixes it, as with the missing group secret at `:112-121`.                                                         |
| `CONTEXT.md`                                            | MOD  | glossary entry `timestamped_hash_token`; `:210` names it as the imperative variant                                                                                                                            | Vocabulary.                                                                                                                                                                                                                                             |

### Phase 2 — provider

| File / symbol                                                                     | Kind | Signature                                                                                                                                                                             | Intent                                                                                                                                                                                                                                                                                                                                                                                            |
| :-------------------------------------------------------------------------------- | :--- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `autocore/auth.ts` `autocoreAuth`                                                 | NEW  | `ProviderAuthDescriptor`                                                                                                                                                              | `{ type: 'timestamped_hash_token', header: 'Auth-Token', credentialDelivery: 'reference', fields: [access_key, secret_key] }` (contract §0).                                                                                                                                                                                                                                                      |
| `autocore/context.ts` `autocoreContext`, `AutocoreContext`, `AutocoreEnvironment` | NEW  | `z.object({ hotelId: z.number().int().positive(), environment: z.enum(['staging','production']) }).strict()`                                                                          | Context; the environment is the tenant's choice.                                                                                                                                                                                                                                                                                                                                                  |
| `autocore/manifest.ts` `autocoreManifest`                                         | NEW  | `ProviderManifest`                                                                                                                                                                    | `slug: 'autocore'`, `displayName: 'Autocore Hotels'`, `category: 'payment-gateway'`, `connectionProbe: { tool: 'mcp_autocore_check_credentials' }`, `accountContextKeys: ['hotelId','environment']`, `logoUrl: '/assets/autocore.svg'`.                                                                                                                                                           |
| `autocore/client.ts` `createAutocoreClient`, `AutocoreClient`                     | NEW  | `createAutocoreClient(deps?: { baseUrls?: Readonly<Record<AutocoreEnvironment, string>> }): AutocoreClient` with `get(path, request, ctx, params?)`, `post(path, request, ctx, body)` | Base URL from `ctx.environment` (`api-stg` / `api`); JSON body; no retry.                                                                                                                                                                                                                                                                                                                         |
| `autocore/errors.ts` `unwrapAutocore`                                             | NEW  | `unwrapAutocore(res: RequestResult, operation: string): Unwrapped`                                                                                                                    | Core status policy; own message `Autocore <operation> failed (HTTP n)`; never reads `detail`/`message` into the outcome (contract §2).                                                                                                                                                                                                                                                            |
| `autocore/tools.ts` `buildAutocoreTools`                                          | NEW  | `buildAutocoreTools(client: AutocoreClient): ReadonlyArray<ToolDefinition<any, AutocoreContext>>`                                                                                     | `check_credentials`: page `GET /v2/hotels?offset&limit=10` to `total_items`, cap 20 pages, find `hotelId`, project `{ id, name, active, currencies, primaryCurrency }`. `create_payment_link`: map input → body (contract §1.2), omit absent optionals, `POST` once, return `{ code, url }`. `deactivate_payment_link`: `DELETE /v2/bookings/chatbot/<code>`, return `{ code, cancelled: true }`. |
| `autocore/provider.ts` `createAutocoreProvider`, `autocoreProvider`               | NEW  | `createAutocoreProvider(deps?: { fetchImpl?: FetchLike; baseUrls?: …; clock?: () => number }): IProvider`                                                                             | `createProvider({ manifest, auth, metadataSchema, tools, fetchImpl, clock })`.                                                                                                                                                                                                                                                                                                                    |
| `autocore/index.ts`                                                               | NEW  | re-exports                                                                                                                                                                            | —                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/providers/index.ts`                                                          | MOD  | `PROVIDERS` (`:20`)                                                                                                                                                                   | One import + one entry.                                                                                                                                                                                                                                                                                                                                                                           |
| `assets/autocore.svg`                                                             | NEW  | —                                                                                                                                                                                     | Logo from Autocore's public brand (or `.webp`); the PR template allows only these.                                                                                                                                                                                                                                                                                                                |

### Phase 3 — status tool and `source`

| File / symbol                                | Kind | Signature                                 | Intent                                                                                                                                                                                                                                                                                                                                                                           |
| :------------------------------------------- | :--- | :---------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autocore/context.ts` `autocoreContext`      | MOD  | adds `source: z.string().min(1).max(100)` | The account's origin, required by Autocore on every create since 2026-11-13 (A5).                                                                                                                                                                                                                                                                                                |
| `autocore/tools.ts` `create_payment_link`    | MOD  | body gains `source: ctx.metadata.source`  | A5.                                                                                                                                                                                                                                                                                                                                                                              |
| `autocore/tools.ts` `get_transaction_status` | NEW  | input `{ code }`                          | `GET /v2/common/transaction-status` (codes); only when `applied`, `GET /v2/links/schedule/<code>` and the payment whose `transaction_id` is the status's → `amount` (decimal string → number), the link's `currency`, `occurredAt` from the payment's naive-UTC `created_at`; `""` / `"N/A"` → no transaction; an `applied` without a readable payment is `PROVIDER_ERROR` (S1). |
| `__fixtures__/status*.json`, `link*.json`    | NEW  | —                                         | Real Staging reads of 2026-11-13 (applied, rejected, pending, cancelled; the paid and the declined link), guest and company data replaced.                                                                                                                                                                                                                                       |

## Slices

| #   | Slice                                | Owns                                                                                                        | Depends on                  | DoD                                                                                                                                                                                                                      |
| :-- | :----------------------------------- | :---------------------------------------------------------------------------------------------------------- | :-------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | The `timestamped_hash_token` variant | `provider-port.ts`, `authentication-materializer.ts`, `provider-factory.ts`, their tests, `CONTEXT.md`      | —                           | The ADR's six binding tests green; parity test and every existing provider test green; one commit `feat(core): timestamped_hash_token auth variant`.                                                                     |
| A1  | Provider foundation                  | `auth.ts`, `context.ts`, `client.ts`, `errors.ts`, `__tests__/errors.test.ts`, error fixtures               | C1                          | Mapping per status; redaction; base URL per environment; unknown environment refused with no fetch.                                                                                                                      |
| A2  | The probe                            | `tools.ts` (check), `manifest.ts`, `provider.ts`, `index.ts`, `listHotels.json`, part of `autocore.test.ts` | A1                          | Found / not found / 401 / cap; projection drops the hotel's other fields; `Auth-Token` present on each page.                                                                                                             |
| A3  | Link creation + registration         | `tools.ts` (create), `createPaymentLink.json`, `src/providers/index.ts`, logo, rest of `autocore.test.ts`   | A2                          | Body mapping; optionals omitted; one `POST` even on a network failure; conformance round trip.                                                                                                                           |
| A4  | Link cancellation                    | `tools.ts` (deactivate), `deactivatePaymentLink.json`, its cases in `autocore.test.ts`                      | A3                          | `DELETE` path from the code; idempotent `200` → `ok`; an invalid code refused with no call; 401 → `AUTH_EXPIRED`; conformance includes it.                                                                               |
| A5  | The account's `source`               | `context.ts`, `tools.ts` (create), the contexts in the tests                                                | A4                          | The context requires a non-empty `source`; the create body carries it.                                                                                                                                                   |
| S1  | The status tool                      | `tools.ts` (status), `status*.json`, `link*.json`, its cases in `autocore.test.ts`, conformance             | A4 + the paid path observed | Applied with amount and currency (two calls); rejected/pending/cancelled with nulls (one call); an applied without its payment is an error; the link read failing is that failure; an invalid code refused with no call. |

- [x] C1
- [x] A1
- [x] A2
- [x] A3
- [x] A4
- [x] A5
- [x] S1

### Test order (one red → green at a time)

**C1 — `authentication-materializer.test.ts`, `provider-factory.test.ts`** (dummy keys only)

1. **Parity vector.** `fields`-composed secret `AK123:SK456`, clock fixed at `1700000000000` ms →
   `Auth-Token: QUsxMjM7MTcwMDAwMDAwMDs2ZjA4ODc5N2FkOWM1MGQyNTYzZTQwOTNiODhhZjI2NzMyMzMxOGM1OWIxYzI2OWNlNDBhYjQwNDliNjMzMzEz`.
   Computed independently on 2026-11-09 with
   `printf '%s' 'SK4561700000000' | sha256sum` (digest `6f088797ad9c50d2563e4093b88af267323318c59b1c269ce40ab4049b633313`)
   and `printf '%s' 'AK123;1700000000;<digest>' | base64 -w0`; recorded beside the test. The Staging `200` of
   2026-11-09 (`sandbox-evidence.md`) is the proof the recipe is Autocore's.
2. **Whole seconds.** `1700000000999` ms → the same `ts` as `1700000000000` (truncates, never rounds).
3. **A token per request.** Two `materialize` calls at different fixed times → two different headers.
4. **The split.** `AK:S:with:colons` keeps the secret `S:with:colons`; `nocolon`, `:secret` and `key:` throw
   `CredentialShapeError` with a message containing none of the input.
5. **Never logged.** The thrown error, the descriptor's JSON and a failed outcome contain neither part of the secret
   nor the token.
6. **No regression.** Every existing branch's tests and the connect-method parity test unchanged and green.
7. **Factory.** `ProviderSpec.clock` reaches `materialize`; a malformed composed secret returns `AUTH_EXPIRED` as a
   typed tool outcome, not a JSON-RPC error.

**A1 — `errors.test.ts`, client cases**

1. `401` (`invalidCredentials.json`) → `PROVIDER_AUTH_EXPIRED`, `Autocore <op> failed (HTTP 401)`.
2. **Redaction:** `withFakeKey.json` → neither outcome nor message contains the fake key or `detail`.
3. `422` (`missingFields.json`) → `PROVIDER_INVALID_INPUT`, the Spanish `detail` not propagated.
4. `404` (`hotelNotFound.json`) → `PROVIDER_ERROR`; `429` → `PROVIDER_RATE_LIMITED`; `5xx` and a network failure →
   `PROVIDER_UNAVAILABLE`; a `2xx` with an unexpected shape → `PROVIDER_ERROR`.
5. `environment: 'staging'` → `https://api-stg.autocore.pro`, `'production'` → `https://api.autocore.pro`; a missing
   or unknown environment, or `hotelId: 0`, → `PROVIDER_INVALID_INPUT` and **no fetch**.

**A2 — `autocore.test.ts`, probe**

1. `GET /v2/hotels?offset=0&limit=10` with an `Auth-Token` header (fixed clock) → hotel 5 found →
   `ok({ valid: true, hotel: { id: 5, name: 'STG XCALE HOTEL', active: true, currencies: ['COP','USD'], primaryCurrency: 'COP' } })`;
   the output has no `contact_phone`, `company`, `commission`.
2. `hotelId: 6` → `PROVIDER_INVALID_INPUT`, `Autocore hotel 6 is not reachable with these keys`.
3. Paging follows `total_items`, not `links.next` (the fixture's `next` points past the end); 25 pages of 10 without
   the hotel → `PROVIDER_ERROR` after page 20.
4. `401` → `PROVIDER_AUTH_EXPIRED`.

**A3 — `autocore.test.ts`, create + registration**

1. Full input → `POST /v2/links/schedule/` with the exact body of contract §1.2 (`hotel_id` from context); response →
   `ok({ code, url })`, no `msg`.
2. Without `email` / `allowedPaymentOptions` → those keys absent from the body (not `null`).
3. Schema refusals with no call: `amount: 150000.5`, `amount: 0`, `currency: 'cop'`, no `description`, no
   `sendLinkByEmail`, `notificationUrl` over `http://`, an undeclared key.
4. A network failure → `PROVIDER_UNAVAILABLE` and **exactly one** fetch.
5. **Conformance round trip:** `tools/list` lists neither tool; `tools/call` by name works for both; the auth-failure
   path returns `isError: true` with `PROVIDER_AUTH_EXPIRED`.
6. Registration: `autocoreProvider` in `PROVIDERS`; manifest probe and account keys as in contract §0.

**A4 — `autocore.test.ts`, cancellation**

1. `{ code: 'gmoiew13h8zz' }` → `DELETE /v2/bookings/chatbot/gmoiew13h8zz` with an `Auth-Token` →
   `ok({ code: 'gmoiew13h8zz', cancelled: true })`; `msg` not returned.
2. The same `200` twice (an already-cancelled link) → `ok` both times.
3. `code: '../x'`, `code: 'ABC'` (uppercase), an empty code → `PROVIDER_INVALID_INPUT`, no fetch.
4. `401` → `PROVIDER_AUTH_EXPIRED`; `404` → `PROVIDER_ERROR`.
5. The conformance round trip covers the third tool.

## Delegation map

| Band        | Slices                         | Who                                                                                |
| :---------- | :----------------------------- | :--------------------------------------------------------------------------------- |
| Foundation  | C1, then A1                    | Orchestrator, sequential                                                           |
| Independent | —                              | None: A2–A4 share `tools.ts` and `autocore.test.ts`, and each needs the one before |
| Integration | A3's registration, the DoD run | Orchestrator                                                                       |

About 19 files, but the slices are a chain over shared files: **build solo**, in order. No sub-issues (no real
parallelism; one reviewable PR).

## Phases and gates

1. **C1** → gate: `npm run typecheck`, `npm run format:check`, `npm test` green → commit
   `feat(core): timestamped_hash_token auth variant`.
2. **A1–A3** → same gate → commits per slice (`feat(autocore): …`).
3. **S1** → only when the preflight is lifted (`sandbox-evidence.md` gains the paid path) → `/api-contract-authoring`
   adds the tool to the contract, deletes the preflight → its own detail here → build → same gate.

The PR to `dev` carries a "Touches the core" section for C1 and asks for the CTO's review of that commit. Whether it
opens after A3 (provider without its status tool) or after S1 is the consumer's call: the backend's Autocore adapter
cannot settle a payment without S1.

### PR checklist mapping (`.github/pull_request_template.md`)

| Template box                                                                | This change                                                                                                                 |
| :-------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| Only `src/providers/{slug}/`, tests, one line in `index.ts`, logo, own docs | No: C1 touches `src/core/` by ADR `timestamped-hash-token-auth-scheme` — "Touches the core" section                         |
| `identityPolicy` on tools that touch a person's records                     | None do (the guest's name goes in, nothing personal comes out) → absent, justified in the feature design                    |
| Consumer registration data asked in a consumer issue                        | A new xcale-backend issue: Rail A recognises the variant; the gateway adapter (feature design § Consumer registration data) |
| No raw token persisted or logged; `reveal()` only at egress                 | Yes — the token is built after the one reveal; tests assert it never appears in outcomes or errors                          |

## Test strategy

- Vitest; the wompi-style `fakeFetch` (records URL, method, headers and body) and fixtures from the Staging spike, with
  no key and placeholders for any personal or company data.
- `CTX = { credential: { secret: new SecretString('AK123:SK456') }, metadata: { hotelId: 5, environment: 'staging' } }`;
  clock fixed at `1700000000000`.
- Commands: `npm run typecheck`, `npm run format:check`, `npm test`.
- After the build, optional: `mcp-contract-qa` against Staging with the keys in Doppler (`xcale` / `dev_sara`,
  `AUTOCORE_STG_*`).

## Definition of done (Phases 1–2)

- [x] C1, A1, A2, A3, A4, A5, S1 ticked.
- [x] `npm run typecheck` · `npm run format:check` green; `npm test` green but for the three HTTP integration files that time out on the dev machine with or without this branch (CI runs them).
- [x] The ADR's binding tests, the redaction test and the conformance round trip green.
- [x] Logo in `assets/`.
- [x] Consumer issue filed in xcale-backend (matesjara/xcale-backend#2915).

## Risks

| Risk                                              | Mitigation                                                                         |
| :------------------------------------------------ | :--------------------------------------------------------------------------------- |
| A secret or token leaks through the new branch    | Split after the one reveal; tests 4–5 of C1; the CI grep on `.reveal()` unchanged. |
| The variant drifts from Autocore's recipe         | The parity vector plus the observed Staging `200`.                                 |
| Clock drift past 30 s reads as reconnect-required | Accepted in the ADR (NTP on App Platform).                                         |
| A create is retried and duplicates a payable link | One `POST`, asserted by A3 test 4.                                                 |
| The provider ships without its status tool        | S1 gated; the PR states which phases it carries.                                   |
