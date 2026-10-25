# Wompi provider — work log

> Build journal for matesjara/xcale-mcp-server#159 on `feat/159-wompi-provider` (from `dev` @ `55f2cba`).
> Design: [`feature-design.md`](./feature-design.md) · [`api-contract.md`](./api-contract.md) ·
> [`implementation-plan.md`](./implementation-plan.md) (on `docs/159-wompi-provider`, PR #160).
> Each slice is built test-first (red → green, one behaviour at a time).

---

## Phase A1 — foundation: context, auth, client, errors

No tools yet. A1 builds the four pieces every tool in A2 stands on, so A2 only adds request shapes.

| Slice | What                                                                                                              | Files              | Tests                                         |
| :---- | :---------------------------------------------------------------------------------------------------------------- | :----------------- | :-------------------------------------------- |
| A1.1  | Call context: `publicKey` required, `environment` optional (`sandbox` \| `production`), strict                    | `wompi/context.ts` | `__tests__/context.test.ts`                   |
| A1.2  | Auth descriptor: bearer, one field `private_key`, header, reference                                               | `wompi/auth.ts`    | `__tests__/context.test.ts` (catalog surface) |
| A1.3  | Client: base URL chosen by `environment`; fails closed, without a request, when it is missing                     | `wompi/client.ts`  | `__tests__/client.test.ts`                    |
| A1.4  | Error unwrap: core status policy → own message; **never the Wompi body**; unexpected 2xx shape → `PROVIDER_ERROR` | `wompi/errors.ts`  | `__tests__/errors.test.ts`                    |

- [x] A1.1 · [x] A1.2 · [x] A1.3 · [x] A1.4 — 2026-10-22

#### What each slice proved

| Slice | Red → green                                                                                                                                                                                                                                                                                              | Tests |
| :---- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---- |
| A1.1  | Context accepts the public key with either environment; `environment` optional; refuses an empty public key, another environment and undeclared keys                                                                                                                                                     | 4     |
| A1.2  | The descriptor forwards one secret, the private key, as a bearer header                                                                                                                                                                                                                                  | 1     |
| A1.3  | Sandbox → `sandbox.wompi.co/v1`, production → `production.wompi.co/v1`, query kept; `post` sends JSON with its `content-type`; **no `environment` → `WompiEnvironmentMissing` and no request** (both methods). The first green had a `?? 'sandbox'` default on purpose; the fail-closed test removed it. | 5     |
| A1.4  | `401` → `PROVIDER_AUTH_EXPIRED` with our message; `422` → `PROVIDER_INVALID_INPUT` without Wompi's text; `429` / `5xx` keep the core's code; no response at all → "unreachable"; success unwraps Wompi's `{ data }`; a 2xx without it → `PROVIDER_ERROR`                                                 | 7     |

**Redaction guard checked against a mutant.** With the message changed to include the response body, the three error tests that carry a body failed; restored, they pass. The fake key in the test is visibly fake (`prv_test_FAKEKEY…`), never derived from a real one.

**Gate A1:** `npm run typecheck` clean · `npx vitest run` 651/651 (49 files) · Prettier clean.

### Decisions taken while building

- **Status → code comes from the core** (`mapHttpStatusToErrorCode`, `src/core/http.ts`), identical for every provider. The contract listed `404` as `PROVIDER_INVALID_INPUT`; the core maps it to `PROVIDER_ERROR`, and the core's policy wins ("share policies, not assumptions"). The contract table is corrected.
- **`res.body` is never read.** The core already trims and query-redacts it, but Wompi's JSON error repeats the key in a field (`reason`), which query redaction does not touch.

### Finding: Wompi deactivates links only with `PATCH` — resolved in this branch

The core transports `GET | POST | PUT | DELETE` (`src/core/auth/http-request.ts`, `HttpMethod`). Verified on 2026-10-22 against the sandbox:

| Call                                              | Result                           |
| :------------------------------------------------ | :------------------------------- |
| `PATCH /payment_links/{id}` `{ "active": false }` | `200`, `active: false` (spike)   |
| `PUT /payment_links/{id}` `{ "active": false }`   | `404` — the route does not exist |

So `mcp_wompi_deactivate_payment_link` needs `PATCH` in the core's `HttpMethod` — a change to `src/core`, outside Provider Self-Containment.

**How it ships (decided 2026-10-22):** in this branch, as **its own commit** (`470d1a0 feat(core): transport PATCH`), not a separate PR. Precedent: `DELETE` entered the core exactly this way, inside the Cloudbeds commit that needed it (`7b7a3bc`, "a generic HTTP verb the core already transports for every provider, not provider knowledge… argued in place"). A separate PR would have forced this branch to wait for its merge (no stacked PRs). The materializer (`authentication-materializer.ts:78`) and the transport (`http.ts:77`) pass the method through untouched, so the verb and its doc comment are the whole change.

- [x] Core: `PATCH` in `HttpMethod` (`470d1a0`).
- [x] Client: `patch()` — red → green → refactor (`post` and `patch` now share one JSON sender) (`fe7d162`). 2 tests; suite 653/653; `tsc` clean.
- [ ] **PR body must carry a "Touches the core" section**: the one-line change, the sandbox evidence (`PUT` 404 / `PATCH` 200), the `DELETE` precedent, and that it is isolated in `470d1a0` for review. The template's forbidden box is ticked with that justification (same as `7b7a3bc`, which had no separate ADR).

---

## Phase A2 — the four tools, the provider and its registration

Every test goes through `provider.callTool(…)` with a recording `fetch` double, so the request is checked
as the core's materializer really sends it (bearer header included), not as the client builds it.

| Slice | What                                                               | Files                                                                   | Behaviours (red → green, in order)                                                                                                                                                                                                                                                                  |
| :---- | :----------------------------------------------------------------- | :---------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A2.1  | Manifest, provider assembly, `mcp_wompi_check_credentials` (probe) | `manifest.ts`, `tools.ts`, `provider.ts`, `index.ts`                    | probe calls `GET /transactions?reference=xcale-connection-probe` with `Authorization: Bearer <private key>` → `{ valid: true }`; a rejected key → `PROVIDER_AUTH_EXPIRED`; no environment → `PROVIDER_INVALID_INPUT` and no request; catalog surface (manifest probe, account keys, context schema) |
| A2.2  | `mcp_wompi_create_payment_link`                                    | `tools.ts`                                                              | exact Wompi body (`single_use: true`, `collect_shipping: false`, `sku`); returns `linkId` + built checkout URL; empty `description` refused before any request; a `422` keeps our message                                                                                                           |
| A2.3  | `mcp_wompi_deactivate_payment_link`                                | `tools.ts`                                                              | `PATCH /payment_links/{id}` with `{ active: false }`; returns `{ linkId, active: false }`                                                                                                                                                                                                           |
| A2.4  | `mcp_wompi_list_transactions`                                      | `tools.ts`                                                              | date params + `page_size=200`; follows pages to `total_results`; `PROVIDER_ERROR` past 50 pages; `untilDate <= fromDate` refused before any request; payer data dropped                                                                                                                             |
| A2.5  | Registration, conformance, logo                                    | `src/providers/index.ts`, `assets/wompi.svg`, `__tests__/wompi.test.ts` | `wompiProvider` in `PROVIDERS`; `tools/list` publishes none of the four; each is callable by name; the repo-wide provider tests pass with Wompi registered                                                                                                                                          |

- [x] A2.1 · [x] A2.2 · [x] A2.3 · [x] A2.4 · [x] A2.5 — 2026-10-22

#### What each slice proved

| Slice | Red → green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Tests |
| :---- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :---- |
| A2.1  | The probe sends `GET sandbox.wompi.co/v1/transactions?reference=xcale-connection-probe` with `Authorization: Bearer <private key>` (as the materializer sends it) and answers `{ valid: true }`; Wompi's `401` → `PROVIDER_AUTH_EXPIRED`; a connection with no `environment` → `PROVIDER_INVALID_INPUT` with no request (`guarded` turns the client's `WompiEnvironmentMissing` into the typed error). Catalog: the context schema requires only `publicKey`, so the consumer's generated form never asks for `environment`; the manifest names its probe and `accountContextKeys: ['publicKey']` | 5     |
| A2.2  | Wompi receives exactly `{ name, description, single_use: true, collect_shipping: false, currency, amount_in_cents, expires_at, sku }`; the result is `{ linkId, url: https://checkout.wompi.co/l/{id}, expiresAt, active }` (Wompi returns no URL); an empty `description` is refused with no request; a `422` below the minimum keeps our message, not Wompi's text; a `2xx` whose link cannot be parsed is `PROVIDER_ERROR`, never "created"                                                                                                                                                    | 4     |
| A2.3  | `PATCH /payment_links/{id}` with `{ active: false }` → `{ linkId, active: false }`; if Wompi still reports the link active → `PROVIDER_ERROR` (the consumer must not stop watching a link that still takes payments); a `linkId` outside `[A-Za-z0-9_-]{1,64}` (`../transactions`, `a?b=1`, …) is refused before any path is built                                                                                                                                                                                                                                                                | 3     |
| A2.4  | Params `from_date`, `until_date`, `page=1`, `page_size=200`; each transaction comes back as `{ id, paymentLinkId, status, amountInCents, currency, createdAt, finalizedAt }` and the payer's email/name/phone never leave the provider; pages are read until `page × 200 ≥ total_results`; a window over 50 pages → `PROVIDER_ERROR` (`Wompi transaction window too large; narrow fromDate/untilDate`) with no partial list; `untilDate ≤ fromDate` → `PROVIDER_INVALID_INPUT` with no request                                                                                                    | 4     |
| A2.5  | `wompiProvider` registered in `PROVIDERS` (one line); `listTools()` is empty, yet each of the four tools is dispatched by name (never `PROVIDER_UNKNOWN_TOOL`); a rejected key → `PROVIDER_AUTH_EXPIRED` through the full call path; the repo-wide catalog, audience and parity tests pass with Wompi registered                                                                                                                                                                                                                                                                                  | 3     |

**Gate A2:** `npm run typecheck` clean · `npx vitest run` 673/673 (51 files) · Prettier clean on every touched file.

### Decisions taken while building A2

- **`unwrapWompi` now hands back `meta` next to `data`.** The listing needs Wompi's `meta.total_results` to know when to stop. The other tools ignore it. The A1.4 test now pins `meta` too.
- **The 50-page cap fails on the first page.** The contract says "at most 50 pages". `total_results` on page 1 already shows whether the window fits, so the tool refuses after **one** call instead of reading 49 pages it would throw away. Same outcome for the consumer, 49 fewer calls. The check runs on every page, so a total that grows while paginating is caught too.
- **The window check is a `.refine` on the input** (same pattern as Erbon's `checkOutDate > checkInDate`), so a bad window fails as `PROVIDER_INVALID_INPUT` in the core's validation, before the handler runs.
- ~~**Statuses parsed as Wompi's set**~~ — reversed in the pre-PR review: one unknown status made the whole window unreadable.
- **Payer data is dropped by the parse, not by a deny-list.** The zod schema names only the fields settlement needs; everything else Wompi returns (`customer_email`, `customer_data`, `billing_data`, `payment_method`) is stripped. A test pins that the fixture's fake email never appears in the result. So `identityPolicy` stays omitted.

### Open items (A2)

- [x] **Logo.** `assets/wompi.svg` is Wompi's official isotype, taken verbatim from the brand file Sara supplied (`Wompi_LogoSecundario.svg`, 1920×1080 with the full wordmark) and cropped to the 35×35 square tile every other provider logo uses, on the brand green `#B0F2AE`. The wordmark would be unreadable at that size. The placeholder from A2.5 is gone.
- [x] ~~`VOIDED` / `ERROR` not observed in the sandbox~~ — moot: `status` is now passed through as a string (see the review below).

---

## Pre-PR review — 2026-10-22

`/code-review` (10 findings, unverified by the reviewer) and a security review (no HIGH/MEDIUM findings: key never read from error bodies, fixed hosts, `linkId` regex, tools out of `tools/list`, payer data dropped, bounded loop, clean SVG, fake test keys).

| #   | Finding                                                                                                                     | Decision                                                                                                                                                                                                                                                                           |
| :-- | :-------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The probe proves the private key, not that `publicKey` belongs to the same merchant                                         | **Left as is (Sara, 2026-10-22).** Wompi's link response carries `merchant_public_key`, so a mismatch is detectable on the first charge; at connect time it would need another Wompi call. The consumer's own check (key prefixes agree, backend D-1) covers the environment half. |
| 2   | An open window shifts while it is read: a row can repeat on the next page                                                   | **Fixed.** Rows are keyed by `id`; test "returns each transaction once when a row shifts onto the next page". A row that slides past the cut-off is read by the consumer's next sweep.                                                                                             |
| 3   | Up to 50 sequential requests in one call                                                                                    | **Not changed.** The consumer's windows are bounded by the link expiry (hours); a merchant with thousands of transactions in that window is not today's problem. Parallel pages would be the fix if it becomes one.                                                                |
| 4   | The server could derive `environment` from the public key prefix (`pub_test_` / `pub_prod_`) instead of asking the consumer | **Done (Sara, 2026-10-22).** See "Environment from the key prefix" below.                                                                                                                                                                                                          |
| 5   | A strict `status` enum fails the whole listing on one unknown state                                                         | **Fixed.** `status` is a non-empty string; test "keeps listing when a transaction carries a status this provider does not know".                                                                                                                                                   |
| 6   | No pre-check for Wompi's COP 1.500 minimum or a past `expiresAt`                                                            | **Not changed.** The contract assigns the minimum to the consumer (it has the `below-gateway-minimum` state); Wompi's `422` maps to `PROVIDER_INVALID_INPUT`, which the consumer can act on.                                                                                       |
| 7   | The branch touches `src/core`                                                                                               | **Known and documented** (`470d1a0`, section above). The PR body carries "Touches the core".                                                                                                                                                                                       |
| 8   | The page schema parsed the unwrap result instead of Wompi's envelope                                                        | **Fixed.** It parses `{ data, meta }` explicitly.                                                                                                                                                                                                                                  |
| 9   | Not using the shared `paginationInput` / `buildPage` envelope                                                               | **Not changed.** That envelope is for agent-facing lists paged by the caller. This tool is control-plane and returns the whole window on purpose (contract §3.4): the consumer must never settle from one page.                                                                    |
| 10  | The cap is re-checked on every page, so a window that grows past it mid-walk is refused                                     | **Not changed.** Failing closed is the intent: a partial list is worse than none. It needs over 10,000 transactions in one window.                                                                                                                                                 |

After the fixes: `npx vitest run` 675/675 (51 files) — superseded by the next section · `npm run typecheck` clean · Prettier clean.

### Environment from the key prefix — 2026-10-22

Review finding 4, accepted by Sara. The context is now `{ publicKey }` only, and the schema admits `pub_test_…` and `pub_prod_…` (alphanumeric tail). `environmentOf(publicKey)` in `context.ts` picks the API; the client calls it. The consumer no longer maps prefixes.

- **Prefix checked against the real sandbox key** in Doppler (`xcale`/`dev`, `WOMPI_PUBLIC_KEY`) without printing it: `pub_test_` + 32 alphanumerics, matches the regex. `pub_prod_` is documented by Wompi, not observed.
- **Removed:** the optional `environment` field, `WompiEnvironmentMissing`, the `guarded` wrapper in `tools.ts` (handlers are plain `async` functions again), and the three client tests for a missing environment, which can no longer happen.
- **Added (red → green):** a sandbox and a production key route to their APIs (client and provider); a key with any other prefix (`pub_stg_`, a `prv_…` key in the public field, an empty tail, a space) is refused by the schema with no request; an `environment` key in the context is refused as undeclared; the catalog asks for `publicKey` only.
- **Docs branch updated** (`docs/159-wompi-provider`, PR #160, `5624b93`): contract §0/§2, feature design AD-2/R-0/consumer registration data, plan, grill D-2 (revised, original kept).

Review findings 3, 6, 9 and 10 stay as decided above: none is needed for correctness today, and each has its reason recorded.

**Gate:** `npx vitest run` 673/673 (51 files) · `npm run typecheck` clean · Prettier clean.

---

## Review fixes — 2026-10-24

From the independent review of #162, fixed on the branch instead of returning the PR.

- **An empty window is zero results, not an error.** Wompi answers an empty listing with `{ "data": [], "meta": {} }` (`sandbox-evidence.md`, the probe), with no `total_results`. The page schema required it, so a window with no transactions came back `PROVIDER_ERROR`. Now a missing count on an empty page reads as zero; a page with rows and no count stays an unexpected response, since it cannot say whether more pages follow. Tests (red → green on the first): "reads an empty window answered with no count as no transactions" and "refuses a page that carries transactions but no count".
- **The fixtures the contract lists now exist.** `probeEmpty.json` (the observed empty answer) feeds the probe test and the empty-window test; `errors/invalidAccessToken.json` (a `401` whose `reason` carries a fake key) feeds the rejected-key test, which now also asserts that none of the body reaches the outcome.
- **`origin/dev` merged in** (merge commit): the one conflict, `src/providers/index.ts`, keeps both `profitroomProvider` and `wompiProvider`.

**Gate:** `npx vitest run` 750/750 (54 files) · `npm run typecheck` clean · Prettier clean.
