# Wompi Provider (v1) — Feature Design

> **Feature**: Onboard Wompi as a credential provider (bearer, one secret) with four `controlPlane` tools that let a consumer create and deactivate single-use payment links and read the transactions that paid them.
> **Priority**: P1 High
> **Owner**: Sara
> **Status**: Draft
> **Target Release**: v1
> **Last Updated**: 2026-10-24
> **Issue**: matesjara/xcale-mcp-server#159 · **Epic**: matesjara/xcale-backend#1070 · **Consumer**: matesjara/xcale-backend#1861
> **Grill**: [`grill-notes.md`](./grill-notes.md) · **Evidence**: [`sandbox-evidence.md`](./sandbox-evidence.md)

---

> **Architectural guardrail (binding).** Provider Self-Containment: this feature touches
> `src/providers/wompi/`, its tests and fixtures, one line in `src/providers/index.ts`, its logo and these
> docs, plus one core change: adding `'PATCH'` to `HttpMethod` (`src/core/auth/http-request.ts`), following the Cloudbeds `DELETE` precedent (commit `7b7a3bc`).
> Wompi deactivates a link only with `PATCH` (verified, contract §1.3); the transport and the materializer
> already pass the method through, so the change is the type alone, in its own commit. Nothing else in
> `src/core|protocol|auth`.
>
> **Evidence before contract.** Every Wompi value in the contract was observed in the sandbox
> (`sandbox-evidence.md`). Production behaviour is assumed identical except the base URL, which is
> documented.

---

## 1. Problem Statement

### What's happening?

xcale's Payment Request layer (matesjara/xcale-backend#1068) lets a tenant's agent ask a buyer to pay and learn when it was paid, through a pluggable gateway port. Today the only gateway is a non-production fake. A tenant in Colombia cannot charge yet.

Wompi (Bancolombia) has the widest Colombian coverage at the lowest verified fee: card, PSE, Nequi, Daviplata and Bancolombia (transfer, QR, collect, BNPL). Its payment links are hosted checkout pages, so xcale never handles card data. The consumer needs four capabilities from Wompi, and none of them belongs in front of the agent.

### Who's affected?

- **The consumer (xcale-backend)**, which needs a stable, consumer-agnostic way to create links, deactivate them and read their transactions with the tenant's own credential.
- **Tenants with a Wompi account** (it requires a Bancolombia account), once the consumer ships.

### What's the cost of inaction?

The Payment Request layer stays unused, and the backend would have to hand-roll a Wompi HTTP client, breaking the default path for LATAM providers.

---

## 2. Goals & Success Metrics

### North Star

The consumer can create a single-use link, deactivate it and list its transactions against a tenant's Wompi account, sandbox or production, with no Wompi knowledge outside this provider and no credential ever leaking through an error.

| Type    | Metric                                                           | Target | How measured                                 |
| :------ | :--------------------------------------------------------------- | :----- | :------------------------------------------- |
| Leading | Tools callable against the Wompi sandbox                         | 4 of 4 | `mcp-contract-qa` against `sandbox.wompi.co` |
| Leading | Agent-visible Wompi tools                                        | 0      | `tools/list`                                 |
| Lagging | Wompi error bodies containing a key that reach a result or a log | 0      | Redaction test + log review                  |
| Lagging | Connection probe false negatives (valid key rejected)            | 0      | Consumer connect logs                        |

---

## 3. Target Users

### Consumer backend (xcale-backend)

- **Context**: its Wompi gateway adapter implements the Payment Request gateway port.
- **Motivation**: create, deactivate and reconcile links with the tenant's credential.
- **Pain today**: no Wompi provider.
- **Expected benefit**: four tools with stable shapes and stable error codes.

### Operator (xcale engineer)

- **Context**: debugging a tenant's payments.
- **Motivation**: clear failure codes, no secrets in logs.
- **Expected benefit**: `ProviderErrorCode` failures with own messages; Wompi bodies never echoed.

---

## 4. User Stories

### Must Have (P0)

- **US-01**: As the consumer, I want to prove a private key works at connect time, so a wrong key is refused before anything is stored.
- **US-02**: As the consumer, I want to create a single-use link for an exact amount, concept, expiry and my own reference, and get back its id and checkout URL.
- **US-03**: As the consumer, I want to deactivate a link, so it can no longer be paid.
- **US-04**: As the consumer, I want the transactions of a date range, so I can settle my links.
- **US-05**: As the consumer, I want sandbox and production to work from the same deployment, chosen per connection.
- **US-06**: As an operator, I want no Wompi error body in results or logs, because Wompi echoes the key.

### Should Have (P1)

- **US-07**: As the consumer, I want transactions without payer data, so I don't store personal data I don't need.

---

## 5. Feature Scope (MoSCoW)

### ✅ Must Have

- [ ] Auth descriptor: bearer, one secret (`private_key`), header (D-1).
- [ ] Context schema: `publicKey` only, with its `pub_test_` / `pub_prod_` prefix (D-2).
- [ ] Client: base URL from the public key prefix; an unknown prefix never reaches it (schema).
- [ ] Tools, all `controlPlane: true` (D-3): `mcp_wompi_check_credentials`, `mcp_wompi_create_payment_link`, `mcp_wompi_deactivate_payment_link`, `mcp_wompi_list_transactions`.
- [ ] Error mapping to `ProviderErrorCode` with own messages; never echo Wompi bodies (D-5).
- [ ] Transactions trimmed to settlement fields (D-7).
- [ ] Listing pagination with a hard cap: at most 50 pages (10,000 transactions) per call; beyond it, `PROVIDER_ERROR` ("window too large") so the consumer narrows the window instead of the provider looping unbounded.
- [ ] No `identityPolicy` on any tool: none returns or changes a person's records (payer data is dropped, D-7), which is what an absent policy declares (ADR 0019). No `audience` either: it classifies published tools, and these are all `controlPlane`.
- [ ] Fixtures from the sandbox spike (no keys, no personal data) and tests, including the conformance round trip (`tools/list` / `tools/call`, with the auth-failure path).
- [ ] Logo `assets/wompi.svg` (or `.webp`).

### 🟡 Should Have

- [ ] `mcp-contract-qa` run against the sandbox.

### ⛔ Won't Have

- **Webhook ingress and checksum verification** — the consumer's (xcale-backend). The provider never sees the events secret.
- **Minimum-amount enforcement** — the consumer's (D-6).
- **Agent-facing tools** — the agent charges through the consumer's tools (D-3).
- **Refunds, voids, tokenized charges, the embedded widget, the integrity signature** — not needed by links.
- **Listing links** — not supported with the private key (verified).
- **Multi-credential groups** — one secret is enough (D-1).

---

### Consumer registration data (asked for in matesjara/xcale-backend#1861)

Provider Self-Containment keeps the consumer's side to registration data. xcale-backend needs:

| Data                   | Value                                                                                            | Where in the consumer                                                        |
| :--------------------- | :----------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| Toolbox entry          | `slug: 'wompi'`, the MCP server URL, `accountKeyFields: ['publicKey']`                           | `mcpToolboxes` (`xcale-backend/src/modules/mcp/toolboxes.ts`, like `toteat`) |
| Context it must send   | `publicKey` (asked in the connect form); the environment is read from its prefix by the provider | The consumer's gateway connect extension (its own design)                    |
| Tools it calls by name | the four `mcp_wompi_*` tools                                                                     | The consumer's Wompi gateway adapter                                         |
| Errors it must handle  | `PROVIDER_AUTH_EXPIRED` → treat the credential as rejected; the rest per contract §2             | Same adapter                                                                 |

## 6. UX & Interaction Design

No end-user UI. The consumer calls the tools server-side. What a tenant sees (connect form, gateway card, pay button) is the consumer's design.

### 6.1 Discovery

`tools/list` shows **no** Wompi tool (all `controlPlane`). The provider still appears in the catalog with its auth descriptor, context schema and connection probe, so the consumer can generate its connect form: one secret field (private key) plus the required context (`publicKey`). Nothing else is asked: the environment comes from the public key's prefix.

### 6.2 Call outcomes

| Situation                                | Result                                                          |
| :--------------------------------------- | :-------------------------------------------------------------- |
| Success                                  | `structuredContent: { ok: true, data }`                         |
| Key rejected (401/403)                   | `{ ok: false, code: 'PROVIDER_AUTH_EXPIRED' }`, `isError: true` |
| Invalid input / business rejection (422) | `PROVIDER_INVALID_INPUT`                                        |
| Rate limited (429)                       | `PROVIDER_RATE_LIMITED`                                         |
| Wompi down / network                     | `PROVIDER_UNAVAILABLE`                                          |
| `publicKey` with an unknown prefix       | `PROVIDER_INVALID_INPUT` (no call made)                         |

---

## 7. Data Model Sketch

No storage: the provider is stateless.

```
Consumer ──callTool(token = private key, metadata = { publicKey })──▶ wompi provider ──HTTPS──▶ Wompi API
```

---

## 8. Architectural Decisions

| #    | Decision    | Choice                                                                                                                                   | Rationale                                                                                                                                                                    |
| :--- | :---------- | :--------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AD-1 | Auth        | `type: 'bearer'`, one field `private_key`, `placement: 'header'`, `credentialDelivery: 'forwarded'` (template `cloudbeds/auth.ts:41-47`) | Wompi uses `Authorization: Bearer <key>` (verified).                                                                                                                         |
| AD-2 | Environment | Base URL from the public key prefix (`pub_test_` → sandbox, `pub_prod_` → production), read in the provider                              | One deployment serves sandbox and production tenants (grill D-2). The prefix is Wompi knowledge, so it lives here, not in each consumer (changed 2026-10-22, pre-PR review). |
| AD-3 | Probe       | `GET /v1/transactions?reference=<fixed non-existent>`                                                                                    | Validates the private key, creates nothing, returns nothing personal (verified). `GET /merchants/{pub}` was rejected: public endpoint, returns personal data.                |
| AD-4 | Visibility  | All four tools `controlPlane: true`                                                                                                      | Agent must charge only through the consumer's guarded tools (grill D-3).                                                                                                     |
| AD-5 | Errors      | Status → `ProviderErrorCode`; message `Wompi <op> failed (HTTP n)`; body never propagated                                                | Wompi echoes the key (verified); the core only redacts query values (`src/core/http.ts:47`).                                                                                 |
| AD-6 | Listing     | Date-range listing, page size 200, paginate to the end; an empty window (`{ data: [], meta: {} }`, no count) is zero results             | The link filter is ignored (verified). Wompi omits `total_results` when the window is empty (verified).                                                                      |
| AD-7 | Link URL    | Built as `https://checkout.wompi.co/l/{id}`                                                                                              | Not in Wompi's response (verified; loads with 200).                                                                                                                          |

---

## 9. Risks & Open Questions

### Risks

| #   | Risk                                                                       | Likelihood        | Impact | Mitigation                                                                                             |
| :-- | :------------------------------------------------------------------------- | :---------------- | :----- | :----------------------------------------------------------------------------------------------------- |
| R-0 | A public key with an unknown prefix (or a private key pasted in its field) | Low               | Medium | Refused by the context schema before any call; the consumer's connect form shows the validation error. |
| R-1 | A Wompi error body leaks a tenant's private key into a result or a log     | High if unguarded | High   | AD-5; a test feeds an error body containing a key and asserts it never appears in the outcome.         |
| R-2 | Production behaves differently from sandbox                                | Low               | Medium | Same API documented; first production connection is watched; fixtures cover the shapes.                |
| R-3 | A busy merchant has many transactions per day and the listing is slow      | Medium            | Low    | Consumer passes a tight window (oldest pending charge); page size 200.                                 |
| R-4 | Wompi changes the listing API or starts honouring the link filter          | Low               | Low    | Filtering stays on the consumer side; extra results are harmless.                                      |

### Open Questions

| #   | Question                                           | Resolution                                                                                          |
| :-- | :------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| Q-1 | Account suspended: which status does Wompi return? | Not reproducible in sandbox. Assumed 401/403 → `PROVIDER_AUTH_EXPIRED`; revisit on first real case. |

---

## 10. Phasing & Roadmap

| Phase    | Scope              | Deliverables                                     | Depends on         | Effort |
| :------- | :----------------- | :----------------------------------------------- | :----------------- | :----- |
| v1       | This design        | Provider, tools, fixtures, tests                 | Nothing            | M      |
| Consumer | xcale-backend#1861 | Gateway adapter, connect form extension, webhook | v1 merged to `dev` | L      |

---

## 11. Agentic Context

| Module                         | Relationship | Key files                                                                            |
| :----------------------------- | :----------- | :----------------------------------------------------------------------------------- |
| Provider pattern               | Template     | `src/providers/toteat/` (client, errors, tools, manifest, provider, tests, fixtures) |
| Bearer auth                    | Template     | `src/providers/cloudbeds/auth.ts:41-47`                                              |
| Per-call base URL from context | Precedent    | `src/providers/woocommerce/client.ts:46-70`                                          |
| `controlPlane`                 | Mechanism    | `src/core/tool.ts:107`                                                               |
| Error codes                    | Mechanism    | `src/core/errors.ts:6-15`                                                            |
| Registration                   | One line     | `src/providers/index.ts:18-27`                                                       |

**Next**: [`api-contract.md`](./api-contract.md) → [`implementation-plan.md`](./implementation-plan.md) → build with `/tdd` → PR to `dev`.
