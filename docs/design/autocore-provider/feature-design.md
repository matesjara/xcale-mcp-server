# Autocore Hotels Provider (v1) — Feature Design

> **Feature**: Onboard Autocore Hotels as a credential provider (two keys, one composed secret, delivered by
> reference and turned into a timestamped `Auth-Token` per request) with four `controlPlane` tools that let a
> consumer prove a connection, create a payment link, cancel it and read the status of what paid it.
> **Priority**: P1 High
> **Owner**: Sara
> **Status**: Built — all four tools observed against Staging end to end, payments included (2026-11-13)
> **Target Release**: v1
> **Last Updated**: 2026-11-13
> **Issue**: matesjara/xcale-mcp-server#188 · **Consumer**: xcale-backend Payment Request (matesjara/xcale-backend#1068) · **First tenant**: Bio Habitat (matesjara/xcale-backend#2074)
> **Grill**: [`grill-notes.md`](./grill-notes.md) · **Evidence**: [`sandbox-evidence.md`](./sandbox-evidence.md) · **ADR**: [`timestamped-hash-token-auth-scheme`](../../adr/timestamped-hash-token-auth-scheme.md) · **Template**: [`../wompi-provider/feature-design.md`](../wompi-provider/feature-design.md)

---

> **Architectural guardrail (binding).** Provider Self-Containment: this feature lives in `src/providers/autocore/`,
> its tests and fixtures, one line in `src/providers/index.ts`, its logo and these docs — **plus one core change**:
> the additive `timestamped_hash_token` auth variant (`src/core/provider-port.ts`,
> `src/core/auth/authentication-materializer.ts`, the factory's clock seam, `CONTEXT.md`), decided by the CTO in ADR
> [`timestamped-hash-token-auth-scheme`](../../adr/timestamped-hash-token-auth-scheme.md). It ships as its own commit
> with a "Touches the core" section in the PR and a separate CTO review; `/implement` does not merge it on its own
> (ADR 0017). No Autocore name enters the core.
>
> **Evidence before contract.** Every Autocore value in the contract is observed against Staging
> (`sandbox-evidence.md`, 2026-11-09 and 2026-11-13), real test payments included. Only the webhook is unobserved; it
> is the consumer's, never this server's.

---

## 1. Problem Statement

### What's happening?

xcale's Payment Request layer (matesjara/xcale-backend#1068) lets a tenant's agent ask a buyer to pay and learn
when it was paid, through a pluggable gateway port. Wompi is its first real gateway (#159). Hotels that collect
through **Autocore Hotels** cannot use it: Bio Habitat asked for its agent to send payment links, and its payments
run through Autocore (matesjara/xcale-backend#2074, meeting of 2026-10-23).

Autocore is built for hotels in Colombia and Costa Rica. Its payment links are hosted checkout pages — card, PSE,
Nequi, Daviplata, SINPE Móvil, gift cards and preloaded balances — that collect the payer's own data and card, so
xcale never handles card data. The consumer needs four capabilities from it, and none of them belongs in front of
the agent.

### Who's affected?

- **The consumer (xcale-backend)**, which needs a stable, consumer-agnostic way to create links and read what paid
  them with the tenant's own Autocore keys.
- **Hotels on Autocore**, starting with Bio Habitat, once the consumer ships.

### What's the cost of inaction?

A hotel that already collects through Autocore would have to open a second gateway account (Wompi needs a
Bancolombia account) for its agent to charge, or keep sending links by hand. The backend would otherwise hand-roll an
Autocore HTTP client, breaking the default path for LATAM providers.

---

## 2. Goals & Success Metrics

### North Star

The consumer can verify a hotel's Autocore connection, create a link for an exact amount and confirm the amount
actually paid, in Staging or Production, with no Autocore knowledge outside this provider and no credential or payer
data ever leaving it.

| Type    | Metric                                                           | Target | How measured                                     |
| :------ | :--------------------------------------------------------------- | :----- | :----------------------------------------------- |
| Leading | Tools callable against Autocore Staging                          | 3 of 3 | `mcp-contract-qa` against `api-stg.autocore.pro` |
| Leading | Agent-visible Autocore tools                                     | 0      | `tools/list`                                     |
| Lagging | Autocore error bodies or payer fields reaching a result or a log | 0      | Redaction test + log review                      |
| Lagging | Settled links whose amount came from anything but the voucher    | 0      | Test of the `applied` path; consumer logs        |
| Lagging | Connection probe false positives (a wrong `hotelId` accepted)    | 0      | Probe test; consumer connect logs                |

---

## 3. Target Users

### Consumer backend (xcale-backend)

- **Context**: its Autocore gateway adapter implements the Payment Request gateway port (`IPaymentGatewayPort`).
- **Motivation**: connect a hotel, create links and settle them with the hotel's keys.
- **Pain today**: no Autocore provider.
- **Expected benefit**: four tools with stable shapes and stable error codes.

### Operator (xcale engineer)

- **Context**: connecting a hotel or debugging its payments.
- **Motivation**: a connection that fails at connect time, not at the first guest; clear failure codes; no secrets in
  logs.
- **Expected benefit**: the probe names the hotel the keys reach; `ProviderErrorCode` failures with own messages.

---

## 4. User Stories

### Must Have (P0)

- **US-01**: As the consumer, I want to prove a hotel's keys work **for that hotel** at connect time, so a wrong key or
  a mistyped hotel id is refused before anything is stored.
- **US-02**: As the consumer, I want to create a link for an exact amount, currency, concept, validity and my own
  reference, for a named guest, and get back its code and checkout URL.
- **US-03**: As the consumer, I want to choose whether Autocore emails the link to the guest, so a guest is never
  emailed by omission.
- **US-08**: As the consumer, I want to cancel a link, so a request the agent or the tenant cancels can no longer be
  paid.
- **US-04**: As the consumer, I want to read a link's status and, when it is paid, the amount and currency actually
  paid, so I settle against the truth and not against a webhook anyone could post.
- **US-05**: As the consumer, I want Staging and Production to work from the same deployment, chosen per connection.
- **US-06**: As an operator, I want no Autocore error body, no credential and no payer data in results or logs.

### Should Have (P1)

- **US-07**: As the consumer, I want to pass the hotel's own choices — payment methods, installments — without the
  provider deciding them.

---

## 5. Feature Scope (MoSCoW)

### ✅ Must Have

- [ ] Core: the `timestamped_hash_token` variant and its binding tests, per the ADR — recipe fixed by the variant
      (`base64(key;ts;sha256_hex(secret+ts))`, `ts` in Unix seconds), computed per HTTP request in the materializer
      (still the only reveal), the composed secret split at its first `:` and failing closed, an injectable clock, the
      `CONTEXT.md` entry. Own commit.
- [ ] Auth descriptor: `type: 'timestamped_hash_token'`, `header: 'Auth-Token'`, `fields: [access_key, secret_key]`,
      `credentialDelivery: 'reference'`.
- [ ] Context schema: `hotelId` (positive integer), `environment` (`staging` | `production`, required) and `source`
      (the account's origin, required by Autocore on every create since 2026-11-13).
- [ ] Client: base URL from `environment`; nothing else picks the host.
- [ ] Tools, all `controlPlane: true`: `mcp_autocore_check_credentials`, `mcp_autocore_create_payment_link`,
      `mcp_autocore_deactivate_payment_link`, `mcp_autocore_get_transaction_status`.
- [ ] The probe checks the `hotelId` is among the hotels the keys reach, paging to `total_items` with a hard cap, and
      returns the hotel's name and currencies only.
- [ ] Creating a link is never retried by the provider (Autocore has no idempotency).
- [ ] The status read adds the voucher's amount and currency when the status is `applied`; payer data dropped.
- [ ] Error mapping to `ProviderErrorCode` with own messages; never echo Autocore bodies.
- [ ] No `identityPolicy` on any tool: none returns or changes a person's records (the guest's name goes in, nothing
      personal comes out), which is what an absent policy declares (ADR 0019). No `audience`: all are `controlPlane`.
- [ ] Fixtures from the Staging spike (no keys, no personal data) and tests, including the conformance round trip
      with the auth-failure path, and the redaction test.
- [ ] Logo `assets/autocore.svg` (or `.webp`).

### 🟡 Should Have

- [ ] `mcp-contract-qa` run against Staging.

### ⛔ Won't Have

| Excluded                                                               | Why                                                                                                                                        |
| :--------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
| Webhook ingress and verification                                       | The consumer's. Unsigned, so the consumer confirms every webhook with the status read.                                                     |
| Direct Charge (virtual terminal)                                       | It takes card data encrypted with a key pair: PCI scope. Hosted links exist so xcale never touches a card.                                 |
| Refunds                                                                | Neither the port nor Wompi has them. Fast-follow when a hotel asks.                                                                        |
| The DLM transactions listing by hotel                                  | Autocore keeps the last-request timestamp server-side: a retry, a probe or a second consumer would consume the window. Returns payer data. |
| The open link (`POST /v2/links/open-schedule/`)                        | Payment Request charges an exact amount.                                                                                                   |
| Bookings over RoomCloud, Gift Cards, Virtual Cards, Preloaded Balances | No consumer asks. Bookings becomes its own provider when a RoomCloud hotel does.                                                           |
| Testing (`api-dev`)                                                    | Autocore's own environment: integrators get Staging keys, which do not work there.                                                         |
| Minimum-amount and currency checks in the provider                     | Autocore enforces neither; the consumer checks the currency against the probe's, and owns any minimum.                                     |
| Link fields `redirect`, `reservation_id`, `booking_dates`, `source`    | Nobody needs them in v1; Autocore fills the account's own `source`. Additive later.                                                        |

### Consumer registration data (asked for in a consumer issue in xcale-backend)

Provider Self-Containment keeps the consumer's side to registration data, plus the policy the Payment Request layer
owns.

| Data                   | Value                                                                                                                                                                                                                                                                                                           | Where in the consumer                           |
| :--------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------- |
| Auth variant           | Rail A recognises `timestamped_hash_token`: collects both `fields` at connect, stores them composed `access_key:secret_key`, resolves them by `reference`. It computes nothing.                                                                                                                                 | Rail A (the Credential Authority)               |
| Toolbox entry          | `slug: 'autocore'`, the MCP server URL, `accountKeyFields: ['hotelId', 'environment']`                                                                                                                                                                                                                          | `mcpToolboxes` (`src/modules/mcp/toolboxes.ts`) |
| Context it must send   | `hotelId`, `environment` (no default) and `source` (handed over by Autocore with the keys), all asked in the connect form                                                                                                                                                                                       | The gateway connect extension                   |
| Tools it calls by name | the four `mcp_autocore_*` tools                                                                                                                                                                                                                                                                                 | The Autocore gateway adapter                    |
| Its own policy         | `amountMinor` → whole units (refuse a fraction); the currency checked against the probe's currencies; `expiresAt` → `availableHours` rounded down; the buyer's name; `sendLinkByEmail` from a tenant setting that ships off; no blind retry of a create; status mapping; the webhook confirmed by a status read | The adapter, and its own grill (CPO + CTO)      |
| Errors it must handle  | `PROVIDER_AUTH_EXPIRED` → the credential is rejected; `PROVIDER_INVALID_INPUT` on the probe → the hotel id is wrong                                                                                                                                                                                             | Same adapter                                    |

---

## 6. UX & Interaction Design

No end-user UI. The consumer calls the tools server-side. What a hotel sees — the connect form, the gateway card,
the link its guest opens — is the consumer's design and Autocore's checkout.

### 6.1 Discovery

`tools/list` shows **no** Autocore tool (all `controlPlane`). The provider still appears in the capability catalog
with its auth descriptor, its context schema and its connection probe, so the consumer generates its connect form:
two secret fields (access key, secret key) and the context — the hotel id and the environment, which the hotel must
pick, Staging or Production.

### 6.2 Connecting a hotel

The operator, or the hotel itself, pastes the two keys, types the hotel id Autocore gave it and picks the environment.
The consumer calls `mcp_autocore_check_credentials` before storing anything:

- **Keys and hotel match** → the probe answers with the hotel's name and currencies. The consumer shows _"Connected:
  STG XCALE HOTEL"_, so a hotel that pasted another account's keys sees the wrong name at once.
- **Keys rejected** (wrong keys, or Staging keys with Production picked) → `PROVIDER_AUTH_EXPIRED`; the form asks for
  the keys again.
- **Keys fine, hotel id not among the hotels they reach** → `PROVIDER_INVALID_INPUT` with the provider's own message;
  the form points at the hotel id, not the keys.
- **Autocore down** → `PROVIDER_UNAVAILABLE`; nothing is stored, the operator retries.

### 6.3 Charging a guest

The consumer calls `mcp_autocore_create_payment_link` with the amount in whole units, the currency, the guest's name
(and email or phone when it has them), the concept, its own reference, its webhook URL, the validity in hours and
whether Autocore should email the guest. The provider answers with the link's code and the checkout URL Autocore
returns; the consumer sends the URL over its own channel. On the checkout the guest enters their own document,
contact and card. Autocore later posts its webhook to the consumer.

### 6.4 Cancelling

When the agent or the tenant cancels a request, or the tenant disconnects the gateway, the consumer calls
`mcp_autocore_deactivate_payment_link` with the link's code. Autocore cancels it; the guest who opens the link sees it
can no longer be paid, and the status read answers `cancelled`. Cancelling again is harmless.

### 6.5 Settling

For each pending link the consumer calls `mcp_autocore_get_transaction_status` with the link's code. While unpaid it
sees `pending` (observed) or `in_process`; when paid it sees `applied` with the amount and currency paid, read from
the voucher; a declined payment comes back `rejected` or `invalid_card`.

### 6.6 Call outcomes

| Situation                                                          | Result                                                          |
| :----------------------------------------------------------------- | :-------------------------------------------------------------- |
| Success                                                            | `structuredContent: { ok: true, data }`                         |
| Keys rejected (401/403)                                            | `{ ok: false, code: 'PROVIDER_AUTH_EXPIRED' }`, `isError: true` |
| Probe: `hotelId` not reached by the keys                           | `PROVIDER_INVALID_INPUT`, own message                           |
| Invalid input / business rejection (400/422)                       | `PROVIDER_INVALID_INPUT`                                        |
| Rate limited (429)                                                 | `PROVIDER_RATE_LIMITED`                                         |
| Autocore down / network (a create may still have landed)           | `PROVIDER_UNAVAILABLE`                                          |
| Status `applied` but the voucher cannot be read                    | The voucher's error — never a success without an amount         |
| 404 and any other status                                           | `PROVIDER_ERROR`                                                |
| `environment` missing or unknown, `hotelId` not a positive integer | `PROVIDER_INVALID_INPUT` (no call made)                         |

---

## 7. Data Model Sketch

No storage: the provider is stateless.

```
Consumer ──callTool(reference → access_key:secret_key, metadata = { hotelId, environment })──▶ autocore provider
                                                                                                    │ HTTPS, Auth-Token per request
                                       environment = staging    → https://api-stg.autocore.pro ◀────┤
                                       environment = production → https://api.autocore.pro     ◀────┘

Autocore ──webhook (temp_webhook_url = the consumer's notificationUrl)──▶ Consumer   (never through this server)
```

| Concept              | Key fields the tools carry                                                                   |
| :------------------- | :------------------------------------------------------------------------------------------- |
| Connection (context) | `hotelId`, `environment`                                                                     |
| Hotel (probe)        | `id`, `name`, `currencies`, `primaryCurrency`                                                |
| Payment link         | `code`, `url`; created with amount, currency, guest, concept, `externalRef`, validity        |
| Transaction status   | `status` (Autocore's code), `transactionId`, `occurredAt`; `amount` and `currency` when paid |

---

## 8. Architectural Decisions

| #     | Decision           | Choice                                                                                                                                                                                                                  | Rationale                                                                                                                                                                                                           |
| :---- | :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AD-1  | Credential         | One composed secret `access_key:secret_key`, delivery `reference`                                                                                                                                                       | A financial provider (ADR 0003's hard gate, ADR 0010). Composing follows WooCommerce's `ck:cs` (ADR 0018); `ResolvedCredential` stays one `SecretString` (grill D-3).                                               |
| AD-2  | Materialization    | `timestamped_hash_token` [CTO]: the materializer computes `Auth-Token` per HTTP request from the composed secret; recipe fixed by the variant, `header` and `fields` declared; split at the first `:`; injectable clock | Autocore authenticates only with this token (observed); the materializer is the only reveal and already runs per request (`src/core/provider-factory.ts:126-132`). ADR `timestamped-hash-token-auth-scheme`.        |
| AD-3  | Environment        | `environment: 'staging' \| 'production'` in the context, required, no default; the provider maps it to the base URL                                                                                                     | Keys are per environment and carry no prefix; Staging is what Autocore issues to integrators (observed). One deployment serves both (grill D-5).                                                                    |
| AD-4  | Account identity   | `accountContextKeys: ['hotelId', 'environment']`                                                                                                                                                                        | A hotel in Staging and in Production are two connections.                                                                                                                                                           |
| AD-5  | Probe              | `GET /v2/hotels`, paging to `total_items`, hard cap; returns the hotel's id, name and currencies                                                                                                                        | The listing is scoped to the keys (observed); creates nothing; the hotel's other data stays in the provider (grill D-9).                                                                                            |
| AD-6  | Status read        | `transaction-status` per link by its `code`; when `applied`, the link's own record (`GET /v2/links/schedule/<code>`) for the amount and currency of the payment with that transaction id                                | The consumer's settlement compares asked vs paid; the status read has no amount, the link record only Spanish labels, the voucher is a PDF and its detail endpoint fails, and the webhook is unsigned (grill D-10). |
| AD-7  | Units and currency | `amount` a positive integer in whole units; `currency` an ISO code, required by the tool                                                                                                                                | A `150000` link shows $150.000 COP; Autocore accepts fractions and any currency, so the schema and the consumer guard them (grill D-6).                                                                             |
| AD-8  | Email to the guest | `sendLinkByEmail` required, no default                                                                                                                                                                                  | Autocore emails the guest unless told not to; no consumer can do it by omission (grill D-8).                                                                                                                        |
| AD-9  | No retry on create | The provider never retries `POST /v2/links/schedule/`                                                                                                                                                                   | Autocore creates a second link for a repeated `external_ref_id` and cannot look one up by it (observed; grill D-12).                                                                                                |
| AD-10 | Errors             | Core status policy; own message `Autocore <operation> failed (HTTP n)`; the body is never propagated                                                                                                                    | Autocore's `detail` is free Spanish text with no stable code (observed; grill D-11).                                                                                                                                |
| AD-11 | Cancelling a link  | `DELETE /v2/bookings/chatbot/<code>` with the `Auth-Token`; idempotent                                                                                                                                                  | Undocumented, but observed: `200` also on an already-cancelled link, then `cancelled` and a checkout that refuses it (grill D-2).                                                                                   |
| AD-12 | Visibility         | All four tools `controlPlane: true`                                                                                                                                                                                     | The agent charges only through the consumer's guarded `payment_request_*` tools (charge ceiling, approval).                                                                                                         |

---

## 9. Risks & Open Questions

### Risks

| #   | Risk                                                                                                                   | Likelihood         | Impact | Mitigation                                                                                                                                                          |
| :-- | :--------------------------------------------------------------------------------------------------------------------- | :----------------- | :----- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R-1 | The first imperative auth variant in the core                                                                          | Certain (decided)  | High   | ADR and its six binding tests (deterministic clock, parity vector, split failing closed, never logged, a token per request, no regression); own commit; CTO review. |
| R-2 | The server clock drifts past Autocore's 30 s window: every call 401s and reads as reconnect-required                   | Low                | High   | App Platform keeps NTP time; accepted in the ADR, no skew detection in v1.                                                                                          |
| R-3 | The cancel endpoint is undocumented and could change                                                                   | Medium             | Medium | Observed (unpaid: 200, idempotent; paid: 404, no effect) and covered by fixtures; the consumer treats a failed cancel as "not cancelled" and re-reads.              |
| R-4 | A create's response is lost and a payable link exists that the consumer never recorded                                 | Low                | Medium | No retry (AD-9); a payment on it still reaches the consumer by webhook with its `externalRef`.                                                                      |
| R-5 | Autocore exposes a link's status and the guest's contact to anyone with its code                                       | Observed           | Medium | Reported to Autocore; the provider never logs a link's URL or code; the consumer weighs what guest data to send.                                                    |
| R-6 | An Autocore error body leaks a key or payer data into a result or a log                                                | Low (not observed) | High   | AD-10; a test feeds an error body containing a key and asserts it never appears.                                                                                    |
| R-7 | The webhook is forged                                                                                                  | Medium             | High   | The consumer never settles on a webhook; it confirms with the status read and the voucher's amount.                                                                 |
| R-8 | Autocore changes its configuration again (it moved the processor to `onepay` and made `source` required on 2026-11-13) | Medium             | High   | Live checks against Staging before each release; `source` is context, so a new value needs no code.                                                                 |

### Open Questions

None. Resolved by the evidence: which auth (only the `Auth-Token`), `ref_number` (the link's `code`), the amount's
unit (whole units), `email` (optional), the hotel listing (scoped to the keys), the unpaid and paid statuses, where the
amount paid lives (the link record), that a paid link cannot be paid again nor cancelled, and that `source` is now
required. Unobserved, and the consumer's: the webhook.

---

## 10. Phasing & Roadmap

| Phase    | Scope         | Deliverables                                                                                                                                           | Depends on                                | Effort |
| :------- | :------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------- | :----- |
| 0        | Design        | Grill notes, this design, the ADR                                                                                                                      | — (done)                                  | S      |
| 1        | Evidence      | `sandbox-evidence.md` from Staging, payments included; the API contract for the four tools                                                             | — (done)                                  | S      |
| 2        | Core auth     | The `timestamped_hash_token` variant (`src/core/auth/`, `provider-port.ts`, the factory's clock seam), its tests, `CONTEXT.md`; own commit, CTO review | The ADR                                   | S–M    |
| 3        | Provider      | `src/providers/autocore/` (four tools, `source` in the context), fixtures, tests, registration, logo                                                   | Phases 1 and 2 (done)                     | M      |
| Consumer | xcale-backend | Rail A recognises `timestamped_hash_token`; gateway adapter, webhook ingress, buyer data, the email setting, connect form                              | Phase 3 merged to `dev`; a consumer issue | L      |

---

## 11. Agentic Context

| Module                            | Relationship | Key files                                                                                                   |
| :-------------------------------- | :----------- | :---------------------------------------------------------------------------------------------------------- |
| Payment-gateway provider          | Template     | `src/providers/wompi/` (auth, context, manifest, client, errors, tools, tests)                              |
| Composed secret                   | Precedent    | `src/providers/woocommerce/auth.ts:16`, ADR 0018                                                            |
| Auth descriptor variants          | Mechanism    | `src/core/provider-port.ts:39` (`ProviderAuthDescriptor`)                                                   |
| Materialization (the core change) | Mechanism    | `src/core/auth/authentication-materializer.ts:19-83`; per request in `src/core/provider-factory.ts:126-132` |
| Reference delivery                | Mechanism    | ADR 0010; `src/providers/wompi/auth.ts`                                                                     |
| Probe and account keys            | Mechanism    | `src/core/provider-port.ts:186`, `:203`                                                                     |
| `controlPlane`                    | Mechanism    | `src/core/tool.ts:107`                                                                                      |
| Error codes and status policy     | Mechanism    | `src/core/errors.ts:6`, `src/core/http.ts:8`                                                                |
| Registration                      | One line     | `src/providers/index.ts:20` (`PROVIDERS`)                                                                   |

**Conventions:** `add-provider` (the layer's skill), ADR 0009 (canonical provider pattern), the ADR
`timestamped-hash-token-auth-scheme`, `CONTEXT.md`.

**Next**: [`api-contract.md`](./api-contract.md) (`/api-contract-authoring`) from `sandbox-evidence.md` → build per
[`implementation-plan.md`](./implementation-plan.md) with `/tdd`, core first → PR to `dev`.
