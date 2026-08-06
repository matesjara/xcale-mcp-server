# Toteat Provider — Feature Design

> **Provider**: Toteat — a LatAm restaurant POS. Slug `toteat`.
> **Consumer-side design**: `xcale-backend/docs/design/toteat-integration/` (issue #385)
> **Pinned vendor spec**: `xcale-backend/docs/vendors/toteat/spec/` (resolved 2026-08-01)
> **Owner**: JuanJo · **Status**: Draft
> **Last updated**: 2026-08-01

---

## 1. Problem statement

A restaurant's operating truth — menu, tables, shift, orders, sales, inventory, accounting — lives in
its POS. Toteat is one of the POS systems LatAm restaurants actually run, and it publishes a complete
REST API for all of it: 14 endpoints and 4 outbound webhooks.

This server's reason to exist is adapting exactly this class of provider. Toteat becomes the second
real provider (after Cloudbeds) and the **first credential-authenticated one**, which is what makes
it worth designing rather than typing.

## 2. Scope

**In:** all 14 endpoints as curated `mcp_toteat_*` tools; the `api_key` auth descriptor; the context
schema; provider-specific error shaping; positional-modifier order assembly; per-endpoint date-window
validation.

**Out — and this is deliberate:**

- **Webhook ingest.** Toteat POSTs to a URL; receiving it requires knowing which tenant a delivery
  belongs to, which is consumer knowledge. Webhooks land in xcale-backend. This server stays
  stateless (`soul.md` › complexity on demand) and has no inbound provider surface at all.
- **Menu caching.** A 3 req/min cap on `/products` forces a cache, and a cache is state. State
  belongs to the consumer, which already materializes catalogs in Mongo for Shopify. This server
  exposes the read; it does not remember it.
- **Rate-limit budgeting.** Same reason: a token bucket shared across concurrent conversations of one
  venue is stateful and per-tenant. The adapter surfaces `429` as a typed
  `PROVIDER_RATE_LIMITED`; the consumer decides how to degrade.
- **Idempotency of order creation.** A retried `POST /orders` is a duplicate plate. Deciding whether
  to retry needs the consumer's intent record. The adapter provides the two primitives that make the
  decision possible — create with a caller-supplied `orderReference`, and list open orders by
  reference — and takes no position on retrying.

Every one of these follows the same rule and it is worth stating once: **the adapter translates one
API; it remembers nothing and decides nothing.**

## 3. What the spec forces on this adapter

Verified against the pinned spec, not against the vendor's prose.

### 3.1 Auth: one secret, three identifiers, all in the query string

| Param | Kind | Where it comes from |
|:--|:--|:--|
| `xapitoken` | **secret** | the forwarded credential (`ctx.token`, a `SecretString`) |
| `xir` | identifier | `ctx.metadata.xir` |
| `xil` | identifier | `ctx.metadata.xil` |
| `xiu` | identifier | `ctx.metadata.xiu` |

This fits the existing machinery with **no change to `src/core`**: the `api_key` descriptor already
supports `placement: 'query'` for a single secret, and the metadata channel already carries
non-secret routing data (it is how Cloudbeds forwards `propertyID`).

Treating the three identifiers as secrets would have needed a multi-material credential, which does
not exist and is ADR-gated. Treating them as context is not a workaround — it is what they are.

### 3.2 The credential rides in the URL, and that breaks an assumption

`docs/security/credential-boundary-review.md` reasons about a credential in a **header**. Toteat is
the first provider where it is in the **URL**, and one concrete path in the shared transport leaks it:

```ts
// src/core/http.ts
} catch (e) {
  return { ..., body: e instanceof Error ? e.message : 'request failed' };
}
```

An undici fetch failure can carry the request URL in its message. That string becomes the tool's
error text, which reaches the consumer, the agent's prompt, and the end user's chat.

**Decision:** `sendRequest` redacts query-parameter values from any error text it produces. This is a
`src/core` change, so it breaks the golden rule of provider self-containment — knowingly. It is
justified because the control is **generic** (every future query-credential provider needs it) and
because the alternative — a provider-level sanitizer — would leave the same hole open for the next
provider that forgets. It is recorded here rather than hidden in a diff, and it extends the credential
boundary review with a new row: *URL as a credential surface*.

### 3.3 There is no `400`. Every error is `200` + `ok:false`, and "Not Authorized" is ambiguous

> **The pinned spec is wrong here, and so was the first draft of this design.** Verified against the
> live API on 2026-08-05; full evidence in
> `xcale-backend/docs/design/toteat-integration/spec-vs-reality.md`.

The spec documents `400 InvalidCredentials` with a root-level `{ texto }`. **That response does not
exist.** Observed: an invalid token, an invalid date, a bad window, an unknown order and a
nonexistent venue *all* return **HTTP `200`** with `ok: false`. The only real error status Toteat
emits is `429`.

So `mapHttpStatusToErrorCode` never fires for anything that matters, and a status-only client reports
a dead token as a successful call with `data: undefined`. The classification has to happen on the
**envelope** — the same shape of bug this repo already fixed for Cloudbeds.

Worse, the auth signal is not decisive. `GET /fiscaldocuments` with a **valid** token returns
`{"msg":{"texto":"Not Authorized","tipo":7},"ok":false}` — byte-identical to an invalid token —
because the venue's *Seguridad* tab does not allow-list that route. Mapping it to
`PROVIDER_AUTH_EXPIRED` would let one disabled route mark an entire healthy connection as expired.

**Decision:** `"Not Authorized"` maps to `PROVIDER_ERROR`. The adapter never declares a credential
dead, because deciding that needs a second call and this server is stateless. The consumer re-runs
the declared `connectionProbe` and decides. Full table in [`api-contract.md`](./api-contract.md) §6.

`tipo` is not a discriminator — `7` appears on both `"Not Authorized"` and `"INVALID ORDER NUMBER"`.

It lives in `errors.ts`, layered on the shared status map — the place the `add-provider` recipe
reserves for exactly this.

### 3.4 Modifiers are positional

Extras are sent as ordinary `line` entries and bind to the most recent non-modifier product above
them. Array order **is** the association: one position off puts the avocado on the wrong burger.

The tool's input is explicit and nested (`{ productCode, quantity, modifiers: [...] }`); the adapter
flattens it. The model never composes the flat array. `buildOrderLines` is a pure function and is the
first thing to receive mutation testing — moving a modifier by one position must turn a test red.

### 3.5 Date windows differ per endpoint, and cap at 15 days

`ini`/`end` vs `initial_date`/`final_date` vs `start_date`/`end_date`; `YYYYMMDD` vs `YYYY-MM-DD`.
Each path file is read individually — generalising here is how you ship a tool that always 400s.

Windows wider than 15 days are rejected **client-side, before the call**, because a rejected call
still consumed one of three requests in that minute.

### 3.6 Payments are create-time only

You cannot pay an open order through the API, nor pay items already on one. `pending: true` records a
fully detailed payment for the till to confirm. Order updates only append products, only on table
orders, and require the real `orderId` instead of `0`. The tool schemas encode these as separate
shapes rather than one permissive schema that fails at the provider.

### 3.7 Legacy vs migrated environments

Fields marked `*` in the schemas exist only on migrated environments, and `/orders/dispatch` is
Legacy-only today. The adapter returns what the provider returns; it does not synthesise absent
fields. Which generation a venue runs is the consumer's onboarding fact, not a branch in here.

The `*.appspot.com` hosts — **including the one in the spec's own `servers:` block** — are legacy and
return incomplete data. Base URL comes from config; a test asserts `appspot` never appears.

## 4. Tool surface

14 tools, `mcp_toteat_{verb}`, all with `.strict()` zod inputs. None of them accepts `xir`, `xil`,
`xiu` or any credential as an argument — those arrive as validated context.

| Tool | Endpoint | Limit |
|:--|:--|:--|
| `get_menu` | `GET /products` | 3/min |
| `get_tables` | `GET /tables` | 3/min |
| `get_shift_status` | `GET /shiftstatus` | 3/min |
| `create_order` | `POST /orders` | 1/s |
| `get_order_status` | `GET /orderstatus` | 10/s |
| `list_open_orders` | `GET /orderstatus?listing` | 10/s |
| `dispatch_order` | `POST /orders/dispatch` | — |
| `get_sales` | `GET /sales` | 3/min |
| `get_sales_by_waiter` | `GET /salesbywaiter` | 3/min |
| `get_collection` | `GET /collection` | 3/min |
| `get_cancellation_report` | `GET /orders/cancellation-report` | 3/min |
| `get_fiscal_documents` | `GET /fiscaldocuments` | 3/min |
| `get_inventory_state` | `GET /inventorystate` | 3/min |
| `get_accounting_movements` | `GET /accountingmovements` | 3/min |
| `create_purchase_movement` | `POST /purchasemovements` | 1/s |

`list_open_orders` is split from `get_order_status` even though both hit `/orderstatus`. They are
different questions with different inputs (`ic` vs `listing`), and a single tool with a mode flag
selects worse. It is also the primitive the consumer's idempotency reconciliation depends on — it is
how a caller finds out whether its `orderReference` already landed.

That is 15 tool names for 14 endpoints. The count in #385 refers to endpoints; the split is deliberate
and is the only place they diverge.

Signatures, inputs and result shapes: [`api-contract.md`](./api-contract.md).

## 5. Curation

The catalog publishes all 15 — consumer-agnostic means we do not pre-judge who needs what. Which of
them reach a customer-facing agent's basket is the consumer's curation decision, recorded in
`xcale-backend/docs/design/toteat-integration/feature-design.md` › D-8. Worth knowing here only so the
tool descriptions are written for both audiences: a diner-facing tool describes an action, an
owner-facing report describes a period.

## 6. Definition of done

- [ ] `src/providers/toteat/` implements `IProvider`; no business logic, no consumer concepts.
- [ ] `ProviderAuthDescriptor` is `api_key` with `xapitoken` at `placement: 'query'`; no secrets in
      the descriptor.
- [ ] `contextSchema` published from the zod metadata schema (`xir`, `xil`, `xiu`).
- [ ] `connectionProbe` declared in the manifest so a consumer can validate a credential generically.
- [ ] `ok: false` is treated as a failure at any HTTP status; date errors, rate limits and
      `"Not Authorized"` map to three distinct codes, and **none** of them is `PROVIDER_AUTH_EXPIRED`.
- [ ] `buildOrderLines` proven by mutation: a displaced modifier turns a test red.
- [ ] Date windows validated client-side per endpoint, with each endpoint's own parameter names and
      formats.
- [ ] **No `xapitoken` in any log, error message, or tool result** — including the transport failure
      path. Proven by a test.
- [ ] `server/discover` + `tools/list` + `tools/call` round trip proven against the sandbox, including
      the forced auth-failure path.
- [ ] One line in `src/providers/index.ts`; the only `src/core` change is the URL redaction of §3.2,
      documented above and in the credential boundary review.

## 7. Status of blockers

**Credentials: resolved 2026-08-05.** A production API entry on our own test venue
(`Api de pruebas XCALE NO TOCAR`), not the `apidev` sandbox. Config and test-venue values live in
Doppler `xcale-mcp-server` / `dev` (`TOTEAT_BASE_URL`, `TOTEAT_TEST_*`); shapes documented in
`.env.example`.

**Fixtures: recorded.** `__fixtures__/` carries four real responses (menu, tables, shift status, open
orders) and the six error shapes, all anonymized — no token, no real restaurant id, no venue name.
The adapter can be built and tested entirely offline.

Still open, none of which blocks building the adapter:

- **No write has ever been executed.** `POST /orders` and `POST /purchasemovements` are unverified.
  The venue has an open shift and live orders, so the first write needs explicit sign-off.
- **The venue's extras hierarchy is not wired**: 82 of 83 modifiers belong to categories no product
  references. The adapter is unaffected (it returns the provider's shape), but any consumer story
  about ordering with extras is blocked on POS configuration.
- `/fiscaldocuments` is not allow-listed in the venue's *Seguridad* tab.
- The four webhooks have never been pointed at a URL.
