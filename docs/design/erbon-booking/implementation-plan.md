# Erbon Booking Write-Path — Implementation Plan

> **Companion of**: [grill-notes.md](grill-notes.md), [api-contract.md](api-contract.md), ADR 0015 (fiscal-write-path), ADR 0013 (control-plane-tools)
> **Scope**: MCP side only — 3 `controlPlane` tools on the existing `erbon` provider. Backend write-safety is a separate phase.
> **Branch**: single `feat/erbon-read-only-provider` (read-only + booking together, by decision).
> **Last Updated**: 2026-09-28

## Meta-description

Add three **thin passthrough** (ADR 0015), **backend-only** (`controlPlane`, ADR 0013) tools to the existing `erbon` provider: `create_booking`, `search_guest`, `create_guest`. The only structural addition is a `post()` method on the Erbon client (today it is GET-only). No `manifest`/`auth`/`context`/`provider`/`index` change (the provider is already assembled and registered), **no `src/core` touch**, no change to `src/providers/index.ts`.

**Done** = `routableToolNames()` includes the three new tools; `listTools()` still returns only the four read menu tools (write tools withdrawn); `tsc` + full suite + prettier green; the money-guard/menu split test extended to the write tools. A **live** `create_booking` call is deliberately NOT part of the DoD (it is an un-cancellable sandbox write; capture its response shape once, out-of-band, then drop A.1's Inferred mark).

## Target File Tree

```
src/providers/erbon/
  client.ts                      MODIFIED  (+ post(path, request, ctx, body, headers?))
  tools.ts                       MODIFIED  (+ 3 controlPlane tools + guest input schemas)
  errors.ts                      UNCHANGED (context) — unwrapErbon reused
  __tests__/erbon.test.ts        MODIFIED  (+ write-path tests)
  manifest|auth|context|provider|index.ts   UNCHANGED (context)
src/core/**, src/providers/index.ts          UNCHANGED — no core touch, no re-registration
```

## Per-File Change Table (signatures + intent, no bodies)

| File | Symbol | Signature | Intent | Kind |
|:--|:--|:--|:--|:--|
| `client.ts` | `ErbonClient.post` | `post(path: string, request: AuthedRequest, ctx: ErbonContext, body: Record<string, unknown>, headers?: Record<string,string>): Promise<RequestResult>` | POST `${base}/hotel/{hotelID}[/path]` with `content-type: application/json` + JSON body; mirror `src/providers/toteat/client.ts:64` | MODIFIED |
| `tools.ts` | `guestRef` / booking input | zod schemas per api-contract §C.1–C.3 (`isoDate` reused) | Input contracts (single source of truth) | NEW (in file) |
| `tools.ts` | `mcp_erbon_create_booking` | `tool({ controlPlane: true, input, handler })` | thin passthrough → `client.post('booking/new', …, args)`; verbatim; `unwrapErbon('create booking')` | NEW |
| `tools.ts` | `mcp_erbon_search_guest` | `tool({ controlPlane: true, input, handler })` | `client.get('guest/search', …, { guestID?, documenttype?, documentnumber? })` (values in headers) | NEW |
| `tools.ts` | `mcp_erbon_create_guest` | `tool({ controlPlane: true, input, handler })` | `client.post('guest/new', …, args)`; verbatim | NEW |
| `__tests__/erbon.test.ts` | S5/S6 describes | — | body/headers built right; controlPlane split; error mapping | MODIFIED |

## Vertical Slices (continue numbering from read-only S1–S4)

**S5 — client POST + `create_booking`.** Add `client.post`; add the `create_booking` controlPlane tool (api-contract §C.1). Tests: builds `POST /hotel/{hotelID}/booking/new` with the JSON body; args validated (ISO dates, positive ids, `ratePrices`/`guests` non-empty); it is in `routableToolNames()` and NOT in `listTools()`.
_DoD:_ tsc + suite green; menu still 4; routable now includes `create_booking`.

**S6 — `search_guest` + `create_guest`.** Add both controlPlane tools (§C.2–C.3). Tests: `search_guest` puts `guestID`/`documenttype`/`documentnumber` in headers and requires one identifier (zod `refine`); `create_guest` POSTs `guest/new` with the body; both routable-not-listed.
_DoD:_ tsc + suite + prettier green; `routableToolNames()` = 4 reads’ names? no — 4 menu + `get_rate_prices` + 3 write = 8 routable, 4 listed; conformance still green.

## Test Strategy & DoD
- Unit (injected `fetchImpl`): assert POST method + URL + JSON body for `create_booking`/`create_guest`; header params for `search_guest`; verbatim passthrough; `unwrapErbon` mapping.
- **Guard test (extend the existing one):** `listTools()` has exactly the 4 read tools; `routableToolNames()` additionally has `get_rate_prices`, `create_booking`, `search_guest`, `create_guest`.
- `runProviderConformance` still green.
- Commands: `npx tsc --noEmit`, `npx vitest run`, `npx prettier --check`.
- **Not in DoD:** a live create. If we choose to capture the real response shape, do it once, deliberately, aware it leaves an un-cancellable sandbox booking.

## Delegation & Risks
- Solo build, 2 slices, ~2 files touched — well below fan-out threshold; no subagents, no sub-issues.
- **No `src/core` touch, no ADR** — the boundary is the existing ADR 0015 + 0013.
- Backend write-safety (availability guard, `voucher` idempotency, human-gated confirm) is out of scope — depends on backend `#1077`/`#1082`; tracked in mcp-server `#112`.
