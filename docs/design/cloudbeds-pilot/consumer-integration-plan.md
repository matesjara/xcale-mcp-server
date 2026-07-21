# Consumer Integration Plan — testing the Cloudbeds pilot in xcale-backend + xcale-frontend

> The mcp-server side of the pilot is **done and verified** (PR #5 pattern + PR #6 Cloudbeds +
> `fix/cloudbeds-review`). This plan organizes the **consumer side** — the work in the
> **xcale-backend** and **xcale-frontend** repos needed to use Cloudbeds end-to-end in xcale, and
> how to test it.
>
> **Acceptance gate (the pilot's whole point):** the full OAuth lifecycle —
> discover → connect → refresh → execute → error-handling → reconnect — must work with **zero
> Cloudbeds-specific code in xcale-backend**. The backend builds a _generic, discovery-driven_ MCP
> consumer once; it is reused by every future provider.

---

## 0. Prerequisite — make the mcp-server reachable

The backend must be able to call the mcp-server over the three pillars + Hop-B.

- **Local (recommended first):** run the mcp-server locally — `npm run dev` (pulls
  `MCP_SERVER_SECRET` etc. from Doppler `xcale-mcp-server/dev`); it listens on `PORT` (8080).
  The backend points `mcpServerUrl` at `http://localhost:8080`.
- **Deployed:** deploy the mcp-server to DO App Platform (Dockerfile/`app.yaml` like the backend),
  inject Doppler `xcale-mcp-server/prd`; `mcpServerUrl` → the service URL.
- **Shared secret (Hop B):** `MCP_SERVER_SECRET` must be the **same value** in the mcp-server's
  Doppler _and_ the backend's Doppler. (It already exists in `xcale-mcp-server` dev/prd.)

---

## 1. xcale-backend — the generic MCP consumer (Rail E KD-1)

> This is **generic** — no Cloudbeds names in code. It gets its own feature-design + PRs in the
> backend repo. Summary of what it must do:

1. **MCP client runtime** (fulfills the Rail E `source: 'mcp'` throw, KD-1). For an
   `MCPToolboxDefinition`:
   - On connect/agent-start: `POST {mcpServerUrl}` `tools/list` (and `GET {mcpServerUrl}/discover`
     for the catalog) with `Authorization: Bearer ${MCP_SERVER_SECRET}`.
   - Build a proxy `IToolExecutor` per discovered tool (the same adapter trick the Composio loader
     uses), namespaced `mcp_{slug}_{verb}`.
   - On execute: `tools/call` forwarding the **decrypted Rail A token** as `X-Provider-Token` and the
     routing context as the **`X-Provider-Metadata`** header — an opaque JSON object (base64-encoded
     is header-safe), e.g. `{ "propertyID": "<accountKey>" }`. The backend forwards the connection's
     `metadata` bag (populated at connect time) as-is; the catalog `contextSchema` documents the keys
     the provider requires, and the server's `metadataSchema` validates them. (Wire mechanism added
     server-side in `extractProviderMetadata`; absent/malformed metadata → `PROVIDER_INVALID_INPUT`
     before any provider call.)
   - Map the result into `StandardToolResult`; map `structuredContent.code === 'PROVIDER_AUTH_EXPIRED'`
     → `markConnectionAuthFailure()` + `reconnectRequiredResult()`.
2. **Rail A as a generic OAuth executor** — drive OAuth from the **discovered `authDescriptor`**
   (`authorizationUrl`, `tokenUrl`, `scopes`, `tokenPlacement`, `supportsRefresh`). No per-provider
   `registerOAuthProvider` code. Cloudbeds `clientId/clientSecret` live in backend Doppler
   (`CLOUDBEDS_CLIENT_ID`, `CLOUDBEDS_CLIENT_SECRET`) — generic config, not code.
3. **`MCPToolboxDefinition` for cloudbeds** — `id: 'cloudbeds'`, `mcpServerUrl`, display metadata
   (or sourced from the catalog), `connection: oauth`. This is the **only** per-provider touch on
   the backend, and it is config/data, not logic.
4. **SSRF allowlist** — validate `mcpServerUrl` against a config allowlist before any outbound call
   (foundation Q-3).

**Backend Doppler keys to add:** `MCP_SERVER_SECRET` (same as mcp-server), `CLOUDBEDS_CLIENT_ID`,
`CLOUDBEDS_CLIENT_SECRET`, and the `mcpServerUrl` (config or per-env).

---

## 2. xcale-frontend — connect + render

> Own feature-design/PR in the frontend repo. Summary:

1. **Connect Cloudbeds** in the integrations UI → backend connect endpoint (existing pattern with
   `redirectPath`) → Cloudbeds OAuth → return with `&connection=success`. The user picks/links the
   property (so the backend knows the `propertyID` to forward as context).
2. **Connection status** — connected / reconnect-required, using the existing connections surface.
3. **Tool result rendering** — a generic MCP tool-result card (reuse the Composio result component
   pattern); Cloudbeds-specific cards optional later.

---

## 3. End-to-end pilot test (the validation)

Run in order; this is the §10 gate made concrete:

1. mcp-server reachable (local or deployed); shared `MCP_SERVER_SECRET` set on both sides.
2. Backend discovers cloudbeds via `discover`/`tools/list` (no Cloudbeds code added — only the
   `MCPToolboxDefinition` data entry + Doppler secrets).
3. In the frontend, **connect** a Cloudbeds **sandbox** property (OAuth) → Rail A stores the token.
4. In an agent conversation, call `list_reservations` → results render. Try `get_hotel_details`,
   `get_availability`.
5. **Force a 401** (revoke/expire the token) → the agent surfaces a **reconnect** prompt
   (`PROVIDER_AUTH_EXPIRED` → `markConnectionAuthFailure`).

**Success = all of the above pass AND** the only backend change for Cloudbeds was the
`MCPToolboxDefinition` data entry + Doppler secrets (no provider-specific code). If anything forced
provider-specific backend logic, revisit the architecture before adding the next provider.

---

## 4. Open items to confirm during this phase

- Exact Cloudbeds **OAuth scope strings** + single-get param names (`reservationID`, `guestID`,
  availability dates) against a live sandbox; the mcp-server adapter is the only place to adjust.
- **Sandbox property + token** for the e2e test (and an opt-in smoke test in the mcp-server).
- **R-1**: read-first is standard-risk; before adding any write/payment tool, run the
  ephemeral-references security re-evaluation (`credential-forwarding-and-token-model`).

## References

- mcp-server side: `docs/design/cloudbeds-pilot/feature-design.md` + `work-log.md`,
  ADR `canonical-provider-pattern`, `docs/architecture-review.md`.
- Catalog/contract the backend consumes: `GET /discover`, `tools/list`, `tools/call`
  (`docs/adr/three-pillar-mcp-contract-with-discovery.md`).
- Backend hooks: Rail E `MCPToolboxDefinition` (KD-1), Rail A connection lifecycle (ADR-0005).
