# Cloudbeds Write-Path — API Contract

> **Status:** Complete. Frozen on observed evidence. The one empirically-pending item (P-2 correlation)
> is documented below as a labeled hypothesis + a sandbox experiment — not a placeholder.
> **Companion:** `feature-design.md` (Approved), `api-contract-preflight.md` (Approved — consumed by this doc).
> **Scope:** booking-only. `mcp_cloudbeds_create_reservation` (new) + external-reference filter on
> `mcp_cloudbeds_list_reservations` (additive). No payment operations.
> **Last Updated:** 2026-07-10

---

## 0. Evidence provenance (three sources, per the write-path methodology)

Every wire fact below is tagged with its source. Nothing is frozen from recollection.

| Tag | Source | Reliability |
|:--|:--|:--|
| **[DOC]** | Official Cloudbeds v1.3 reference (renderable Markdown: `developers.cloudbeds.com/reference/post_postreservation-2.md`, `…/get_getreservations-2.md`) | Primary — authoritative wire definition |
| **[CODE]** | Existing provider observed working against the sandbox in the read pilot (`src/providers/cloudbeds/{client,tools,auth}.ts`) | Empirical — observed-working behavior |
| **[EMPIRICAL-PENDING]** | Requires one live sandbox observation before the write ships (see §7). Documented as hypothesis + experiment. | To be observed |

The preflight's P-1/P-3/P-4 are resolved **[DOC]**; P-2 is resolved to the parameter name **[DOC]** with
its correlation semantics **[EMPIRICAL-PENDING]**.

---

## 1. Tools in this contract

| MCP tool | Change | Cloudbeds method | OAuth scope |
|:--|:--|:--|:--|
| `mcp_cloudbeds_create_reservation` | **NEW** | `POST postReservation` | `write:reservation` **[DOC]** |
| `mcp_cloudbeds_list_reservations` | **EXTENDED** (+external-reference filter) | `GET getReservations` | `read:reservation` **[DOC]** |

**Auth-scope requirement (contract fact, [DOC]):** `postReservation` requires `write:reservation`. The
provider descriptor (`src/providers/cloudbeds/auth.ts`) currently requests read scopes only; the
implementation must add `write:reservation` to `cloudbedsAuth.scopes`, and the sandbox/production
Cloudbeds connection must be re-authorized so the token carries it. This is preparatory write-path work,
not a blocker.

**Wire invariants (all tools):**
- **Base URL** `https://hotels.cloudbeds.com/api/v1.3` **[CODE]** (observed working in the read pilot).
  *Doc discrepancy:* the reference lists `https://api.cloudbeds.com/api/v1.3` **[DOC]**. The contract
  follows the observed-working host; §7-D re-confirms it for the write path.
- **Auth:** Hop-B `Authorization: Bearer <MCP_SERVER_SECRET>` + `X-Provider-Token: <Cloudbeds OAuth token>`;
  the core reveals the credential at egress (`SecretString`, Credential-in-Transit-Only). Consumer-agnostic.
- **Context:** `propertyID` arrives via `ctx.metadata` (Explicit Context, forwarded by the consumer/Rail A),
  never as an agent argument — identical to the read tools **[CODE]**.
- **Result shaping:** provider `data` returned **verbatim** in `ok(data)` (fidelity over unification).
- **Statelessness:** no dedup/idempotency/state in the server (FD AD-3). Reconciliation is the consumer's.

---

## 2. Tool — `mcp_cloudbeds_create_reservation`

Creates a reservation (booking-only) in the property's PMS. Maps 1:1 to `postReservation`.

### 2.1 Input schema (zod — single source of truth; generates the published JSON Schema)

`propertyID` is **not** an input arg (injected from `ctx.metadata`). All wire names below are **[DOC]**.

```ts
z.object({
  // Stay
  startDate: z.string().describe('Check-in date, YYYY-MM-DD'),                 // required [DOC]
  endDate:   z.string().describe('Check-out date, YYYY-MM-DD'),                // required [DOC]

  // Primary guest
  guestFirstName: z.string().min(1),                                          // required [DOC]
  guestLastName:  z.string().min(1),                                          // required [DOC]
  guestCountry:   z.string().length(2).describe('ISO 3166-1 alpha-2'),        // required [DOC]
  guestZip:       z.string().min(1),                                          // required [DOC]
  guestEmail:     z.string().email(),                                         // required [DOC]
  guestPhone:     z.string().optional(),                                      // optional [DOC]
  guestGender:    z.enum(['M', 'F', 'N/A']).optional(),                       // optional [DOC]

  // Rooms / occupancy — arrays keyed by room type [DOC]
  rooms: z.array(z.object({
    roomTypeID: z.string(),
    quantity:   z.number().int().positive(),
    roomID:     z.string().optional(),
    roomRateID: z.string().optional(),
  })).min(1),                                                                 // required [DOC]
  adults: z.array(z.object({
    roomTypeID: z.string(),
    quantity:   z.number().int().nonnegative(),
    roomID:     z.string().optional(),
  })).min(1),                                                                 // required [DOC]
  children: z.array(z.object({
    roomTypeID: z.string(),
    quantity:   z.number().int().nonnegative(),
    roomID:     z.string().optional(),
  })).min(1),                                                                 // required [DOC]

  // Booking-only payment declaration (NO card capture — see §2.4)
  paymentMethod: z.enum(['cash', 'credit', 'ebanking', 'pay_pal']).default('cash'), // required by wire [DOC]

  // Reconciliation reference (consumer-supplied external id)
  thirdPartyIdentifier: z.string().optional(),                                // optional [DOC]

  // Misc
  estimatedArrivalTime: z.string().optional().describe('HH:mm 24h'),          // optional [DOC]
  sendEmailConfirmation: z.boolean().optional().describe('default true'),     // optional [DOC]
}).strict()
```

**Excluded by scope (booking-only):** `cardToken`, `paymentAuthorizationCode` (Stripe references),
`customFields`, `promoCode`, `allotmentBlockCode`, `groupCode`, `sourceID`, `dateCreated`,
`guestRequirements`. These exist on `postReservation` **[DOC]** but are out of the E-08 booking-only
surface; adding any payment field re-triggers the credential ADR's risk gate (FD §5).

### 2.2 Wire mapping → `postReservation`

- **Method/URL:** `POST {baseURL}/postReservation` **[DOC]**
- **Encoding:** `application/x-www-form-urlencoded` **[DOC]**
- **Body:** `propertyID` (from metadata) + the input fields above, form-encoded. Scalar fields map 1:1
  by name. **Array fields (`rooms`, `adults`, `children`) — see §7-A (empirical: exact form-urlencoded
  array serialization).**
- **Adapter job:** the tool builds a `RequestSpec` and calls `ctx.request(spec)`; the core applies the
  token at egress. Requires a new `CloudbedsClient.post(method, request, body)` (§5).

### 2.3 Success response (returned verbatim in `ok(data)`) **[DOC]**

```jsonc
{
  "success": true,
  "reservationID": "string",
  "status": "not_confirmed" | "confirmed",
  "guestID": "string",
  "guestFirstName": "string",
  "guestLastName": "string",
  "guestGender": "M" | "F" | "N/A",
  "guestEmail": "string",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "dateCreated": "YYYY-MM-DD HH:mm:ss",
  "grandTotal": 0,
  "unassigned": [
    { "subReservationID": "string", "roomTypeName": "string", "roomTypeID": "string",
      "adults": 0, "children": 0,
      "dailyRates": [ { "date": "YYYY-MM-DD", "rate": 0 } ], "roomTotal": 0 }
  ]
}
```

The adapter returns Cloudbeds' `data` verbatim; the consumer/agent interprets it. On `success:false` the
adapter maps to a typed error (§2.5), never returns a false-success.

### 2.4 Booking-only & `paymentMethod`

`postReservation` **requires** `paymentMethod` **[DOC]**. Booking-only means **no card capture** — the
tool defaults `paymentMethod: 'cash'` (a booking declaration, moves no money) and never sends
`cardToken`/`paymentAuthorizationCode`. The enum is exposed so a non-card method can be declared, but the
card/charge surface stays excluded. This satisfies the required field while keeping E-08 standard-risk.

### 2.5 Error mapping (Cloudbeds → `ProviderErrorCode`) **[CODE]** pattern + **[DOC]** statuses

| Cloudbeds outcome | `ProviderErrorCode` | Notes |
|:--|:--|:--|
| HTTP 400 / `success:false` validation | `PROVIDER_INVALID_INPUT` | Missing/invalid params; message passed through |
| HTTP 401 / 403 / invalid_token | `PROVIDER_AUTH_EXPIRED` | → consumer reconnect (incl. missing `write:reservation`) |
| HTTP 429 | `PROVIDER_RATE_LIMITED` | |
| HTTP 5xx / network | `PROVIDER_UNAVAILABLE` | |
| other `success:false` | `PROVIDER_ERROR` | `body.message` surfaced, never swallowed |

### 2.6 Examples

**Success (tool result):**
```jsonc
{ "kind": "success", "toolName": "mcp_cloudbeds_create_reservation", "providerSlug": "cloudbeds",
  "data": { "success": true, "reservationID": "12345678", "status": "confirmed", "guestID": "987",
            "startDate": "2026-08-01", "endDate": "2026-08-03", "grandTotal": 240, "unassigned": [ /* … */ ] } }
```
**Validation error (missing required field):**
```jsonc
{ "kind": "error", "code": "PROVIDER_INVALID_INPUT", "toolName": "mcp_cloudbeds_create_reservation",
  "providerSlug": "cloudbeds", "message": "Cloudbeds postReservation failed: <provider message>" }
```

### 2.7 Conformance rules

- Input JSON Schema (from zod) MUST publish `propertyID` **nowhere** (injected).
- The adapter MUST NOT send `cardToken`/`paymentAuthorizationCode` (grep-assertable).
- On `success:false`, the adapter MUST return `kind:'error'`, never `kind:'success'`.
- Provider `data` returned verbatim (no remodeling).
- 401/403 MUST map to `PROVIDER_AUTH_EXPIRED`.

---

## 3. Tool — `mcp_cloudbeds_list_reservations` (extended)

Additive: keep existing filters (`status`, `checkInFrom`, `checkInTo`) **[CODE]**; add the
external-reference filter needed for consumer-side reconciliation.

### 3.1 Added input (all optional)

```ts
// added to the existing input object:
sourceReservationId: z.string().optional()
  .describe("Filter by the source system's reservation id (external reference). See §7-B."), // [DOC]
sourceId: z.string().optional()
  .describe('Filter by source id (channel/booking-engine).'),                                 // [DOC]
```

### 3.2 Wire mapping → `getReservations` **[DOC]**

- `GET {baseURL}/getReservations?propertyID=…&…`
- Pagination: the existing tool sends `pageNumber` + `resultsPerPage` **[CODE]** (observed working).
  *Doc discrepancy:* the reference names the page-size param `pageSize` **[DOC]**. Contract follows the
  observed-working `resultsPerPage`; §7-C re-confirms during the write-path smoke.
- Response root: `{ success, data[], count, total }` **[DOC]**; the adapter returns `data` + `total`
  (existing `definePaginatedList` shape) **[CODE]**.
- Reservation object includes `thirdPartyIdentifier`, `sourceID`, `status`, dates, `guestName`, etc. **[DOC]**

### 3.3 Reconciliation semantics — **P-2 (hypothesis + experiment)**

**Observed reality [DOC]:** `postReservation` stamps the external reference as **`thirdPartyIdentifier`**.
`getReservations` exposes **no** `thirdPartyIdentifier` filter; its external-reference filters are
**`sourceId`** and **`sourceReservationId`**. The reservation object in the response **does** carry
`thirdPartyIdentifier`.

**Hypothesis (H-P2):** a reservation created with `thirdPartyIdentifier = X` is retrievable via
`getReservations?sourceReservationId=X`. (Rationale: `sourceReservationId` is documented as "reservation
source ID"; `thirdPartyIdentifier` is "the booking channel's reservation identifier" — plausibly the same
underlying value, but **the reference does not guarantee it**.)

**Experiment (E-P2) — the single pending observation:** create a sandbox reservation with a unique
`thirdPartyIdentifier=xtest-<uuid>`, then call `getReservations?propertyID=…&sourceReservationId=xtest-<uuid>`
and assert the created `reservationID` is returned.
- **If H-P2 holds:** the consumer reconciles by `sourceReservationId` (server-side filter). Contract stands.
- **If H-P2 fails:** the external filter does not correlate → the consumer reconciles by **fetching a
  bounded window** (date/status) and **matching client-side** on the response's `thirdPartyIdentifier`
  field. The MCP tool contract is unaffected (it already returns `thirdPartyIdentifier` in each object);
  only the consumer's reconciliation algorithm (its own xcale-backend FD) chooses the strategy.

Either outcome leaves this contract complete: the MCP exposes both `sourceReservationId` (filter) **and**
`thirdPartyIdentifier` (in the response) — the consumer decides. E-P2 only tells the consumer which of the
two documented strategies to use.

> ### ✅ E-P2 RESOLVED — 2026-07-15: **H-P2 FAILS**
>
> Observed through the real MCP against sandbox `320754`: a reservation created with
> `thirdPartyIdentifier=xtest-6e81b73c` is **not** returned by
> `getReservations?sourceReservationId=xtest-6e81b73c` (**0 items**). The two fields are **not** the same
> underlying value — `sourceReservationId` is an accepted filter that simply never matches our stamp.
>
> **Therefore the consumer reconciles client-side** (the fallback this section already specified): fetch a
> **bounded window** (by date/status) and match on each reservation's `thirdPartyIdentifier`, which the
> response **does** expose (verified). The **Booking gate** owns this — it is a business concern, and the
> MCP stays stateless.
>
> **The MCP contract is unaffected:** both surfaces stay exposed (`sourceReservationId` as a pass-through
> filter, `thirdPartyIdentifier` verbatim in each object). This is exactly the outcome the contract
> planned for — no rework, only a decided strategy.

### 3.4 Conformance rules

- Adding the filters MUST NOT change existing behavior when they are absent (additive).
- `sourceReservationId`/`sourceId`, when present, are passed through as query params verbatim.

---

## 4. End-to-end context (why this shape)

This contract is one hop of: **Channel (WhatsApp/Telegram/Web) → Conversational System → Booking Agent →
Booking Core (xcale-backend) → xcale-mcp-server → Cloudbeds.** Implications honored here:
- The tool is **agent-callable**: flat, explicit args; no free-form provider blobs the agent must assemble.
- **propertyID via metadata** so the agent never handles tenant/property identity (backend-driven).
- **Reconciliation stays in the consumer** (Booking Core), because duplicate-safety under channel retries
  (a dropped WhatsApp round-trip) is a business concern — the MCP stays stateless.
- **Errors are typed** so the Booking Agent can narrate "let me retry / please reconnect", not leak raw HTTP.

---

## 5. Client change — `CloudbedsClient.post()`

`client.ts` is GET-only **[CODE]**. Add, self-contained in the provider:

```ts
post(method: string, request: AuthedRequest, body: Record<string, unknown>): Promise<RequestResult>;
// builds { method: 'POST', url: `${baseUrl}/${method}`,
//          headers: { 'content-type': 'application/x-www-form-urlencoded' },
//          body: <form-encoded per §7-A> }
// token applied at egress by the core; no caching.
```

Array serialization (`rooms`/`adults`/`children`) is the one write-path wire detail to confirm (§7-A).

---

## 6. Error-code reference

`ProviderErrorCode` (existing): `PROVIDER_INVALID_INPUT`, `PROVIDER_AUTH_EXPIRED`, `PROVIDER_RATE_LIMITED`,
`PROVIDER_UNAVAILABLE`, `PROVIDER_ERROR`. Mapping in §2.5 (reused from the read tools' `errors.ts`).

---

## 7. Empirical validation required (before the write ships)

Documented per the methodology: what is **[EMPIRICAL-PENDING]**, its hypothesis, and its experiment. None
blocks writing the rest of the engineering artifacts; all resolve with **one** sandbox session.

**Chosen observation method + justification.** Run the experiments through the **real MCP tool with an
OAuth `write:reservation`-scoped sandbox connection** (the production path: chat → backend → MCP →
Cloudbeds), executed as the first **conformance test** during implementation. *Why this over a direct
`x-api-key` curl:* fidelity — it exercises the exact auth (Rail A OAuth), encoding, and error mapping the
production flow uses, and doubles as the end-to-end conformance test the roadmap already requires. A direct
`x-api-key` sandbox call (postReservation accepts `x-api-key` **[DOC]**) is the fast fallback if a wire
detail must be confirmed before the tool exists.

**ALL FOUR OBSERVED — 2026-07-15**, through the real MCP tool with the Rail A `write:reservation` token
(the production path, as the method above requires), against sandbox property `320754`.

| # | Item | Hypothesis | **Result** |
|:--|:--|:--|:--|
| **7-A** | `rooms`/`adults`/`children` form-urlencoded serialization | PHP-style bracketed arrays (`rooms[0][roomTypeID]=…`) | ✅ **CONFIRMED.** `create_reservation` via MCP → `reservationID 6767771513016`, `status: confirmed`, `grandTotal: 770`. Bracketed encoding frozen into `client.post()`. |
| **7-B** | P-2 correlation (`sourceReservationId` ↔ `thirdPartyIdentifier`) | H-P2 (§3.3) | ❌ **H-P2 FAILS — see §3.3.** Created with `thirdPartyIdentifier=xtest-6e81b73c`; `getReservations?sourceReservationId=xtest-6e81b73c` → **0 items**. The filter does **not** correlate with the stamp. The response object **does** expose `thirdPartyIdentifier` → the documented fallback (client-side match over a bounded window) is the strategy. |
| **7-C** | Page-size param name | `resultsPerPage` works (observed) but docs say `pageSize` | ⚠️ **The code was wrong — real bug, now fixed.** With 27 reservations: `resultsPerPage=2` → **27 rows** (silently ignored); `pageSize=2` → **2 rows**. The contract's "follow the observed-working `resultsPerPage`" was an artifact of a 1-reservation sandbox where nothing could be disambiguated. **The doc was right:** the tool now sends `pageSize`. Re-verified through the MCP: 2 of 28. |
| **7-D** | Base host for the write | `hotels.cloudbeds.com/api/v1.3` also serves `postReservation` | ✅ **CONFIRMED** by the 7-A create. Host stands. |

**Why 7-C matters beyond a param name:** the wrong name meant every `list_reservations` returned the
**entire** reservation set regardless of `pageSize` — an unbounded provider payload flowing straight into
the agent's context. It was invisible while the sandbox held one reservation.

**Wire trap confirmed across the board:** Cloudbeds answers a bad request with **HTTP 200 + `success:false`**
(missing param *and* ungranted scope). The status code cannot be trusted; the envelope decides. Every tool
unwraps through the shared `unwrap()`, and a test locks it in.

---

## 8. Definition of done for this contract

- [x] Request schema, response schema, encoding, error mapping, examples, conformance rules — frozen on
      **[DOC]** + **[CODE]**.
- [x] New/changed tool contracts specified (`create_reservation`, `list_reservations` filter).
- [x] Auth-scope requirement (`write:reservation`) recorded.
- [x] P-2 documented as reality + hypothesis + experiment (not a placeholder).
- [x] §7 experiments observed in sandbox → results folded in (2026-07-15, via the real MCP tool). 7-A ✅,
      7-D ✅, **7-B: H-P2 FAILS** → consumer reconciles client-side on `thirdPartyIdentifier` (§3.3),
      **7-C: the contract's `resultsPerPage` was wrong** → the tool now sends `pageSize` (a real bug the
      1-reservation sandbox had hidden).
