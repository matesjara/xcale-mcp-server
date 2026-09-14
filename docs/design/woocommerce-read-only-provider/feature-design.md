# WooCommerce Read-Only Provider (v1) — Feature Design

> **Feature**: Onboard WooCommerce as an MCP provider (`api_key` / HTTP Basic / `forwarded`), read-only, with 5 curated tools, connected to xcale-backend via Rail A.
> **Priority**: P1 High
> **Owner**: Sara
> **Status**: Draft
> **Target Release**: v1 — Read-only slice
> **Last Updated**: 2026-09-14

---

> **Architectural guardrail (binding).** This design instantiates decisions already fixed in the grill and in ADR [basic-http-auth-scheme](../../adr/0018-basic-http-auth-scheme.md). The **only** concession to the core (`src/core`) is the `basic` auth variant, already justified in that ADR. If implementation surfaces a need for generic multi-secret support, a third scheme, or a WooCommerce-specific exception in the core, **stop and reopen the ADR** — do not absorb architecture into this feature.
>
> **Method principle behind read-first.** The first slice of an integration minimizes the irreversibility of the domain that consumes it: we validate the whole circuit (connect → catalog → call) on **reads** before enabling writes (Fase 2) or selling (Fase 3).

---

## 1. Problem Statement

### What's happening?

xcale can give the agent capabilities over external platforms cheaply when an MCP provider exists (Cloudbeds, Toteat, Siigo). But there is **no WooCommerce integration** today — the most common e-commerce platform among SMBs running their store on WordPress. A customer of one of those stores who writes over WhatsApp asking "do you have this shirt?", "how much is it?", "is it in stock?" gets no answer grounded in the real catalog, and the owner cannot check orders conversationally.

WooCommerce also brings a credential shape **no prior integration has**: two durable secrets (`consumer_key` + `consumer_secret`) used directly as **HTTP Basic** on every call, and a **per-store URL** (it is self-hosted), not a fixed central API.

### Who's affected?

- **LATAM e-commerce SMBs** selling on WooCommerce who want the agent to serve their catalog over WhatsApp.
- **The end customer** of those stores, who today cannot query products by chat.
- **The store owner**, who wants to check orders without opening the dashboard.
- **The agent**, which today has no capability over WooCommerce.

### What's the cost of inaction?

Without this, xcale is absent from a large segment of merchants (WooCommerce is dominant on WordPress), and loses the conversational hook of "the agent that actually knows your inventory".

---

## 2. Goals & Success Metrics

### North Star

A business with a WooCommerce store connects its keys once and, from then on, its agent answers real catalog and order questions with live store data.

### Metrics

| Type | Metric | Target | How Measured |
|:--|:--|:--|:--|
| **Leading** | End-to-end round trip proven against a test store | `discover` + `tools/list` + `tools/call` + 401 path green | Provider conformance suite |
| **Leading** | A real store connected without support | 1 dogfooding store connected | Rail A connection status |
| **Lagging** | Catalog questions answered by the agent with real data | > 0 conversations with a successful tool-call | Tool-execution logs |

---

## 3. Target Users

### End customer (buyer over WhatsApp)

- **Context**: Writes to the business line asking about products.
- **Motivation**: Know what's available, price, and stock, without browsing the web.
- **Pain Today**: The agent does not know the catalog; it answers generically or defers.
- **Expected Benefit**: Concrete catalog answers inside the conversation.

### Store owner / administrator

- **Context**: Connects the store in the dashboard; then queries the business.
- **Motivation**: See orders and status without opening the WooCommerce panel.
- **Pain Today**: Everything goes through the WordPress dashboard.
- **Expected Benefit**: Order lookups via the agent (a separate channel, identity proven by login).

---

## 4. User Stories

### Must Have (P0)

- **US-01**: As the owner, I want to connect my WooCommerce store by pasting URL + `consumer_key` + `consumer_secret` once, to enable the agent.
- **US-02**: As a customer, I want to ask about products (name, category, availability) and have the agent answer with real data.
- **US-03**: As a customer, I want a product's detail (price, stock, description) when I ask about one.
- **US-04**: As the owner, I want to query my orders (by status/date) and one order's detail.

### Should Have (P1) — Fase 2

- **US-05**: As the owner, I want to query my customers from the agent (with proven identity).
- **US-06**: As the owner, I want to adjust stock and change an order's status conversationally.

### Could Have (P2) — Fase 3

- **US-07**: As a customer, I want to build a purchase and have an order created in the store.

---

## 5. Feature Scope (MoSCoW)

### ✅ Must Have — v1 (Fase 1, read-only)

- [ ] `woocommerce` provider in the MCP (`src/providers/woocommerce/`) with the 5 read-only tools.
- [ ] `basic` auth variant in the core materializer (ADR [basic-http-auth-scheme](../../adr/0018-basic-http-auth-scheme.md)).
- [ ] `authDescriptor` declaring `basic` + a `contextSchema` carrying `storeUrl` as call context.
- [ ] Rail A connect path reusing `registerCredentialProvider` (`api_key` method): stores `ck`+`cs`, validates the URL, forwards `ck:cs`.
- [ ] Anti-SSRF validation of `storeUrl` at connect (require `https`, reject `localhost`/private IPs/non-public; normalize).
- [ ] `accountKey` = normalized store URL (multi-store).
- [ ] Error mapping: WooCommerce 401/403 → `PROVIDER_AUTH_EXPIRED` → reconnect via Rail A.

### 🟡 Should Have — Fase 2

- [ ] Write tools: `update_inventory`, `update_order_status`.
- [ ] Customer tools: `list_customers`, `get_customer` (PII — once there is a clear use case).
- [ ] Variations (size/color) as separate tools, as in the documentation (in v1 they live inside `get_product`).

### 🔵 Could Have — Fase 3

- [ ] Conversational selling (create a purchase order).

### ⛔ Won't Have — Explicit Out of Scope

- **Selling / order creation / payments** in v1 — that is Fase 3, and it goes through a **WooCommerce materialization adapter in the Commerce vertical** (with its own idempotency, confirmation gate, checkout handoff), NOT as a standalone tool. It gets its own grill + feature design in `xcale-backend`.
- **Customer PII** in v1 — with no use case, `list_customers` is not brought in.
- **Generic multi-secret / imperative scheme (HMAC)** — out; the core only gains `basic` over a single composed secret (ADR).
- **WooCommerce `wc-auth` OAuth flow** — v1 uses manual key entry (simpler and more robust).

---

## 6. UX & Interaction Design

> This feature has no complex new screens: its UX is (a) the **connect** flow in the dashboard and (b) the agent's **conversational behavior**.

### 6.1 Connect flow (dashboard, owner)

**Entry Point**: In the dashboard's integrations catalog, the owner sees "WooCommerce" (discovered from the MCP catalog) and clicks **Connect**.

**Form Structure**: The backend, via its `connect-descriptor`, requests three fields: **Store URL**, **Consumer Key**, **Consumer Secret**. The description guides the owner to generate the key in *WooCommerce → Settings → Advanced → REST API → Add key* with **Read** permission for v1.

**Validation**: On submit, Rail A validates `storeUrl` (`https`, real public domain, normalization). On failure, an actionable error is shown ("URL must be https and a public domain"). The keys are tried with a cheap read call before marking the connection connected — **green means verified, not assumed** (WhatsApp rail precedent).

**Submit**: On success the connection is `connected`, `accountKey` = normalized URL, and the agent sees the tools. The owner **never re-enters** URL or keys.

**Error Handling**: Invalid key → reconnect message; the raw provider message and the keys are never leaked.

### 6.2 Conversational behavior (customer over WhatsApp)

The customer asks "do you have black shirts?"; the agent picks `list_products` (with a filter), gets the result, and answers in natural language with names, prices, and availability. For "how much is X?" it uses `get_product`. The customer never sees tools, URLs, or keys.

### 6.3 Key states

| Interaction | Trigger | Behavior |
|:--|:--|:--|
| Successful connect | Submit a valid form | `connected` badge; tools available to the agent |
| Revoked key | 401/403 on a call | `PROVIDER_AUTH_EXPIRED` → Rail A marks the connection and prompts reconnect |
| Invalid URL | Submit `http`/localhost/private IP | Rejected with an actionable error; nothing is stored |

### 6.4 Notifications & Feedback

Reconnect-required is surfaced by Rail A's generic mechanism (`markConnectionAuthFailure` + `reconnectRequiredResult`). No feature-specific notifications.

---

## 7. Data Model Sketch

> No new domain entities. It reuses Rail A's `Connection` and the MCP provider model.

### Provider (MCP) — `authDescriptor` (shape)

| Field | Type | Description |
|:--|:--|:--|
| `type` | `'basic'` | New scheme declared by WooCommerce (ADR) |
| `credentialDelivery` | `'forwarded'` | Credential travels per call and is discarded |
| `contextSchema` | JSON Schema | Publishes `storeUrl` as required call context |

### Connection (Rail A) — relevant fields

| Field | Type | Description |
|:--|:--|:--|
| `provider` | `'woocommerce'` | Provider slug |
| `accountKey` | string | Normalized store URL (account identity) |
| `credentialSecret` | encrypted JSON | `{ consumer_key, consumer_secret }` encrypted at rest |
| `metadata.storeUrl` | string | Validated URL; forwarded as `X-Provider-Metadata` per call |

### Relationships

```
User (tenant) ──has many──▶ Connection (provider='woocommerce', keyed by accountKey=storeUrl)
Connection ──resolves to──▶ ResolvedCredential (secret = "ck:cs", forwarded)
MCP provider ──reads──▶ storeUrl (context) + Authorization: Basic base64(secret)
```

### State (connection)

```
disconnected ──connect (validate URL + test key)──▶ connected
connected ──401/403 on a call──▶ auth_failed ──reconnect──▶ connected
```

---

## 8. Architectural Decisions

| # | Decision | Choice | Rationale |
|:--|:--|:--|:--|
| AD-1 | Provider pattern | Thin adapter via canonical helpers (`defineTool`/`createProvider`) | `add-provider` recipe; no business logic |
| AD-2 | Auth scheme | HTTP Basic (`basic`), composed secret `ck:cs` | ADR [basic-http-auth-scheme](../../adr/0018-basic-http-auth-scheme.md); provider knowledge stays in the MCP |
| AD-3 | Credential delivery | `forwarded` | Standard-risk, like Toteat/Shopify; not financial |
| AD-4 | Store URL | Call context (`contextSchema`), anti-SSRF validated at connect | WooCommerce is self-hosted; base URL is per-store |
| AD-5 | Account identity | `accountKey` = normalized URL | Multi-store first-class; avoids cross-catalog leak |
| AD-6 | Backend connect | Reuse `registerCredentialProvider` (`api_key` method) | Existing rail (Shopify-token/Toteat precedent); no new rail |
| AD-7 | Error mapping | 401/403 → `PROVIDER_AUTH_EXPIRED` | Typed error contract; triggers reconnect in Rail A |
| AD-8 | Credential posture | **Read-only** key in v1 | v1 only reads; minimal surface if leaked |
| AD-9 | Pagination | `definePaginatedList` (uniform result) | Consistency with the tool catalog |

---

## 9. Risks & Open Questions

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|:--|:--|:--|:--|:--|
| R-1 | SSRF via tenant-supplied `storeUrl` | Med | High | Validate at connect: `https`, block `localhost`/private IPs/non-public; normalize; the MCP only builds routes over that base |
| R-2 | Durable forwarded credential (does not expire) | Med | Med | Read-only key in v1; revoke + reconnect if leaked |
| R-3 | Some hosts strip the `Authorization` header | Med | Med | WooCommerce supports a query-param fallback (`consumer_key`/`consumer_secret`); evaluate during implementation (see Q-1) |
| R-4 | Version/route differences across stores | Low | Med | Pin `wc/v3`; test against a test store |
| R-5 | Base64 is not encryption | Low | High | `https` mandatory (ties to R-1); never interpolate the URL/credential into logs or errors |

### Open Questions

| # | Question | Needed By | Owner | Resolution |
|:--|:--|:--|:--|:--|
| Q-1 | Do we need the query-param fallback for hosts that strip the `Authorization` header? | Implementation | Sara | Pending — decide against the test store; if the Basic header works, keep the header |
| Q-2 | How does the frontend collect the 3 connect fields? | API contract | Sara | Pending — driven by the backend `connect-descriptor` |
| Q-3 | A `contextDiscovery` to auto-resolve something post-connect, or everything pasted? | API contract | Sara | Pending — likely everything pasted (the owner provides `storeUrl`) |

---

## 10. Phasing & Roadmap

| Phase | Scope Summary | Key Deliverables | Dependencies | Est. Effort |
|:--|:--|:--|:--|:--|
| **v1 (Fase 1)** | Read-only | WooCommerce provider (5 tools) + `basic` scheme (MCP) + Rail A connect + URL validation (backend) | ADR `basic-http-auth-scheme` | L |
| **Fase 2** | Writes + customers | `update_inventory`, `update_order_status`, `list_customers`/`get_customer`, split variations | v1 in production and proven | M |
| **Fase 3** | Selling | WooCommerce adapter in the **Commerce vertical** (idempotency, confirmation, checkout, webhooks) | Own grill + feature design in `xcale-backend` | XL |

---

## 11. Agentic Context

### Related Modules

| Module | Relationship | Key Files |
|:--|:--|:--|
| MCP providers | New provider, sibling of Toteat/Siigo | `xcale-mcp-server/src/providers/woocommerce/` |
| MCP core auth | Gains the `basic` variant (additive) | `xcale-mcp-server/src/core/auth/authentication-materializer.ts`, `src/core/provider-port.ts` |
| Rail A (connections) | `api_key` connect path + forwarding | `xcale-backend/src/modules/connections/` (`credential-registry.ts`, `connect-descriptor.ts`) |

### Codebase Entry Points

- **MCP provider**: `xcale-mcp-server/src/providers/woocommerce/` (`manifest.ts`, `auth.ts`, `client.ts`, `tools.ts`, `errors.ts`, `provider.ts`, `index.ts`), + 1 line in `src/providers/index.ts`.
- **MCP core**: `basic` branch in `authentication-materializer.ts`; variant in `provider-port.ts`.
- **Backend**: `registerCredentialProvider` for `woocommerce` + `storeUrl` validation.

### Conventions to Follow

- Thin adapter: no business logic, no consumer concepts (Consumer-Agnostic).
- Credential via `SecretString`; `.reveal()` only at egress; never persist/log.
- Typed errors; 401/403 → `PROVIDER_AUTH_EXPIRED`; never interpolate `res.body`/URL into messages.
- Tools namespaced `mcp_woocommerce_{verb}`, zod input as the single source of truth.

### Next Steps After Approval

1. **API Contract** → `/api-contract-authoring` with this feature design as input (lands at `docs/design/woocommerce-read-only-provider/api-contract.md`).
2. **Implementation** → MCP first (provider + `basic`), backend second (Rail A connect).
