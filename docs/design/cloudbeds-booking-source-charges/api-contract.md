# Cloudbeds booking-source charges — API Contract

> Issue: matesjara/xcale-mcp-server#113 · Consumer: matesjara/xcale-backend#1229 (PR #1230)
> Status: in review · Date: 2026-09-28

A tax or fee a Cloudbeds property configures is charged on a reservation **only when the property
applies it to the reservation's source** (Settings → Property → Sources → Configure Taxes/Fees).
`getTaxesAndFees` lists what is configured; it does not say where it is applied. This contract adds
the read that does.

## 0. Evidence provenance

| Tag        | Source                                                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[WIRE]** | `GET getSources` against property 199593 (Casa Coral) and 20064 (Biohabitat), 2026-09-28, read-only, tenant tokens                                                            |
| **[DOC]**  | Cloudbeds API reference, `get_getsources-2` (response schema, scope `read:reservation`); Cloudbeds help center, _Set Up and Apply Taxes and Fees_ (Step 2 — apply to sources) |
| **[CODE]** | `mcp_cloudbeds_get_property_configuration` partial-failure semantics (`src/providers/cloudbeds/tools.ts`)                                                                     |

**Observed [WIRE], property 199593:** `200`, `{ success: true, data: [[…12 sources…]], count }` — the
source list is nested one level inside `data`. Each source:
`{ propertyID, sourceID, sourceName, isThirdParty, status, commission, paymentCollect, taxes[], fees[] }`,
amounts as strings (`"0.00000"`). `s-1 Website/Booking Engine` carries only `IVA · inclusive`. The
property's `Tarjeta` (5%, exclusive, tax) and `Paypal` (6%, exclusive, fee) appear in `getTaxesAndFees`
and on **no** source. `propertyID` and `propertyIDs` as the query parameter answer the same.
**Property 20064:** `s-1` carries no tax and no fee.

## 1. Tools in this contract

| Tool                                       | Change                                 |
| ------------------------------------------ | -------------------------------------- |
| `mcp_cloudbeds_get_property_configuration` | **Extended** — a fifth part, `sources` |

No new tool: "how is this property set up?" is one question, and a separate tool would compete for the
agent's attention with the one it already calls.

## 2. `mcp_cloudbeds_get_property_configuration` (extended)

### 2.1 Input

Unchanged: `{}` (strict).

### 2.2 Wire mapping

| Part           | Endpoint                        | Scope                      |
| -------------- | ------------------------------- | -------------------------- |
| `appSettings`  | `getAppPropertySettings`        | `read:appPropertySettings` |
| `currency`     | `getCurrencySettings`           | `read:currency`            |
| `taxesAndFees` | `getTaxesAndFees`               | `read:taxesAndFees`        |
| `customFields` | `getCustomFields`               | `read:customFields`        |
| **`sources`**  | **`getSources`** (`propertyID`) | **`read:reservation`**     |

`read:reservation` is already requested by the reservation tools, so the derived OAuth scope set does
not change and no tenant has to reconnect.

### 2.3 Success response

```jsonc
{
  "appSettings": {
    /* verbatim */
  },
  "currency": {
    /* verbatim */
  },
  "taxesAndFees": [
    /* verbatim */
  ],
  "customFields": [
    /* verbatim */
  ],
  "sources": [
    {
      "propertyID": "199593",
      "sourceID": "s-1",
      "sourceName": "Website/Booking Engine",
      "isThirdParty": false,
      "status": true,
      "commission": 0,
      "paymentCollect": "hotel",
      "taxes": [
        {
          "taxID": "201836",
          "name": "IVA",
          "amount": "0.00000",
          "amountType": "percentage",
          "type": "inclusive",
        },
      ],
      "fees": [],
    },
    // … every source of the property
  ],
  "unavailable": {
    /* present only when a part failed: part → reason */
  },
}
```

- `sources` is the provider's list, **flattened** from `data[0]` when Cloudbeds nests it; a flat list is
  passed through. Every field is verbatim — amounts stay strings, `type` is `inclusive | exclusive`.
- `taxes[]` and `fees[]` are what the property **applied** to that source. A tax or fee configured in
  `taxesAndFees` but absent from a source is not charged on reservations from that source.

### 2.4 Partial failure

Unchanged semantics, now over five parts:

- One part failing → the others are returned, the failed part is **absent** (never `[]`) and named in
  `unavailable`, and the message says `Partial: <parts> unavailable`.
- All five failing → error; `AUTH_EXPIRED` when every failure is an ungranted scope, `PROVIDER_ERROR`
  otherwise.

An empty `sources` would read as "no source carries any tax" — a claim. A missing `sources` with
`unavailable.sources` is an admitted unknown.

### 2.5 Conformance rules

1. `sources` never appears as `[]` when `getSources` failed.
2. The nesting is removed exactly once; the source objects are not reshaped.
3. Consumer-agnostic: no consumer concept (which source a consumer books with, what it adds to a price)
   is in the tool — the tool reports what Cloudbeds applies where.

## 3. Consumer guidance (non-normative)

A consumer pricing a stay booked through source `X` adds the **exclusive** taxes and fees of
`sources[sourceID = X]` and nothing else from `taxesAndFees`. Configured exclusive entries applied to
no source are charges the property adds by hand (a card surcharge, say): a consumer can name them, but
must not add them to the price. When `sources` is unavailable, the applied charges are unknown.

## 4. Definition of done

- [x] Wire observed on two properties (§0).
- [x] Tests: five-part composition, nesting flattened, flat list accepted, denied `getSources` reported
      as unavailable (`administrative.test.ts`).
- [ ] Merged into `dev` before the consumer (matesjara/xcale-backend#1230) ships.
