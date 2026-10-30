# Autocore Hotels Provider (v1) — Feature Design

> **Feature**: Onboard Autocore Hotels as a credential provider (two keys, one composed secret, delivered by
> reference) with three `controlPlane` tools that let a consumer prove a connection, create a payment link and read
> the status of what paid it.
> **Priority**: P1 High
> **Owner**: Sara
> **Status**: Draft — pending evidence (the Testing credentials; P-1 – P-7 in the grill notes)
> **Target Release**: v1
> **Last Updated**: 2026-10-29
> **Issue**: matesjara/xcale-mcp-server#188 · **Consumer**: xcale-backend Payment Request (matesjara/xcale-backend#1068) · **First tenant**: Bio Habitat (matesjara/xcale-backend#2074)
> **Grill**: [`grill-notes.md`](./grill-notes.md) · **Template**: [`../wompi-provider/feature-design.md`](../wompi-provider/feature-design.md)

---

> **Architectural guardrail (binding).** Provider Self-Containment: this feature lives in `src/providers/autocore/`,
> its tests and fixtures, one line in `src/providers/index.ts`, its logo and these docs — **plus one core change in
> `src/core/auth/`**, unavoidable whichever scheme Autocore confirms (AD-2): two headers from one secret, or a signed
> `Auth-Token`. That change ships as its own commit with a "Touches the core" section in the PR, is reviewed by the
> CTO, and — for the `Auth-Token` — carries an ADR. `/implement` does not merge it on its own.
>
> **Evidence before contract.** Nothing here is observed against an authenticated Autocore API yet. The design
> carries the uncertainty as open questions (§9); the API contract is written only after the Testing spike
> (`sandbox-evidence.md`), and its values come from that spike.

---

## 1. Problem Statement

### What's happening?

xcale's Payment Request layer (matesjara/xcale-backend#1068) lets a tenant's agent ask a buyer to pay and learn
when it was paid, through a pluggable gateway port. Wompi is its first real gateway (#159). Hotels that collect
through **Autocore Hotels** cannot use it: Bio Habitat asked for its agent to send payment links, and its payments
run through Autocore (matesjara/xcale-backend#2074, meeting of 2026-10-23).

Autocore is built for hotels in Colombia and Costa Rica. Its payment links are hosted checkout pages — card, PSE,
Nequi, Daviplata, SINPE Móvil, gift cards and preloaded balances — so xcale never handles card data. The consumer
needs three capabilities from it, and none of them belongs in front of the agent.

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
actually paid, in Testing or Production, with no Autocore knowledge outside this provider and no credential or payer
data ever leaving it.

| Type    | Metric                                                           | Target | How measured                                     |
| :------ | :--------------------------------------------------------------- | :----- | :----------------------------------------------- |
| Leading | Tools callable against Autocore Testing                          | 3 of 3 | `mcp-contract-qa` against `api-dev.autocore.pro` |
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
- **Expected benefit**: three tools with stable shapes and stable error codes.

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
- **US-02**: As the consumer, I want to create a link for an exact amount, concept, validity and my own reference, for
  a named guest, and get back its code and checkout URL.
- **US-03**: As the consumer, I want to choose whether Autocore emails the link to the guest, so a guest is never
  emailed by omission.
- **US-04**: As the consumer, I want to read a link's status and, when it is paid, the amount and currency actually
  paid, so I settle against the truth and not against a webhook anyone could post.
- **US-05**: As the consumer, I want Testing and Production to work from the same deployment, chosen per connection.
- **US-06**: As an operator, I want no Autocore error body and no payer data in results or logs.

### Should Have (P1)

- **US-07**: As the consumer, I want to pass the hotel's own choices — payment methods, installments — without the
  provider deciding them.

---

## 5. Feature Scope (MoSCoW)

### ✅ Must Have

- [ ] Auth descriptor: one composed secret (`access_key:secret_key`), delivery `reference`; materialization per the
      scheme Autocore confirms (AD-2).
- [ ] Context schema: `hotelId` (positive integer) and `environment` (`testing` | `production`, required).
- [ ] Client: base URL from `environment`; nothing else picks the host.
- [ ] Tools, all `controlPlane: true`: `mcp_autocore_check_credentials`, `mcp_autocore_create_payment_link`,
      `mcp_autocore_get_transaction_status`.
- [ ] The probe checks the `hotelId` is among the hotels the keys reach, paging with a hard cap.
- [ ] The status read adds the voucher's amount and currency when the status is `applied`; payer data dropped.
- [ ] Error mapping to `ProviderErrorCode` with own messages; never echo Autocore bodies.
- [ ] No `identityPolicy` on any tool: none returns or changes a person's records (the guest's name and email go in,
      nothing personal comes out), which is what an absent policy declares (ADR 0019). No `audience`: all are
      `controlPlane`.
- [ ] Fixtures from the Testing spike (no keys, no personal data) and tests, including the conformance round trip
      with the auth-failure path, and the redaction test.
- [ ] Logo `assets/autocore.svg` (or `.webp`).

### 🟡 Should Have

- [ ] `mcp-contract-qa` run against Testing.

### ⛔ Won't Have

| Excluded                                                               | Why                                                                                                                                        |
| :--------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
| Deactivating a link                                                    | No endpoint in the docs (P-1). No invented tool; the consumer reports it cannot, and the tenant's lever is a short validity.               |
| Webhook ingress and verification                                       | The consumer's. Unsigned, so the consumer confirms every webhook with the status read.                                                     |
| Direct Charge (virtual terminal)                                       | It takes card data encrypted with a key pair: PCI scope. Hosted links exist so xcale never touches a card.                                 |
| Refunds                                                                | Neither the port nor Wompi has them. Fast-follow when a hotel asks.                                                                        |
| The DLM transactions listing by hotel                                  | Autocore keeps the last-request timestamp server-side: a retry, a probe or a second consumer would consume the window. Returns payer data. |
| Bookings over RoomCloud, Gift Cards, Virtual Cards, Preloaded Balances | No consumer asks. Bookings becomes its own provider when a RoomCloud hotel does.                                                           |
| Staging (`api-stg`)                                                    | Testing and Production cover a tenant's path; an additive enum value if Autocore requires it.                                              |
| Minimum-amount and currency checks                                     | Autocore rejects; the consumer owns the agent-facing reason.                                                                               |
| Link fields `redirect`, `reservation_id`, `booking_dates`, `source`    | Nobody needs them in v1; additive later.                                                                                                   |

### Consumer registration data (asked for in a consumer issue in xcale-backend)

Provider Self-Containment keeps the consumer's side to registration data, plus the policy the Payment Request layer
owns.

| Data                   | Value                                                                                                                                                                                                                                    | Where in the consumer                           |
| :--------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------- |
| Toolbox entry          | `slug: 'autocore'`, the MCP server URL, `accountKeyFields: ['hotelId', 'environment']`                                                                                                                                                   | `mcpToolboxes` (`src/modules/mcp/toolboxes.ts`) |
| Credential             | Both keys from the connect form, composed `access_key:secret_key`, delivered by reference                                                                                                                                                | Rail A (the Credential Authority)               |
| Context it must send   | `hotelId` and `environment`, both asked in the connect form, `environment` with no default                                                                                                                                               | The gateway connect extension                   |
| Tools it calls by name | the three `mcp_autocore_*` tools                                                                                                                                                                                                         | The Autocore gateway adapter                    |
| Its own policy         | `amountMinor` → whole units (refuse a fraction); `expiresAt` → `availableHours` rounded down; the buyer's name and email; `sendLinkByEmail` from a tenant setting that ships off; status mapping; the webhook confirmed by a status read | The adapter, and its own grill (CPO + CTO)      |
| Errors it must handle  | `PROVIDER_AUTH_EXPIRED` → the credential is rejected; `PROVIDER_INVALID_INPUT` on the probe → the hotel id is wrong                                                                                                                      | Same adapter                                    |

---

## 6. UX & Interaction Design

No end-user UI. The consumer calls the tools server-side. What a hotel sees — the connect form, the gateway card,
the link its guest opens — is the consumer's design and Autocore's checkout.

### 6.1 Discovery

`tools/list` shows **no** Autocore tool (all `controlPlane`). The provider still appears in the capability catalog
with its auth descriptor, its context schema and its connection probe, so the consumer generates its connect form:
two secret fields (access key, secret key) and the context — the hotel id and the environment, which the hotel must
pick, Testing or Production.

### 6.2 Connecting a hotel

The operator, or the hotel itself, pastes the two keys, types the hotel id Autocore gave it and picks the environment.
The consumer calls `mcp_autocore_check_credentials` before storing anything:

- **Keys and hotel match** → the probe answers with the hotel's name and currency. The consumer shows _"Connected:
  Hotel Azuan Suites"_, so a hotel that pasted another account's keys sees the wrong name at once.
- **Keys rejected** (wrong keys, or Testing keys with Production picked) → `PROVIDER_AUTH_EXPIRED`; the form asks for
  the keys again.
- **Keys fine, hotel id not among the hotels they reach** → `PROVIDER_INVALID_INPUT` with the provider's own message;
  the form points at the hotel id, not the keys.
- **Autocore down** → `PROVIDER_UNAVAILABLE`; nothing is stored, the operator retries.

### 6.3 Charging a guest

The consumer calls `mcp_autocore_create_payment_link` with the amount in whole units, the currency, the guest's name
and email, the concept, its own reference, its webhook URL, the validity in hours and whether Autocore should email
the guest. The provider answers with the link's code and the checkout URL; the consumer sends the URL over its own
channel. Autocore later posts its webhook to the consumer.

### 6.4 Settling

For each pending link the consumer calls `mcp_autocore_get_transaction_status` with the link's code. While unpaid it
sees `pending` or `in_process` (or a `PROVIDER_ERROR` 404 until P-7 settles which); when paid it sees `applied` with
the amount and currency paid, read from the voucher; a declined payment comes back `rejected` or `invalid_card`.

### 6.5 Call outcomes

| Situation                                                          | Result                                                          |
| :----------------------------------------------------------------- | :-------------------------------------------------------------- |
| Success                                                            | `structuredContent: { ok: true, data }`                         |
| Keys rejected (401/403)                                            | `{ ok: false, code: 'PROVIDER_AUTH_EXPIRED' }`, `isError: true` |
| Probe: `hotelId` not reached by the keys                           | `PROVIDER_INVALID_INPUT`, own message                           |
| Invalid input / business rejection (400/422)                       | `PROVIDER_INVALID_INPUT`                                        |
| Rate limited (429)                                                 | `PROVIDER_RATE_LIMITED`                                         |
| Autocore down / network                                            | `PROVIDER_UNAVAILABLE`                                          |
| Status `applied` but the voucher cannot be read                    | The voucher's error — never a success without an amount         |
| 404 and any other status                                           | `PROVIDER_ERROR`                                                |
| `environment` missing or unknown, `hotelId` not a positive integer | `PROVIDER_INVALID_INPUT` (no call made)                         |

---

## 7. Data Model Sketch

No storage: the provider is stateless.

```
Consumer ──callTool(reference → access_key:secret_key, metadata = { hotelId, environment })──▶ autocore provider
                                                                                                    │ HTTPS
                                       environment = testing    → https://api-dev.autocore.pro ◀────┤
                                       environment = production → https://api.autocore.pro     ◀────┘

Autocore ──webhook (temp_webhook_url = the consumer's notificationUrl)──▶ Consumer   (never through this server)
```

| Concept              | Key fields the tools carry                                                                   |
| :------------------- | :------------------------------------------------------------------------------------------- |
| Connection (context) | `hotelId`, `environment`                                                                     |
| Payment link         | `code`, `url`; created with amount, currency, guest, concept, `externalRef`, validity        |
| Transaction status   | `status` (Autocore's code), `transactionId`, `occurredAt`; `amount` and `currency` when paid |

---

## 8. Architectural Decisions

| #     | Decision           | Choice                                                                                                                                                                                                                                         | Rationale                                                                                                                                                                                                         |
| :---- | :----------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AD-1  | Credential         | One composed secret `access_key:secret_key`, delivery `reference`                                                                                                                                                                              | A financial provider (ADR 0003's hard gate, ADR 0010). Composing follows WooCommerce's `ck:cs` (ADR 0018), so custody, the connect form and the consumer are the same whichever scheme Autocore uses (grill D-3). |
| AD-2  | Materialization    | **Pending P-2.** Headers → a declarative extension so one composed secret materializes into two named headers. `Auth-Token` → a new imperative auth variant in the materializer (hash of the secret and a timestamp, base64), with its own ADR | `api_key` writes one secret to one header (`src/core/auth/authentication-materializer.ts:40-79`), and only the materializer may reveal the secret. Either way it is core work: own commit, CTO review.            |
| AD-3  | Environment        | `environment` in the context, required, no default; the provider maps it to the base URL                                                                                                                                                       | Autocore keys carry no environment prefix; one deployment serves both. The tenant's choice, not Autocore knowledge, crosses the boundary (grill D-5).                                                             |
| AD-4  | Account identity   | `accountContextKeys: ['hotelId', 'environment']`                                                                                                                                                                                               | A hotel in Testing and in Production are two connections, as two Wompi key pairs are.                                                                                                                             |
| AD-5  | Probe              | `GET /v2/hotels`, paging until `hotelId` is found, hard cap; returns the hotel's id, name and currency                                                                                                                                         | Validates the keys and the hotel together, creates nothing, returns nothing personal (grill D-9). Pending P-6: the listing must be scoped to the keys.                                                            |
| AD-6  | Status read        | `transaction-status` per link; when `applied`, the voucher detail for amount and currency                                                                                                                                                      | The consumer's settlement compares asked vs paid; the status read has no amount and the webhook is unsigned (grill D-10).                                                                                         |
| AD-7  | Units              | `amount` in whole units, as Autocore takes it; `currency` an open ISO code                                                                                                                                                                     | Fidelity over Unification; Autocore serves CRC as well as COP (grill D-6). Pending P-4.                                                                                                                           |
| AD-8  | Email to the guest | `sendLinkByEmail` required, no default                                                                                                                                                                                                         | Autocore emails the guest unless told not to; no consumer can do it by omission (grill D-8).                                                                                                                      |
| AD-9  | Errors             | Core status policy; own message `Autocore <operation> failed (HTTP n)`; the body is never propagated                                                                                                                                           | The core redacts only query values (`src/core/http.ts:47`); whether Autocore echoes keys is unobserved, so the rule holds regardless (grill D-11).                                                                |
| AD-10 | Visibility         | All three tools `controlPlane: true`                                                                                                                                                                                                           | The agent charges only through the consumer's guarded `payment_request_*` tools (charge ceiling, approval).                                                                                                       |

---

## 9. Risks & Open Questions

### Risks

| #   | Risk                                                                                   | Likelihood         | Impact | Mitigation                                                                                                     |
| :-- | :------------------------------------------------------------------------------------- | :----------------- | :----- | :------------------------------------------------------------------------------------------------------------- |
| R-1 | Payment links use the `Auth-Token`: the first imperative auth variant                  | Medium             | High   | Own commit and ADR, CTO review; the variant is generic (no Autocore name in the core) and tested in isolation. |
| R-2 | A link cannot be voided, so a cancelled request stays payable until it expires         | High (no endpoint) | Medium | The consumer says so to the agent; the tenant sets a short validity; P-1 asked.                                |
| R-3 | An Autocore error body leaks a key or payer data into a result or a log                | Unknown            | High   | AD-9; a test feeds an error body containing a key and asserts it never appears.                                |
| R-4 | `GET /v2/hotels` lists every Autocore hotel, so the probe's hotel check proves nothing | Low                | Medium | P-6 verified in the spike; otherwise a per-hotel read replaces it before the contract.                         |
| R-5 | The webhook is forged                                                                  | Medium             | High   | The consumer never settles on a webhook; it confirms with the status read and the voucher's amount.            |
| R-6 | Testing behaves differently from Production                                            | Low                | Medium | Same API documented; the first Production connection (Bio Habitat) is watched.                                 |

### Open Questions

| #   | Question                                                                                         | Owner                 | Resolution path                                          |
| :-- | :----------------------------------------------------------------------------------------------- | :-------------------- | :------------------------------------------------------- |
| P-1 | Does a link close after an approved payment? Can a link be voided before it expires?             | Sara (asked Autocore) | Autocore's answer; then the backend CTO decides the port |
| P-2 | Which auth do Payment links and Transactions use; does `transaction-status` need it?             | Sara (asked Autocore) | Autocore's answer, confirmed in the spike; sets AD-2     |
| P-3 | Is `ref_number` the link's `code`?                                                               | Sara                  | Testing spike                                            |
| P-4 | Is `amount` in whole units?                                                                      | Sara                  | Testing spike: a `150000` COP link                       |
| P-5 | Is `email` required with `send_link_by_email: false`?                                            | Sara (asked Autocore) | Autocore's answer, confirmed in the spike                |
| P-6 | Is `GET /v2/hotels` scoped to the keys?                                                          | Sara                  | Testing spike                                            |
| P-7 | What does the status read return for an unpaid link; does its `transaction_id` read the voucher? | Sara                  | Testing spike                                            |

None blocks this design. P-2 blocks the core slice; P-3, P-4, P-6 and P-7 block the API contract.

---

## 10. Phasing & Roadmap

| Phase    | Scope         | Deliverables                                                                  | Depends on                  | Effort |
| :------- | :------------ | :---------------------------------------------------------------------------- | :-------------------------- | :----- |
| 0        | Design        | Grill notes, this design, the implementation plan                             | Nothing                     | S      |
| 1        | Evidence      | `sandbox-evidence.md` from Testing; the API contract                          | Autocore's keys and answers | S      |
| 2        | Core auth     | The materialization AD-2 needs, its ADR when it is the `Auth-Token`           | P-2                         | S–M    |
| 3        | Provider      | `src/providers/autocore/`, fixtures, tests, registration, logo                | Phases 1 and 2              | M      |
| Consumer | xcale-backend | Gateway adapter, webhook ingress, buyer data, the email setting, connect form | Phase 3 merged to `dev`     | L      |

---

## 11. Agentic Context

| Module                            | Relationship | Key files                                                                      |
| :-------------------------------- | :----------- | :----------------------------------------------------------------------------- |
| Payment-gateway provider          | Template     | `src/providers/wompi/` (auth, context, manifest, client, errors, tools, tests) |
| Composed secret                   | Precedent    | `src/providers/woocommerce/auth.ts:16`, ADR 0018                               |
| Auth descriptor variants          | Mechanism    | `src/core/provider-port.ts:39` (`ProviderAuthDescriptor`)                      |
| Materialization (the core change) | Mechanism    | `src/core/auth/authentication-materializer.ts:19-79`                           |
| Reference delivery                | Mechanism    | ADR 0010; `src/providers/wompi/auth.ts`                                        |
| Probe and account keys            | Mechanism    | `src/core/provider-port.ts:186`, `:203`                                        |
| `controlPlane`                    | Mechanism    | `src/core/tool.ts:107`                                                         |
| Error codes and status policy     | Mechanism    | `src/core/errors.ts:6`, `src/core/http.ts:8`                                   |
| Registration                      | One line     | `src/providers/index.ts:20` (`PROVIDERS`)                                      |

**Conventions:** `add-provider` (the layer's skill), ADR 0009 (canonical provider pattern), `CONTEXT.md`.

**Next**: the Testing spike → `sandbox-evidence.md` → [`api-contract.md`](./api-contract.md) (`/api-contract-authoring`)
→ build per [`implementation-plan.md`](./implementation-plan.md) with `/tdd` → PR to `dev`.
