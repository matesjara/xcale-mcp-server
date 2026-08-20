# Feature Design — Cloudbeds (pilot provider, end-to-end)

- **Status:** Design — not implemented. (Per request: design only, plan it well; implement nothing yet.)
- **Date:** 2026-06-19 · **Branch:** `feat/cloudbeds-pilot-design` · **Owner:** Juan José
- **Type:** Cross-repo pilot. The **first real provider** on the new MCP platform, and the proof
  that the whole chain (mcp-server ↔ xcale-backend ↔ xcale-frontend) works.
- **Depends on:** the protocol skeleton (PR #1, `feat/protocol-skeleton`) being merged to `dev`.
- **Design layer:** the architecture is locked — this plans a concrete provider against it. Read
  `docs/architecture-review.md` and the ADRs first; this doc references them, it does not re-decide.

---

## 1. Why Cloudbeds, why a pilot

[Cloudbeds](https://www.cloudbeds.com/) is a hospitality management platform (PMS + booking +
channel manager). It has a documented REST API (v1.2) with OAuth 2.0 — a realistic, non-trivial
provider that exercises **OAuth (not just api_key)**, **multi-property accounts**, **PII-heavy
data**, and a **curated tool subset** (the API is large). That makes it the right pilot: if
Cloudbeds flows through the system cleanly, the platform is validated for real providers.

**The pilot proves four things at once:**
1. A provider added (almost) entirely inside `src/providers/cloudbeds/` (Provider Self-Containment §10).
2. The backend consuming it **generically** via discovery — fulfilling Rail E KD-1 (the MCP client runtime).
3. Rail A running OAuth from the **discovered `authDescriptor`** (knowledge in server, custody in Rail A).
4. The end-to-end UX: a user connects Cloudbeds in xcale-frontend and an agent uses its tools.

---

## 2. Goal & non-goals

**Goal:** a user connects their Cloudbeds property in xcale, and an xcale agent can read
reservations / availability / guest info through MCP tools — with credentials custodied by Rail A
and provider knowledge owned by the MCP server.

**Non-goals (pilot):**
- No write/mutating operations beyond, at most, one low-risk create (see §6 — default is **read-first**).
- No full Cloudbeds API coverage — a **curated** high-signal toolset only.
- No new shared infrastructure in the MCP server (no DB/queue/etc. — *complexity on demand*).
- No bespoke per-provider code in xcale-backend (only generic, discovery-driven consumer runtime).

---

## 3. End-to-end architecture (three repos, one chain)

```
┌──────────────── xcale-frontend ────────────────┐
│ "Connect Cloudbeds" → OAuth redirect            │
│ Connection status · agent uses Cloudbeds tools  │
└───────────────┬─────────────────────────────────┘
                │ REST (existing xcale API)
┌───────────────▼──────────── xcale-backend (CONSUMER) ───────────────┐
│ Rail A: runs Cloudbeds OAuth from the DISCOVERED authDescriptor,     │
│         stores/refreshes the token (custody).                        │
│ Rail E (KD-1): MCP client runtime — server/discover → tools/list →   │
│         proxy IToolExecutor per tool → tools/call (forwards token).  │
│ Agent: calls the tools like any native/Composio tool.               │
└───────────────┬──────────────────────────────────────────────────────┘
                │ MCP (3 pillars) · Hop B Bearer · X-Provider-Token (per call)
┌───────────────▼──────────── xcale-mcp-server (THIS REPO) ───────────┐
│ src/providers/cloudbeds/ : authDescriptor (oauth2) · curated tools · │
│   client · error mapping · metadata (propertyID). Discoverable.      │
└───────────────┬──────────────────────────────────────────────────────┘
                │ HTTPS (Cloudbeds API v1.2, token at egress only)
        ┌───────▼────────┐
        │  Cloudbeds API  │  https://hotels.cloudbeds.com/api/v1.2/{method}
        └────────────────┘
```

### 3.1 Connect flow (Rail A, generic)
1. Frontend → backend: "connect cloudbeds" (with optional `redirectPath`).
2. Backend reads the `cloudbeds` `authDescriptor` from `GET /discover` (cached): `authorizationUrl`,
   `scopes`, `tokenUrl`, `tokenPlacement`. It does **not** hardcode these.
3. Rail A builds the OAuth authorize URL using the descriptor + the `clientId`/`clientSecret` from
   **backend Doppler** (generic config), redirects the user to Cloudbeds.
4. Callback → Rail A exchanges the code at `tokenUrl`, stores the token **encrypted at rest**,
   keyed `(userId, 'cloudbeds', accountKey=propertyID)` — multi-property is first-class.

### 3.2 Tool execution flow (per agent call)
1. Agent selects e.g. `mcp_cloudbeds_list_reservations`.
2. Backend MCP client runtime: decrypts the Rail A token → `POST /mcp tools/call` with
   `Authorization: Bearer <hopB>` + `X-Provider-Token: <token>` + metadata `{ propertyID }`.
3. MCP server: routes to the cloudbeds adapter; calls Cloudbeds API with the token at egress; maps
   the result to a typed `ToolResult`.
4. On Cloudbeds 401/403 → `PROVIDER_AUTH_EXPIRED` → backend `markConnectionAuthFailure()` →
   frontend shows "reconnect Cloudbeds".

---

## 4. Auth model (Cloudbeds OAuth 2.0)

| Item | Value (confirm exact values against live docs during impl) |
|:--|:--|
| Flow | OAuth 2.0 authorization code |
| `authorizationUrl` | `https://hotels.cloudbeds.com/api/v1.2/oauth` |
| `tokenUrl` | `https://hotels.cloudbeds.com/api/v1.2/access_token` |
| `tokenPlacement` | `bearer_header` (Cloudbeds also accepts `x-api-key`; we use bearer) |
| `supportsRefresh` | true (refresh token) |
| Scopes (read-first pilot) | representative: `read:reservation`, `read:guest`, `read:room`, `read:hotel`, `read:rate` — **exact scope strings to be confirmed per endpoint in the Cloudbeds API docs** |

The `ProviderAuthDescriptor` (in `src/providers/cloudbeds/auth.ts`) publishes the **non-secret**
parts above via `server/discover`. `clientId`/`clientSecret` live **only** in backend Doppler.

> **Open decision (risk classification) — must be signed off before go-live.** Cloudbeds handles
> guest **PII** and reservation data (and is payment-adjacent), though it is not a payment gateway
> like ePayco/Siigo. Does it trigger the credential ADR's "financial or high-risk" gate (ephemeral
> references / token exchange before go-live)? **Proposed:** treat the **read-first** pilot as
> standard-risk → MVP direct forwarding **with** the mandatory `SecretString` guardrails; **re-evaluate
> against the ephemeral-references gate if/when write or payment-touching operations are added.**
> See `docs/adr/0003-credential-forwarding-and-token-model.md` + `docs/security/credential-boundary-review.md`.

---

## 5. The Cloudbeds provider (mcp-server side)

Lives **only** in `src/providers/cloudbeds/` (the §10 test). Structure per the `add-provider` recipe:

```
src/providers/cloudbeds/
├── manifest.ts   # slug 'cloudbeds', displayName, category 'hospitality', schemaVersion,
│                 # providerVersion, metadataSchema (zod: { propertyID: string })
├── auth.ts       # ProviderAuthDescriptor (oauth2, §4) — non-secret
├── client.ts     # thin Cloudbeds API v1.2 client (form-encoded; token at egress; no caching)
├── tools/        # one file per tool (curated; zod schemas)
├── errors.ts     # Cloudbeds HTTP/status → ProviderErrorCode
├── provider.ts   # IProvider impl
└── __fixtures__/ + __tests__/  # recorded responses + conformance + behavior
```

### 5.1 Curated tools (read-first pilot)

Author-time curation — the high-signal subset, not the whole API:

| Tool | Cloudbeds method | Purpose |
|:--|:--|:--|
| `mcp_cloudbeds_list_reservations` | `getReservations` | List reservations (filters: dates, status). |
| `mcp_cloudbeds_get_reservation` | `getReservation` | One reservation's detail. |
| `mcp_cloudbeds_get_guest` | `getGuest` / `getGuestList` | Guest info. |
| `mcp_cloudbeds_get_availability` | `getAvailableRoomTypes` | Availability for a date range. |
| `mcp_cloudbeds_list_room_types` | `getRoomTypes` | Room types + rates. |
| `mcp_cloudbeds_get_hotel_details` | `getHotelDetails` | Property metadata. |

(Optional, behind a later decision: `mcp_cloudbeds_create_reservation` → `postReservation` — a
write op that would re-trigger the §4 risk re-evaluation. **Out of the read-first pilot scope.**)

### 5.2 Error mapping (`errors.ts`)

| Cloudbeds response | `ProviderErrorCode` |
|:--|:--|
| 401 / 403 / invalid_token | `PROVIDER_AUTH_EXPIRED` |
| 429 / rate limit | `PROVIDER_RATE_LIMITED` |
| 5xx / network | `PROVIDER_UNAVAILABLE` |
| 400 / validation | `PROVIDER_INVALID_INPUT` |
| other | `PROVIDER_ERROR` |

### 5.3 Multi-property

A user may manage several Cloudbeds properties. `propertyID` travels as opaque, provider-scoped
`metadata` (validated by `metadataSchema`), mapped to Rail A's `accountKey`. No consumer-domain
identity on the wire (Consumer-Agnostic).

---

## 6. xcale-backend work (consumer — fulfills Rail E KD-1)

> This is the **Phase-4** dependency. It is generic (discovery-driven), built **once**, and serves
> every future MCP provider — not Cloudbeds-specific code. It gets its **own** feature design + PRs
> in the xcale-backend repo; summarized here so the pilot is planned whole.

1. **MCP client runtime** — for any `MCPToolboxDefinition` (`source: 'mcp'`): call `server/discover`
   + `tools/list` on `mcpServerUrl`, build proxy `IToolExecutor`s per discovered tool, route
   `tools/call` forwarding the decrypted token + metadata, map results → `StandardToolResult`
   (and `PROVIDER_AUTH_EXPIRED` → reconnect). Replaces the Rail E KD-1 `throw`.
2. **Rail A generic OAuth executor** — drive OAuth from the discovered `authDescriptor` (not
   per-provider `registerOAuthProvider` code). Cloudbeds = config (Doppler `clientId/secret`) + a
   `MCPToolboxDefinition` entry, not bespoke logic.
3. **`MCPToolboxDefinition` for cloudbeds** — `id: 'cloudbeds'`, `mcpServerUrl`, display metadata
   (or sourced from the catalog), connection = OAuth.
4. **SSRF allowlist** — `mcpServerUrl` validated against an allowlist (foundation Q-3, backend-side).

---

## 7. xcale-frontend work

> Gets its own feature design/PR in the frontend repo. Summary:

- **Connect Cloudbeds** in the integrations UI → backend connect endpoint (existing pattern,
  `redirectPath` supported) → Cloudbeds OAuth → back with `&connection=success`.
- **Connection status** (connected / reconnect-required) using the existing connections surface.
- **Tool result rendering** — a generic MCP tool result card (reuse the Composio result component
  pattern); Cloudbeds-specific cards optional later.

---

## 8. Testing plan (the pilot acceptance)

**mcp-server (this repo):**
- Conformance suite (the reusable one) + behavior tests with recorded Cloudbeds fixtures.
- Integration: `server/discover` exposes cloudbeds + its `authDescriptor`; `tools/list`/`tools/call`
  round trip against a mocked Cloudbeds client; 401 → `PROVIDER_AUTH_EXPIRED`.
- (If available) a smoke test against the Cloudbeds **sandbox** with a real token.

**xcale-backend:**
- Connect flow e2e (OAuth happy path + reconnect on forced 401).
- Agent tool call e2e: `list_reservations` returns data mapped to `StandardToolResult`.

**xcale-frontend:**
- Connect → status → an agent conversation that calls a Cloudbeds tool and renders the result.

**Pilot is successful when:** a real (sandbox or live) Cloudbeds property is connected in xcale-front
and an agent lists its reservations end-to-end — AND the §10 criteria below hold.

---

## 9. Success criteria (§10 architecture-review, applied to Cloudbeds)

- ✅ Cloudbeds added only under `src/providers/cloudbeds/` (+ one line in `src/providers/index.ts`).
- ✅ No change to the public protocol/catalog to add it.
- ✅ No Cloudbeds-specific logic in xcale-backend (only generic discovery-driven runtime + config).
- ✅ No `switch`/`if`/special registration in shared infra for Cloudbeds.
- ✅ Automated tests validate the descriptor, tools, and contract with no manual exceptions.

If any fails → revisit the architecture before adding the next provider (do not patch).

---

## 10. Risks & open decisions

| # | Item | Disposition |
|:--|:--|:--|
| R-1 | **Risk classification / token model** (§4) | Open — sign off before go-live; read-first = standard-risk proposed. |
| R-2 | Exact OAuth **scopes** per endpoint | Confirm against live Cloudbeds docs during impl. |
| R-3 | Cloudbeds **rate limits** | Map 429 → `PROVIDER_RATE_LIMITED`; consider backoff in the client. |
| R-4 | **Sandbox** availability for e2e | Confirm a Cloudbeds test property/app; else mock + one live smoke. |
| R-5 | Backend MCP client runtime is **net-new** (Phase 4) | Largest effort; generic + reused by all providers; own feature design. |
| R-6 | Form-encoded API + date formats | Encapsulated in `client.ts`; never leaks past the adapter. |

---

## 11. Phasing (ordered PRs across repos)

1. **(mcp-server)** Cloudbeds adapter — `feat/cloudbeds-provider` → PR to `dev`. *(after skeleton PR #1 merges)*
2. **(xcale-backend)** Generic MCP client runtime + Rail A generic OAuth (Rail E KD-1) — own design + PR.
3. **(xcale-backend)** `MCPToolboxDefinition` for cloudbeds + SSRF allowlist.
4. **(xcale-frontend)** Connect UI + tool result rendering.
5. **Pilot validation** — connect a sandbox property, run the agent e2e, check §9.

> Grill this design (`/grill`) before implementing step 1 — especially R-1 (risk classification)
> and the exact tool/scope set.

---

## 12. References

- Cloudbeds API: [auth quickstart](https://developers.cloudbeds.com/v1.2/docs/quickstart-guide-api-authentication-for-property-level-users) ·
  [OAuth 2.0 method](https://developers.cloudbeds.com/docs/alternative-oauth-20-authentication-method) ·
  [API intro](https://cloudbedsintegrations.zendesk.com/hc/en-us/articles/360006524513-Introduction-to-Cloudbeds-API)
- Internal: `docs/architecture-review.md` (§0 principles, §4 contracts, §10 success criteria) ·
  ADRs: provider-knowledge-vs-credential-custody, three-pillar-mcp-contract-with-discovery,
  credential-forwarding-and-token-model · `docs/security/credential-boundary-review.md` ·
  `add-provider` skill.
- Backend consuming side: `xcale-backend` Rail E `MCPToolboxDefinition` (KD-1), Rail A connection
  lifecycle (ADR-0005).
