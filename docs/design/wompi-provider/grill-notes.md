# Wompi — grill notes (provider)

- **Status:** resolved for the provider. The consumer half (connect form, webhook ingress, settlement,
  Sweep, owner notices, dashboard card) gets its own grill in `xcale-backend`.
- **Date:** 2026-10-21 / 2026-10-22
- **Code target repo:** `xcale-mcp-server` (this provider). Consumer: `xcale-backend` Payment Request layer
  (matesjara/xcale-backend#1068, PRs #1662 / #1681).
- **Issue:** matesjara/xcale-mcp-server#159 · **Epic:** matesjara/xcale-backend#1070
- **Evidence:** [`sandbox-evidence.md`](./sandbox-evidence.md) (sandbox spike, 2026-10-21/22).

> Wompi (Bancolombia's payment gateway) is the first real Payment Gateway on xcale's Payment Request
> layer. A tenant connects its own Wompi account; its agent asks the buyer to pay through a Wompi payment
> link; xcale learns when it was paid. This provider is how xcale talks to Wompi's API.

---

## 1. Recon findings (verified in code)

1. **The backend already calls MCP tools outside the agent.** `ToteatMcpCaller`
   (`xcale-backend/src/modules/toteat/toteat-mcp.caller.ts:77-145`) is the template: it resolves the
   Connection, decrypts the token, projects the declared context and calls `client.callTool`.
2. **`controlPlane: true` already hides a tool from the agent** while the backend can still call it
   (`src/core/tool.ts:107`; dropped from `tools/list` in `src/core/provider-factory.ts:42-47`). Used by
   Cloudbeds, Erbon, Lobbypms, Toteat and WooCommerce. This closes the consumer's open question "the agent
   must not see raw Wompi tools" without anything new (no `_meta` audience reading).
3. **A credential provider forwards exactly one secret** unless it uses the multi-credential groups of
   ADR `himed-multi-credential-provider` (now on `dev`, merged with #125).
4. **No provider picks its base URL per connection.** Base URLs are per deployment (`toteat/client.ts:57-58`,
   HiMed via `loadConfig()`). The only per-call base is WooCommerce's `ctx.storeUrl`
   (`woocommerce/client.ts:46-70`), which comes from the call context.
5. **The core only redacts query values in upstream error bodies** (`src/core/http.ts:47`
   `redactQueryValues`), not JSON fields.
6. **Errors use the core's codes** (`src/core/errors.ts:6-15` `ProviderErrorCode`).

## 2. Decisions

| #   | Question                                      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                | Rejected                                                                                                                                                                                                                  |
| :-- | :-------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-1 | Which secret does the provider receive?       | **Only the private key** (`prv_test_…` / `prv_prod_…`), bearer, in the `Authorization` header. The public key is non-secret call context (`publicKey`). The events secret is the consumer's alone (it verifies the webhook in the backend) and **never reaches the provider**. The integrity secret is not needed (verified: links are created without it).                                                             | Multi-credential groups (would forward the events secret for nothing — least privilege).                                                                                                                                  |
| D-2 | Sandbox or production?                        | **Revised 2026-10-22 (pre-PR review, Sara):** the provider reads it from the **public** key's prefix (`pub_test_` → `https://sandbox.wompi.co/v1`, `pub_prod_` → `https://production.wompi.co/v1`); the context schema admits only those two prefixes. _Originally:_ an optional `ctx.metadata.environment` the consumer derived from the prefixes — replaced because it made every consumer replicate Wompi knowledge. | A per-deployment base URL (one deployment serves tenants in both environments); inspecting the **private** key (the core materializes the secret; tools never see it) — the public key is context, so reading it is fine. |
| D-3 | Which tools, and who sees them?               | Four tools, **all `controlPlane: true`**: `mcp_wompi_check_credentials` (connection probe), `mcp_wompi_create_payment_link`, `mcp_wompi_deactivate_payment_link`, `mcp_wompi_list_transactions`. The agent charges only through the consumer's `payment_request_*` tools, which apply the Charge Ceiling, provenance and approval.                                                                                      | Exposing raw tools to the agent (bypasses the ceiling).                                                                                                                                                                   |
| D-4 | How are a link's transactions found?          | `mcp_wompi_list_transactions(fromDate, untilDate)` lists by date range, paginating to the end (page size 200). The consumer filters by link. Verified: Wompi's `payment_link_id` query filter is **ignored**, and lookup by `reference` needs the exact reference, unknown before payment.                                                                                                                              | A per-link lookup (not supported by the API).                                                                                                                                                                             |
| D-5 | Errors                                        | Map HTTP status to `ProviderErrorCode`: 401/403 → `PROVIDER_AUTH_EXPIRED`; 422 → `PROVIDER_INVALID_INPUT`; 429 → `PROVIDER_RATE_LIMITED`; 5xx / network → `PROVIDER_UNAVAILABLE`. **Never echo Wompi's error body**: it repeats the key it received (verified). The message is our own: `Wompi <operation> failed (HTTP n)`.                                                                                            | Passing Wompi's message through (leaks the key into logs and the consumer).                                                                                                                                               |
| D-6 | Minimum amount                                | The provider does **not** enforce it. Wompi rejects below COP 1.500 with a `422` and a free-text reason (no code). The consumer checks its known minimum before calling and owns the agent-facing reason (`below-gateway-minimum`). The provider maps the `422` to `PROVIDER_INVALID_INPUT` like any other.                                                                                                             | Parsing Wompi's Spanish text to detect the minimum (fragile).                                                                                                                                                             |
| D-7 | What the provider returns about a transaction | Only what settlement needs: id, link id, status, amount, currency, created/finalized timestamps. **No payer data** (`customer_email`, `customer_data`, `billing_data`, `payment_method`).                                                                                                                                                                                                                               | Returning the raw transaction (personal data the consumer does not need).                                                                                                                                                 |
| D-8 | Account identity                              | `accountContextKeys: ['publicKey']`: one Connection per Wompi account and environment (a test and a production key pair are two Connections — the consumer handles that).                                                                                                                                                                                                                                               | —                                                                                                                                                                                                                         |

## 3. Facts for the consumer (not this provider's job)

- `single_use: true` links **stay payable after an approved payment** (verified). The consumer deactivates
  the link when a charge is paid.
- Wompi allows **one events URL per environment**, set by hand in the merchant dashboard (official docs).
- A Wompi merchant needs a **Bancolombia account** (official support; Mateo, 2026-10-22).

## 4. Open

- None blocking the provider. The real webhook event (consumer side) is pending Mateo pointing the sandbox
  events URL at a public tunnel.
