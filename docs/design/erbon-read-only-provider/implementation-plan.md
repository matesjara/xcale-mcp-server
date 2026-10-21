# Erbon Read-Only (Quote) Provider — Implementation Plan

> **Companion of**: [feature-design.md](feature-design.md), [api-contract.md](api-contract.md), [grill-notes.md](grill-notes.md), [sandbox-evidence.md](sandbox-evidence.md)
> **Scope**: Slice 1 — the `erbon` MCP provider, read-only (5 tools). Backend (`erbon-stay-truth`, Rail A) and booking write are out of scope (separate phases).
> **Last Updated**: 2026-09-28
> **Language note**: English per this repo's `CLAUDE.md` (design docs are durable), matching `woocommerce-read-only-provider/implementation-plan.md`.

---

## Meta-description

This plan adds an `erbon` provider to the MCP server, read-only. The shape of the change is **one self-contained provider module + one registration line — and NO core touch**: Erbon's auth reuses the existing `credential_exchange` variant ([provider-port.ts:59-86](../../../src/core/provider-port.ts)) with `reference` delivery, exactly like Siigo, so nothing in `src/core|protocol|auth` moves. Provider Self-Containment is fully honored; **no ADR is required** (contrast WooCommerce, which needed a `basic` core variant).

The provider mirrors two templates:
- **Siigo** ([auth.ts](../../../src/providers/siigo/auth.ts), [tools.ts](../../../src/providers/siigo/tools.ts), `errors.ts`) — `credential_exchange` auth and flat-array verbatim read tools.
- **Toteat** ([provider.ts:22](../../../src/providers/toteat/provider.ts), [context.ts:17](../../../src/providers/toteat/context.ts), [client.ts:57](../../../src/providers/toteat/client.ts)) — a `metadataSchema` call-context (`hotelID`, like Toteat's `xir/xil/xiu`) and a client that reads `ctx` per call.

The one Erbon-specific divergence: **filter params travel in HTTP headers, not the query string** — so the client sets them on `RequestSpec.headers` (like Siigo's `Partner-Id`), not on a `URLSearchParams`.

The money guard (AD-2) is implemented with **`controlPlane: true`** on `get_rate_prices` ([tool.ts:86](../../../src/core/tool.ts)): `createProvider` filters `controlPlane` tools out of `listTools()` but keeps them in `routableToolNames()` ([provider-factory.ts:46-66](../../../src/core/provider-factory.ts)) — so the agent never sees the only money tool, while the backend can still call it by name.

**Done for the phase** = `server/discover` lists `erbon` with its `credential_exchange` authDescriptor + `contextSchema {hotelID}`; `tools/list` returns the **4** menu tools (NOT `get_rate_prices`); `routableToolNames()` includes all **5**; a `tools/call mcp_erbon_check_availability` runs end-to-end against the Erbon sandbox; a forced 401 returns `PROVIDER_AUTH_EXPIRED`; `tsc`/lint/tests green. Inferred shapes (`get_hotel`, `rateprices`) are confirmed against the sandbox before the `⏳` is removed.

> **MCP first, backend second** — the backend discovers the provider + authDescriptor from the MCP catalog, so the MCP ships first. This plan is the MCP half only.

---

## Target File Tree

```
src/
  providers/
    index.ts                          MODIFIED  (+1 line: erbonProvider in PROVIDERS)   [index.ts:9-17]
    erbon/                            NEW
      manifest.ts                     NEW  (slug 'erbon', category 'hospitality'; NO contextDiscovery/connectionProbe/accountContextKeys)
      auth.ts                         NEW  (credential_exchange + reference)
      context.ts                      NEW  (hotelID call-context schema → published as contextSchema)
      client.ts                       NEW  (thin HTTP client; params in HEADERS; path from ctx.hotelID)
      tools.ts                        NEW  (4 menu reads + get_rate_prices as controlPlane)
      errors.ts                       NEW  (Erbon error shaping; 401/403 → PROVIDER_AUTH_EXPIRED)
      provider.ts                     NEW  (createErbonProvider factory + default instance)
      index.ts                        NEW  (re-export barrel)
      __tests__/erbon.test.ts         NEW  (conformance + behavior + forced 401 + menu/routable split)
      __fixtures__/*.json             NEW  (recorded sandbox responses + hand-made rateprices)
  core/                               UNCHANGED (context) — no core touch; credential_exchange already exists
```

No `src/core|protocol|auth` files change. ~9 new files + 1 modified line.

---

## Per-File Change Table (executive level — signatures + intent, no bodies)

### Provider `src/providers/erbon/` (mirror Siigo auth + Toteat context)

| File | Symbol | Signature | Intent | Seam | Kind |
|:--|:--|:--|:--|:--|:--|
| `manifest.ts` | `erbonManifest` | `ProviderManifest` (`slug:'erbon'`, `displayName:'Erbon'`, `category:'hospitality'`, `schemaVersion`, `providerVersion:'0.1.0'`) | Identity. NO `contextDiscovery` (no listing endpoint), NO `connectionProbe` (mint-at-connect is the gate), NO `accountContextKeys` (default = `hotelID`) | published catalog entry | NEW |
| `auth.ts` | `erbonAuth` | `ProviderAuthDescriptor` = `credential_exchange` | `tokenEndpoint:'…/auth/login'`, `bodyFields:{username,password}`, `responseFields:{token:'bearerToken',expiry:'expirationUTCDate'}`, `credentialDelivery:'reference'`, `tokenPlacement:'bearer_header'` | reuses [provider-port.ts:59-86](../../../src/core/provider-port.ts) variant | NEW |
| `context.ts` | `erbonContext` / `ErbonContext` | `z.object({ hotelID: z.string().min(1) }).strict()` + `z.infer` | Per-call context, published as `contextSchema`; carried on `X-Provider-Metadata` | mirror [toteat/context.ts:17](../../../src/providers/toteat/context.ts) | NEW |
| `client.ts` | `createErbonClient(deps)` → `ErbonClient` | `get(path, request, ctx: ErbonContext, headers?: Record<string,string>): Promise<RequestResult>` | Builds `${baseUrl}/hotel/${ctx.hotelID}/${path}`; puts filter params in `RequestSpec.headers` (NOT query); never interpolates URL/body into errors | mirror [toteat/client.ts:57](../../../src/providers/toteat/client.ts) but header-based | NEW |
| `errors.ts` | `unwrapErbon(res, verb)` | `(RequestResult, string) => ToolOutcome` | 401/403 → `PROVIDER_AUTH_EXPIRED`; 429 → `PROVIDER_RATE_LIMITED`; else via `mapHttpStatusToErrorCode`; never leak `res.body` | mirror `siigo/errors.ts` (`unwrapSiigo`) | NEW |
| `tools.ts` | `buildErbonTools(client)` | `(client: ErbonClient) => ReadonlyArray<ToolDefinition<any, ErbonContext>>` | The 5 tools via `toolFactory<ErbonContext>()` ([tool.ts:102](../../../src/core/tool.ts)); each reads `ctx.metadata.hotelID`; returns `ok(array)` verbatim | mirror [siigo/tools.ts:142](../../../src/providers/siigo/tools.ts) (flat-array reads) | NEW |
| `provider.ts` | `createErbonProvider(deps?)` / `erbonProvider` | `(deps?:{fetchImpl?;baseUrl?}) => IProvider` calling `createProvider({ manifest, auth, metadataSchema: erbonContext, tools })` | Assembles the provider | mirror [toteat/provider.ts:22](../../../src/providers/toteat/provider.ts) | NEW |
| `index.ts` | re-export `erbonProvider` | — | Barrel | NEW |
| `src/providers/index.ts` | `PROVIDERS` | `erbonProvider,` array entry + import | The one registration line (Provider Self-Containment) | [index.ts:9-17](../../../src/providers/index.ts) | MODIFIED |

### The 5 tools (`tools.ts`) — each `mcp_erbon_{verb}`, input from api-contract §C, `ok(data)` verbatim

| Tool | `input` (zod) | Backs (via client) | `controlPlane` | Listed? |
|:--|:--|:--|:--:|:--:|
| `mcp_erbon_check_availability` | `{ checkinDate: string, checkoutDate: string }` | `GET availability` (headers `checkinDate`,`checkoutDate`) | — | ✅ menu |
| `mcp_erbon_list_room_types` | `{}` | `GET mapping/roomtype` | — | ✅ menu |
| `mcp_erbon_list_rates` | `{}` | `GET mapping/rates` | — | ✅ menu |
| `mcp_erbon_get_hotel` | `{}` | `GET /hotel/{hotelID}` | — | ✅ menu |
| `mcp_erbon_get_rate_prices` | `{ dateFrom: string, dateTo: string, idRate: number, idRoomType: number }` | `GET mapping/rateprices` (headers) | **`true`** | ❌ routable-only |

> No `requiredScopes` (Erbon has no scope model — omit, like Siigo). No `definePaginatedList` (Erbon reads return flat arrays → `ok(array)`, like `siigo/tools.ts` `refArrayTool`).

---

## Vertical Slices (ordered; solo build — under fan-out threshold)

**S1 — Foundation & discovery (scaffolding).** `manifest.ts`, `auth.ts`, `context.ts`, `errors.ts`, `client.ts`, `provider.ts`, `index.ts`, +1 line in `src/providers/index.ts`. `tools.ts` starts empty. 
_DoD:_ `server/discover` lists `erbon` with the `credential_exchange` authDescriptor + `contextSchema {hotelID}`; `npx tsc --noEmit` clean.

**S2 — The 4 menu reads.** `check_availability`, `list_room_types`, `list_rates`, `get_hotel` in `tools.ts` + client methods + recorded `__fixtures__/*.json` from the sandbox. 
_DoD:_ `tools/list` returns exactly these 4; unit tests (fixtures) green; `tools/call mcp_erbon_check_availability` green against the live sandbox.

**S3 — The money tool (backend-only).** `get_rate_prices` with `controlPlane: true` + hand-made `rateprices` fixture (sandbox empty). 
_DoD:_ `routableToolNames()` includes `mcp_erbon_get_rate_prices`; `listTools()` does NOT; a `tools/call` runs it (returns `[]` against sandbox, fixture in tests).

**S4 — Errors & conformance.** `unwrapErbon` mapping + the mandatory `runProviderConformance` suite + a forced-401 test. 
_DoD:_ conformance suite green; a 401 from `/auth`-expired token → `PROVIDER_AUTH_EXPIRED`; lint clean.

---

## Test Strategy & Definition of Done

- **Unit (deterministic):** inject `fetchImpl` (DI, [toteat/provider.ts:12](../../../src/providers/toteat/provider.ts)) with recorded `__fixtures__/`. Assert each tool returns the Erbon record **verbatim** and that `hotelID` from `ctx.metadata` lands in the path.
- **Menu/routable split:** assert `listTools().map(t=>t.name)` has the 4 and NOT `get_rate_prices`; assert `routableToolNames()` has all 5. (This is the AD-2 guard — test it explicitly.)
- **Conformance:** the shared `runProviderConformance` suite (as Siigo/Toteat run it).
- **Live round-trip:** `tools/call check_availability` against the sandbox (availability/room-types/rates live now; `rateprices` returns `[]` until Erbon seeds — do not gate on non-empty).
- **Phase DoD:** `npx tsc --noEmit` clean · `npm run lint` clean · `npm test` green · discover/list/call round-trip green · forced 401 → `PROVIDER_AUTH_EXPIRED`.

---

## Delegation & Risks

- **Solo build.** ~9 files, 4 sequential slices — **below** the fan-out threshold (>4 independent slices or >12 files). No subagents; no sub-issues (1:1:1, PD-1). One branch (`feat/erbon-read-only-provider`, already created off `dev`) → one PR to `dev`.
- **No core touch, no ADR** — if any slice reveals a need to touch `src/core|protocol|auth` (e.g. the header-param placement cannot be expressed via `RequestSpec.headers`), **stop and reopen an ADR** (guardrail). Not anticipated — `RequestSpec.headers` already exists (Siigo sets `Partner-Id`).
- **Inferred shapes** (`get_hotel` A.7, `rateprices` A.8): confirm against the sandbox on first touch; `rateprices` non-empty needs Erbon to seed prices (tracked, not a build blocker).
- **Backend flags** (expiry absolute-date parsing, `StayQuote` composition) are the **backend** phase's — this plan does not touch them.
