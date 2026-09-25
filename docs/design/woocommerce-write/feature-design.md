# WooCommerce Write Tools (Phase 2) — Feature Design

> **Feature**: Expose WRITE tools on the WooCommerce MCP provider — `update_product`, `update_stock`, `create_order` (+ a control-plane `reconcile_order`) — on top of the shipped read-only v1.
> **Priority**: P1 High
> **Owner**: Sara
> **Status**: Draft
> **Target**: Phase 2 — WooCommerce writes
> **Last Updated**: 2026-09-18
> **Language note**: English per the xcale-mcp-server repo rule (design docs are durable → English).

---

## 1. Problem Statement

### What's happening?

The WooCommerce MCP provider ships **read-only** today (9 read tools, HTTP Basic `consumer_key:consumer_secret`, SSRF-safe egress). A connected agent can *look at* a store — products, categories, shipping, orders — but cannot *act on it*. The two things a tenant most wants an agent to do are missing:

- **Manage the catalog**: the store owner wants the agent to update a product (price, status) and update its stock — routine upkeep the owner does by hand today.
- **Sell**: the customer-facing agent (over WhatsApp) cannot place an order for a buyer, so every conversation that reaches "I'll take it" dead-ends at a human.

WooCommerce would be the **second** write provider on the MCP (Toteat is the first, with `mcp_toteat_create_order`), so the write pattern already exists in code — this phase applies it, it does not invent it.

### Who's affected?

- **Store owner (tenant)** — does catalog edits manually; wants to delegate stock/price updates to the agent.
- **Buyer (end customer)** — the conversational sale can't be closed without a human stepping in to create the order.
- **xcale** — the WooCommerce integration stays "read-only demo" until it can transact.

### Cost of inaction

The provider can inform but never transact. The highest-value commerce action — creating an order from a conversation — is impossible, so WooCommerce stays a strictly worse integration than Toteat (which already sells).

---

## 2. Goals & Success Metrics

### North Star

A WooCommerce store, connected with a Read/Write key, lets its agent (a) keep the catalog current (update product + stock) and (b) place a real order for a buyer — safely, idempotently, and with all provider knowledge contained in `src/providers/woocommerce/`.

### Metrics

| Type | Metric | Target | How Measured |
|:--|:--|:--|:--|
| **Leading** | Write tools published | `update_product`, `update_stock`, `create_order` in `tools/list`; `reconcile_order` routable but withdrawn | Provider conformance + `listTools()` test |
| **Leading** | Provider Self-Containment held | All changes under `src/providers/woocommerce/` (+ the shared W4 egress fix) — no `src/core|protocol|auth` provider-specific code | Diff review |
| **Lagging** | Idempotency | A create whose response is lost is **recoverable** via the reconciliation tag — never a duplicate order | `create_order`/`reconcile_order` tests + write-S0 |
| **Lagging** | Write evidence | A real `update_product`/`update_stock` + a real `create_order` (with reconciliation) succeed against the live store | write-S0 evidence doc |

---

## 3. Target Users

### Store owner (tenant)

- **Context**: Manages catalog and inventory; connects WooCommerce for its agent.
- **Motivation**: Delegate routine edits (price, publish/draft, stock) to the agent.
- **Pain today**: Every edit is manual in wp-admin.
- **Benefit**: "Set the red shirt to 20% off / mark it out of stock" becomes an agent action.

### Buyer (end customer, via the tenant's agent)

- **Context**: Chats with the tenant's WhatsApp agent, decides to buy.
- **Motivation**: Complete the purchase in the conversation.
- **Pain today**: The agent can quote but not place the order.
- **Benefit**: The agent creates the order (through the backend checkout flow) and the sale closes.

---

## 4. User Stories

### Must Have (P0)

- **US-01**: As a store owner, I want the agent to **update a product** (price, status) so I don't edit wp-admin by hand.
- **US-02**: As a store owner, I want the agent to **update a product's stock** so inventory stays current.
- **US-03**: As a buyer, I want the agent to **create my order** so I can complete the purchase in chat.
- **US-04**: As the platform, I want `create_order` to be **idempotent under a lost response** so a retry never duplicates a buyer's order.

### Should Have (P1)

- **US-05**: As a store owner, I want a clear signal that **writes need a Read/Write key** so I connect with the right permission.

### Could Have (P2)

- **US-06**: As the platform, I want the write pattern to be **reusable** so the next write provider inherits it.

---

## 5. Feature Scope (MoSCoW)

### ✅ Must Have — Phase 2

- [ ] **W4 first (prerequisite)**: implement the redirect method/body downgrade in `safe-egress.ts` (303 → GET + drop body; 301/302 conventionally) and add `post`/`put` to the WooCommerce client (`createWoocommerceClient()` is GET-only today). No non-GET tool ships before this.
- [ ] `update_product` — PUT `products/{id}` (curated writable fields: price, status; the exact set defined in the API contract). Idempotent.
- [ ] `update_stock` — set stock for a product/variation (PUT with `stock_quantity`/`stock_status`). Idempotent.
- [ ] `create_order` — POST `orders`, following the **Toteat precedent**: a caller-supplied **reconciliation reference tag** embedded in the order's `meta_data`; **never a blind retry**.
- [ ] `reconcile_order` — **control-plane** (routable, withdrawn from `tools/list`): find an order by its reconciliation tag so the caller can learn whether a create landed before retrying.
- [ ] i18n / connect-instructions note: **selling needs a Read/Write key**.
- [ ] **Write-S0**: real write evidence against the live store before closing.

### 🟡 Should Have

- [ ] `update_order_status` (e.g. `processing → completed`, `cancel`) — if the checkout flow needs it in this phase; otherwise a fast-follow. Cancel is sensitive; gate decided by the backend, not here.

### 🔵 Could Have

- [ ] Publishing `create_customer` — only if it becomes a prerequisite of `create_order` (a non-fiscal write; may need a dedup read).

### ⛔ Won't Have — Out of Scope (with why)

- **Refunds / money movement** — refunds move money; same class as the prohibited financial actions. A human does that, not the agent.
- **Deletes (`delete_*`)** — irreversible; would need the intrinsic propose→confirm **Confirm signal**, not needed in v1.
- **Bulk write operations** — no batch endpoints in v1 (blast radius, partial failure).
- **A core destructiveness/confirmation flag on `ToolDefinition`** — gating lives in the backend (see AD-3); Toteat shipped writes without one.
- **The xcale-backend commerce-vertical integration for `create_order`** — a SEPARATE grill/phase (register on `commerce` + a `commerce/adapters/woocommerce/` adapter, like Toteat). This design is MCP-side only.

---

## 6. UX & Interaction Design

> The MCP has no UI; "UX" here is the tool contract the agent and the backend consume, plus the failure narratives.

### 6.1 Owner update (happy path)

The agent calls `update_product` / `update_stock` with the product id and the fields to change. The provider PUTs the change and returns the curated updated resource (`ToolOutcome.ok`). Because a PUT is idempotent, a repeat call with the same values is a no-op in effect — no special machinery.

### 6.2 Create order — the at-most-once narrative

1. The caller (the backend checkout) generates an **`orderReference`** (a unique marker for this attempt) and calls `create_order` with the line items + that reference.
2. The provider POSTs the order with the reference embedded in `meta_data`, and returns the created order.
3. **Lost response**: if the POST commits at WooCommerce but the response never arrives, the caller does **not** retry blind. It calls the control-plane **`reconcile_order`** with the same `orderReference`:
   - **Found** → the order already exists; return it (no duplicate).
   - **Not found** → safe to retry the create.

### 6.3 Failure states

| Situation | Result |
|:--|:--|
| Write with a Read-only key | WooCommerce `401 woocommerce_rest_cannot_edit` → `PROVIDER_AUTH_EXPIRED` → backend prompts **reconnect** (with a Read/Write key) |
| Invalid input (missing/typed wrong) | zod rejects before the call → `PROVIDER_INVALID_INPUT` |
| Provider 5xx / unreachable | `PROVIDER_UNAVAILABLE` (no auto-retry; consumer decides) |
| Rate limited | `PROVIDER_RATE_LIMITED` |

---

## 7. Data Model Sketch

No new entities in the MCP. The write tools operate on WooCommerce resources; the only novel datum is the reconciliation tag.

| Concept | Where it lives | Note |
|:--|:--|:--|
| `orderReference` (reconciliation reference tag) | Caller-supplied input to `create_order`; persisted in the WooCommerce order `meta_data` | The primary recovery key for the at-most-once create (CONTEXT.md: *Reconciliation reference tag*) |
| Curated writable product fields | `update_product` input (zod) | Single source of truth; generates the published schema |

```
create_order(input incl. orderReference) ──POST orders (meta_data: reference)──▶ WooCommerce order
reconcile_order(orderReference) ──GET orders?meta…──▶ the same order (recovery)
```

---

## 8. Architectural Decisions

| # | Decision | Choice | Rationale |
|:--|:--|:--|:--|
| AD-1 | Write pattern | **Follow the Toteat precedent** (first write provider) | Pattern already in code; consistency beats novelty |
| AD-2 | `create_order` idempotency | Caller-supplied `orderReference` in `meta_data` + control-plane `reconcile_order`; **no blind retry** | WooCommerce has no native idempotency key; this is the canonized recovery pattern |
| AD-3 | Risk signaling | **No new core flag**; gating in the backend (autonomy mode for updates, commerce adapter for `create_order`) | `ToolDefinition` has no such flag; Toteat shipped writes without one; consumer-agnostic + complexity-on-demand |
| AD-4 | Read/Write key | Discovered at first write; reconnect is the remedy (`401 → PROVIDER_AUTH_EXPIRED`); i18n note; probe stays a read | Verifying write at connect needs a side-effecting mutation; a distinct error code is over-engineering |
| AD-5 | Egress | **W4** (redirect method/body downgrade) is the first slice; client gains `post`/`put` | A manual redirect follow must downgrade correctly once a non-GET tool exists |
| AD-6 | Containment | All work under `src/providers/woocommerce/` (+ the shared `safe-egress.ts` W4 fix) | Provider Self-Containment |
| AD-7 | ADR | **None expected** | Follows the Toteat non-fiscal-write precedent; no new hard-to-reverse trade-off |

---

## 9. Risks & Open Questions

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|:--|:--|:--|:--|:--|
| R-1 | Duplicate order on a lost create response | Med | High | `orderReference` + `reconcile_order`; never retry blind (AD-2); write-S0 exercises it |
| R-2 | W4 correctness (method/body on redirect) once non-GET ships | Low | Med | W4 is the first slice with its own tests before any write tool |
| R-3 | Tenant connected in read-only v1 (Read key) hits write failures | Med | Low | Reconnect flow + i18n note that selling needs a Read/Write key |
| R-4 | WooCommerce `meta_data` query for `reconcile_order` is slow/awkward | Low | Med | Verify the exact query in the API contract against the live store (write-S0) |

### Open Questions

| # | Question | Needed By | Owner | Resolution |
|:--|:--|:--|:--|:--|
| Q-1 | Exact curated writable field set for `update_product` (price, status, …) | API contract | Sara | Pending — defined in the contract |
| Q-2 | Does `create_order` need `update_order_status` / `create_customer` in this phase? | API contract | Mateo/Sara | Pending — driven by the backend checkout's needs |
| Q-3 | Exact `reconcile_order` query (find by `meta_data` reference) | API contract | Sara | Pending — verify against the live store |

---

## 10. Phasing & Roadmap

| Phase | Scope Summary | Key Deliverables | Dependencies | Est. Effort |
|:--|:--|:--|:--|:--|
| **Phase 2 (this)** | WooCommerce write tools (MCP) | W4 + client post/put; `update_product`; `update_stock`; `create_order` + `reconcile_order`; i18n note; write-S0 | Read-only v1 (shipped) | M |
| **Next (backend)** | Commerce-vertical integration for `create_order` | `register-vertical-scopes` entry + `commerce/adapters/woocommerce/` (like Toteat) | This phase | M–L (own grill) |

---

## 11. Agentic Context

### Related Modules

| Module | Relationship | Key Files |
|:--|:--|:--|
| WooCommerce provider | Where all write tools live | `src/providers/woocommerce/{tools,client,provider,safe-egress}.ts` |
| Toteat provider | The write precedent to mirror | `src/providers/toteat/tools.ts` (`create_order`, reconcile control-plane, `orderReference`) |
| Core tool contract | `defineTool`/`toolFactory`, `ok`/`err`, `controlPlane` | `src/core/tool.ts` |
| Core transport | `sendRequest`, `mapHttpStatusToErrorCode` | `src/core/http.ts` |

### Conventions to Follow

- `defineTool` `input` (zod) is the single source of truth; no hand-written `inputSchema`.
- `controlPlane: true` withdraws `reconcile_order` from `tools/list` but keeps it routable.
- Typed results only (`ok`/`err` + `ProviderErrorCode`); never free-form error strings.
- Fidelity over Unification: `data` preserves WooCommerce semantics; only the envelope is standardized.
- Provider Self-Containment + Consumer-Agnostic: no consumer/tenant concepts on the wire.
- Every tool exercised by the mandatory `runProviderConformance` + fixtures; write-S0 for live evidence.

### Next Steps After Approval

1. **API Contract** → `/api-contract-authoring` (the write tool inputs, the reconciliation contract, the exact WooCommerce endpoints/fields, the `reconcile_order` query).
2. **Implementation Plan** → `/implementation-plan` (slices: W4 first, then updates, then create_order + reconcile).
3. **Build** → `/tdd`, slice by slice, against recorded fixtures + write-S0.
4. **Review** → `code-reviewer` (security lens on the write paths).
