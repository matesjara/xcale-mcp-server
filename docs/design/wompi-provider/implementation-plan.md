# Wompi Provider — Implementation Plan

> **Inputs**: [`feature-design.md`](./feature-design.md) · [`api-contract.md`](./api-contract.md) · [`grill-notes.md`](./grill-notes.md) · [`sandbox-evidence.md`](./sandbox-evidence.md)
> **Issue**: matesjara/xcale-mcp-server#159 · **Docs branch**: `docs/159-wompi-provider` · **Build branch**: `feat/159-wompi-provider` (from `dev` @ `55f2cba`, created when the build starts)
> **Status**: Draft · **Last updated**: 2026-10-24
>
> Symbols and intent, **no bodies**. Every change to an existing file is anchored to a real `file:line` on `dev` @ `55f2cba`.

## Meta

A new provider, `wompi`, following the `add-provider` pattern of `src/providers/toteat/`
(`auth`/`context`/`manifest`/`client`/`errors`/`tools`/`provider`/`index` + `__fixtures__`/`__tests__`).

**Shape of the change:**

- **One core change:** adding `'PATCH'` to `HttpMethod` (`src/core/auth/http-request.ts`), following the Cloudbeds `DELETE` precedent (commit `7b7a3bc`), in its own commit. Wompi deactivates a link only with `PATCH`; the type is the whole change.
- The only new idea in the provider is choosing the base URL from call context (the public key's prefix), the way WooCommerce uses `ctx.storeUrl`.
- **Footprint:** one new folder, one line in `src/providers/index.ts`, and the `HttpMethod` line above.

**"Done" means:**

- The four tools are callable and absent from `tools/list`.
- Each Wompi response from the spike is covered by a fixture test.
- A Wompi error body containing a key never reaches an outcome or a log.
- `tsc`, Prettier and Vitest are green.

**Solo build**, under the fan-out threshold: two slices, about 10 files.

## Target tree

```
src/providers/
├── index.ts                         # MOD — import + one PROVIDERS entry
└── wompi/                           # NEW
    ├── auth.ts                      # NEW — bearer descriptor
    ├── context.ts                   # NEW — zod context { publicKey } + environmentOf(prefix)
    ├── manifest.ts                  # NEW — slug, connectionProbe, accountContextKeys
    ├── client.ts                    # NEW — base URL by key prefix; get/post/patch over the core request
    ├── errors.ts                    # NEW — unwrapWompi: status → ProviderErrorCode, never the body
    ├── tools.ts                     # NEW — 4 controlPlane tools
    ├── provider.ts                  # NEW — createWompiProvider / wompiProvider
    ├── index.ts                     # NEW
    ├── __fixtures__/                # NEW — api-contract §3
    └── __tests__/
        ├── errors.test.ts           # NEW — mapping + redaction
        └── wompi.test.ts            # NEW — tools against fakeFetch + conformance round trip
assets/wompi.svg                     # NEW — logo (.svg, or .webp; the PR template allows only these)
```

## Anchors (existing code read on `dev` @ `55f2cba`)

| Seam                        | File:line                                                                                     | Use                                   |
| :-------------------------- | :-------------------------------------------------------------------------------------------- | :------------------------------------ |
| Provider list               | `src/providers/index.ts:18-27` (`PROVIDERS`)                                                  | Add `wompiProvider`                   |
| Factory                     | `src/core/provider-factory.ts:11` (`ProviderSpec`), `:39` (`createProvider`)                  | Assemble                              |
| Bearer descriptor           | `src/core/provider-port.ts:39-60`; example `src/providers/cloudbeds/auth.ts:41-47`            | `wompiAuth`                           |
| Probe + account keys        | `src/core/provider-port.ts:176-179`, `:193`; example `src/providers/toteat/manifest.ts:18-33` | `wompiManifest`                       |
| `controlPlane`              | `src/core/tool.ts:107`; example `src/providers/toteat/tools.ts:148-169`                       | All four tools                        |
| Tool factory / outcomes     | `src/core/tool.ts:16,20` (`ok`, `err`), `:129` (`toolFactory`)                                | Tools                                 |
| Result mapping              | `src/protocol/result-mapping.ts:10-28`                                                        | `structuredContent` shape (no change) |
| Error codes                 | `src/core/errors.ts:6-15`                                                                     | Mapping                               |
| Client pattern              | `src/providers/toteat/client.ts:15,21,57-58`                                                  | `createWompiClient`                   |
| Per-call base URL precedent | `src/providers/woocommerce/client.ts:46-70`                                                   | Base URL from context                 |
| Error unwrap pattern        | `src/providers/toteat/errors.ts:120` (`unwrapToteat`)                                         | `unwrapWompi`                         |
| Core redaction (query only) | `src/core/http.ts:47`                                                                         | Reason for our own redaction          |
| Tests                       | `src/providers/toteat/__tests__/toteat.test.ts:19-35` (`CTX`, `fakeFetch`)                    | Same doubles                          |

## Per-file changes

| File / symbol                                                      | Kind | Signature                                                                                                                                                                                                   | Intent                                                                                                                               |
| :----------------------------------------------------------------- | :--- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| `wompi/auth.ts` `wompiAuth`                                        | NEW  | `ProviderAuthDescriptor`                                                                                                                                                                                    | Bearer, one field `private_key`, header, forwarded.                                                                                  |
| `wompi/context.ts` `wompiContext`, `WompiContext`, `environmentOf` | NEW  | `z.object({ publicKey }).strict()` (prefix regex) · `environmentOf(publicKey): 'sandbox' \| 'production'`                                                                                                   | Context; the environment is read from the key prefix (contract §0).                                                                  |
| `wompi/manifest.ts` `wompiManifest`                                | NEW  | `ProviderManifest`                                                                                                                                                                                          | `slug: 'wompi'`, `connectionProbe: { tool: 'mcp_wompi_check_credentials' }`, `accountContextKeys: ['publicKey']`.                    |
| `wompi/client.ts` `createWompiClient`, `WompiClient`               | NEW  | `createWompiClient(deps: { baseUrls?: { sandbox: string; production: string } }): WompiClient` with `get(path, request, ctx, params?)`, `post(path, request, ctx, body)`, `patch(path, request, ctx, body)` | Picks the base URL from the public key prefix (`environmentOf`).                                                                     |
| `wompi/errors.ts` `unwrapWompi`                                    | NEW  | `unwrapWompi(res: RequestResult, operation: string): Unwrapped`                                                                                                                                             | Status → `ProviderErrorCode` (contract §2); fixed own message; never reads `reason`/`messages` into the outcome.                     |
| `wompi/tools.ts` `buildWompiTools`                                 | NEW  | `buildWompiTools(client: WompiClient): ReadonlyArray<ToolDefinition<any, WompiContext>>`                                                                                                                    | The four tools of contract §1; `list_transactions` paginates at 200 and trims fields; `create_payment_link` builds the checkout URL. |
| `wompi/provider.ts` `createWompiProvider`, `wompiProvider`         | NEW  | `createWompiProvider(deps?: { fetchImpl?: FetchLike; baseUrls?: … }): IProvider`                                                                                                                            | `createProvider({ manifest, auth, metadataSchema: wompiContext, tools, fetchImpl })`.                                                |
| `src/providers/index.ts`                                           | MOD  | `PROVIDERS` (`:18-27`)                                                                                                                                                                                      | One import + one entry.                                                                                                              |

## Slices

| #   | Slice                                          | Owns                                                                                                                | Depends on | DoD                                                                                                                                                                                                             |
| :-- | :--------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ | :--------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Client, context, auth, errors (with redaction) | `auth.ts`, `context.ts`, `client.ts`, `errors.ts`, `__tests__/errors.test.ts`, error fixtures                       | —          | Tests: each status maps to its code; an error body carrying a fake key never appears in the outcome or the message; an unknown key prefix is refused without a fetch.                                           |
| A2  | Tools, manifest, provider, registration        | `tools.ts`, `manifest.ts`, `provider.ts`, `index.ts`, `src/providers/index.ts`, `__tests__/wompi.test.ts`, fixtures | A1         | Tests: request shapes (method, path, body, `Authorization`, base URL per environment); outcomes per contract; pagination stops at `total_results`; payer data dropped; the four tools absent from `tools/list`. |

- [ ] A1
- [ ] A2

### Test order (one red → green at a time)

**A1 — `errors.test.ts`, `client` cases**

1. `401` with `INVALID_ACCESS_TOKEN` → `PROVIDER_AUTH_EXPIRED`, message `Wompi <op> failed (HTTP 401)`.
2. **Redaction:** a `401` whose `reason` carries `prv_test_FAKEKEY` → neither the outcome nor the message contains it.
3. `422` (`INPUT_VALIDATION_ERROR`, and `UNPROCESSABLE` below the minimum) → `PROVIDER_INVALID_INPUT`, and the Spanish `reason` is not propagated.
4. `429` → `PROVIDER_RATE_LIMITED`; `5xx` and a network failure → `PROVIDER_UNAVAILABLE`.
5. A `2xx` with an unexpected shape → `PROVIDER_ERROR`.
6. Base URL: `pub_test_…` → `sandbox.wompi.co/v1`, `pub_prod_…` → `production.wompi.co/v1`; any other prefix → `PROVIDER_INVALID_INPUT` and **no fetch**.

**A2 — `wompi.test.ts`**

1. `mcp_wompi_check_credentials` → `GET /transactions?reference=xcale-connection-probe` with `Authorization: Bearer …`; `200 []` → `ok({ valid: true })`; `401` → `PROVIDER_AUTH_EXPIRED`.
2. `mcp_wompi_create_payment_link` → `POST /payment_links` with the exact body of contract §1.2 (`single_use: true`, `collect_shipping: false`); returns `linkId` and `url = https://checkout.wompi.co/l/{id}`; `description` empty → `PROVIDER_INVALID_INPUT` without a call.
3. `mcp_wompi_deactivate_payment_link` → `PATCH /payment_links/{id}` with `{ active: false }`. Needs `PATCH` in the core: added in the build branch as its own commit (see `work-log.md`).
4. `mcp_wompi_list_transactions` → date params + `page_size=200`; follows pages until `total_results`; an empty page with `meta: {}` (no count, as Wompi answers an empty window) is zero results, a page with rows and no count is `PROVIDER_ERROR`; stops with `PROVIDER_ERROR` past 50 pages; `untilDate <= fromDate` → `PROVIDER_INVALID_INPUT` without a call; drops payer fields (fixture has `customer_email`, the output has not).
5. **Conformance round trip:** `tools/list` lists none of the four; `tools/call` by name works for each; the auth-failure path returns `isError: true` with `PROVIDER_AUTH_EXPIRED`.
6. Registration: `wompiProvider` is in `PROVIDERS`; manifest probe and account keys as in contract §0.

### PR checklist mapping (`.github/pull_request_template.md`)

| Template box                                                                          | This change                                                                                                            |
| :------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------- |
| Only `src/providers/{slug}/`, tests, one line in `index.ts`, logo, own docs           | Yes                                                                                                                    |
| `identityPolicy` on tools that touch a person's records                               | None do (payer data dropped) → absent, justified in the feature design                                                 |
| Consumer registration data asked in a consumer issue                                  | matesjara/xcale-backend#1861 (feature design, "Consumer registration data")                                            |
| No `src/core`, `src/protocol` or `src/auth`, dependencies, contracts or consumer code | One core change: `'PATCH'` added to `HttpMethod`, following the Cloudbeds `DELETE` precedent (`7b7a3bc`); nothing else |
| No raw token persisted or logged; `reveal()` only at egress                           | Yes — the core materializes the bearer header; errors never echo bodies                                                |

## Test strategy

- Vitest with the toteat-style `fakeFetch` (records URL, method, headers and body) and fixtures from the spike.
- `CTX = { credential: { secret: new SecretString('prv_test_FAKE') }, metadata: { publicKey: 'pub_test_FAKE' } }`.
- Commands: `npm test`, `npm run typecheck`, Prettier check.
- Optional, after merge: `mcp-contract-qa` against `sandbox.wompi.co` with the Doppler sandbox keys (Mateo's personal sandbox account, approved 2026-10-22).

## Definition of done

- [ ] A1 and A2 ticked.
- [ ] `npm test` · `npm run typecheck` · Prettier green.
- [ ] Redaction test present and green.
- [ ] Conformance round trip (with the auth-failure path) green.
- [ ] Logo in `assets/`.
- [ ] PR to `dev` referencing #159 and epic matesjara/xcale-backend#1070, with the template's provider checklist filled.

## Risks

| Risk                                                 | Mitigation                                                                |
| :--------------------------------------------------- | :------------------------------------------------------------------------ |
| Key leak through a Wompi error body                  | Own messages only; dedicated test.                                        |
| A public key with an unknown prefix                  | Refused by the context schema (contract §0), no call.                     |
| A merchant with a huge window makes the listing loop | Hard cap of 50 pages → `PROVIDER_ERROR`; the consumer narrows the window. |
