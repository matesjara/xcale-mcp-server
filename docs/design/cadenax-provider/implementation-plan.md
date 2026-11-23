# Cadenax Provider — Implementation Plan

> **Design**: [`feature-design.md`](./feature-design.md) · **Issue**: `matesjara/xcale-mcp-server#56` (onboard Cadenax as an api_key provider) · **Epic**: `matesjara/xcale-backend#602` (Cadenax integration)
> **Last Updated**: 2026-11-23

## Meta-description

A self-contained provider at `src/providers/cadenax/`, built in three slices that each end in a PR to `dev`: the read-only provider (this plan's S1, built), the write tools (S2) and the sync pull (S3). Between S1 and the rest sits one gate that is not code: the first calls with a real development key, which turn the Documented facts of the design's §7 into an API contract.

There is no `api-contract.md` yet, on purpose: an unobserved wire fact defers the contract, it never enters it provisionally.

## Reality check — what was read

| What                          | Where                                                                                                                                  |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| Cadenax's shipped contract    | `CofinetCol/cofinet-backend` `main` at `bf7ce56`: PRD #399, PRs #400 and #411, ADR 0026 and 0027, the two xcale runbooks, the OpenAPI   |
| Cadenax's source              | `middleware/auth.ts`, `apiKeyPrincipalGuard.ts`, `idempotency.ts`, `routes/syncRoutes.ts`, `routes/userRoutes.ts`, `models/ApiKey.ts`, `services/apiKeyService.ts`, the lot, reservation, contract, company and contact controllers, `utils/domainErrorCodes.ts` |
| This server's patterns        | `providers/toteat`, `providers/cloudbeds/manifest.ts`, `providers/avirato`, `core/tool.ts`, `core/pagination.ts`, `core/http.ts`, `core/provider-factory.ts`, `core/provider-port.ts` |
| Not read, not called          | The live API. No key exists.                                                                                                            |

Two things the reading turned up that the plan depends on:

- `definePaginatedList` merges the pagination input into the tool's schema, and the merged object is not strict: an unknown argument on a search is dropped, not refused. An `office` argument therefore never reaches Cadenax either way; the test asserts the request, not the refusal.
- The core hands a provider at most 500 characters of a failure body, so `errors.ts` recovers the code and the sentence by pattern when the JSON arrives cut.

## Target file tree

```
src/providers/cadenax/
  manifest.ts        NEW  slug, category, versions, probe + context discovery
  auth.ts            NEW  api_key, header X-API-Key, forwarded
  context.ts         NEW  { office } — the connection's office code
  client.ts          NEW  GET with encoded path segments and a query
  errors.ts          NEW  the one unwrap; details.code + sentence; 401/403/423 mapping
  tools.ts           NEW  2 control-plane tools + 11 published reads
  provider.ts        NEW  factory with DI; default instance reads CADENAX_BASE_URL
  index.ts           NEW  re-exports
  __fixtures__/      NEW  Documented shapes, with a README saying so
  __tests__/         NEW  cadenax.test.ts, errors.test.ts
src/providers/index.ts   MODIFIED  one line
src/config.ts            MODIFIED  optional cadenaxBaseUrl
.env.example             MODIFIED  CADENAX_BASE_URL
docs/design/cadenax-provider/   NEW  feature-design.md, implementation-plan.md
```

Nothing under `src/core`, `src/protocol` or `src/auth`; no dependency; no shared test.

## Per-file changes

### `manifest.ts` — NEW

`cadenaxManifest`: `slug: 'cadenax'`, `category: 'trading'`, `schemaVersion: '2026-11-23'`, `providerVersion: '0.1.0'`, `connectionProbe: { tool: 'mcp_cadenax_whoami' }`, `contextDiscovery: { key: 'office', tool: 'mcp_cadenax_whoami', resultPath: 'assignedOffices.0.code' }`. No `logoUrl` (design R-4), no `accountContextKeys` (the one required context key is the identity).

### `auth.ts` — NEW

`cadenaxAuth`: `{ type: 'api_key', credentialDelivery: 'forwarded', fields: [{ key: 'X-API-Key', label: 'API key', placement: 'header' }] }`.

### `context.ts` — NEW

`cadenaxContext`: `z.object({ office }).strict()`, `office` a trimmed code matching `^[A-Za-z0-9_-]{1,32}$` — a value that cannot carry a second query parameter.

### `client.ts` — NEW

`createCadenaxClient({ baseUrl? })` → `{ get(segments, request, query?) }`. Each segment is `encodeURIComponent`-encoded; `undefined` query values are dropped. No auth, no state.

### `errors.ts` — NEW

- `cadenaxErrorCode(body)` — `details.code` when it is a machine word; a bare machine word in `error` otherwise.
- `cadenaxFailure(res, operation)` — `Cadenax <operation> failed (HTTP <status>[, <code>])[: <sentence>]`; `401` → `PROVIDER_AUTH_EXPIRED`, `403` and `423` → `PROVIDER_ERROR`, anything else the core's mapping. A sentence longer than 300 characters or naming a key is dropped.
- `unwrapCadenax(res, operation)` — the failure above, or the 2xx body untouched; a 2xx that is not an object is `PROVIDER_ERROR`.

### `tools.ts` — NEW

`buildCadenaxTools(client)`. Control plane: `whoami` (refuses a non-key profile and any office count but one), `resolve_staff_by_phone` (`404` → `{ found: false }`). Published, all `audience: 'operator'` and `readOnly: true`: the eleven reads of the design's §6.1; every client-record tool declares `identityPolicy: { mode: 'subject-scoped' }`. Ids are 24-hex strings; dates are real ISO calendar dates. A private `listPage` maps Cadenax's list envelope to the paginated helper's result.

### `provider.ts` / `index.ts` — NEW

`createCadenaxProvider({ fetchImpl?, baseUrl? })`; the default instance takes `cadenaxBaseUrl` from `loadConfig()`.

### `src/providers/index.ts`, `src/config.ts`, `.env.example` — MODIFIED

One registry line; one optional config field and its documented variable.

## Vertical slices

| Slice | Scope                                                                                                  | Issue                                                                                              | State                         |
| :---- | :----------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- | :---------------------------- |
| S1    | Everything above: auth, probe and discovery, staff lookup, eleven reads, tests, the two design docs    | `matesjara/xcale-mcp-server#56` (onboard Cadenax as an api_key provider)                            | Built; PR to `dev`            |
| S1.1  | First observed calls: recorded fixtures, corrections, `api-contract.md`                                | `matesjara/xcale-mcp-server#232` (first observed calls with a development key)                      | Waits on Mateo minting a key  |
| S2    | Write tools, acting for a named staff member, idempotent creates                                       | `matesjara/xcale-mcp-server#233` (Cadenax write tools)                                              | Parked: S1.1 and a CPO call   |
| S3    | The sync pull over `GET /sync/changes`                                                                 | `matesjara/xcale-mcp-server#234` (the sync cursor tool)                                             | Parked: S1.1 and a CTO call   |

Consumer side, in `xcale-backend`, as sub-issues of the epic: `#3931` (register Cadenax as a credential toolbox), `#3932` (closed-audience agents), `#3933` (writes from WhatsApp), `#3934` (lifecycle milestones and the forward window), `#3935` (Cadenax as a nightly sync source). Gateway before backend on every release.

## Delegation map

S1 is one builder in one worktree. S1.1 is one session with the key in its environment, reads only. S2 and S3 each start from their own design answer and go through `/implement` with `code-reviewer` and `mcp-contract-qa`.

## Definition of Done — S1

- [x] `src/providers/cadenax/` builds its provider with `createProvider`; no business logic, no consumer concept, no import from another provider.
- [x] Non-secret `api_key` descriptor, `forwarded`; a `connectionProbe`.
- [x] Tools namespaced `mcp_cadenax_{verb}` with zod inputs; consumer-only operations `controlPlane`; every client-record tool declares its `identityPolicy`; all published tools declare `audience` and `readOnly`.
- [x] `PROVIDER_AUTH_EXPIRED` only for a dead key; every call through the one unwrap; no key, URL or raw body in a message.
- [x] Registered in `PROVIDERS`; `schemaVersion` and `providerVersion` set.
- [x] Conformance, every error path, the office-scope and containment tests; `tsc`, Prettier and the full suite green; the catalog and `tools/list` through `scripts/contract-probe.mjs --provider cadenax`.
- [ ] **Fixtures are recordings** — not yet: they are Documented shapes, and the bad-token path against the live API was not run. Both are S1.1, and S1 does not go to `main` before it.
- [x] The footprint held; the consumer checklist filed as `matesjara/xcale-backend#3931`.
