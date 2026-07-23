# Cloudbeds pilot — end-to-end handoff & lessons for Siigo (2026-07-09)

> **Why read this before B3–B5 of Siigo.** The Cloudbeds read-only MCP provider was taken from
> "connects but every read fails" to **fully working end-to-end** (agent → mcp-server → Cloudbeds →
> real data, all 6 tools). Every failure we hit is a failure Siigo (the next MCP provider) can hit
> too. This documents each one, the root cause, and the fix — so Siigo doesn't re-derive them.
>
> **Cross-repo:** most fixes are in **xcale-backend** (the MCP *consumer* / Rail A). The durable
> backend write-up is `xcale-backend/docs/design/mcp-client-runtime/gap-tool-catalog-visibility.md`;
> this file is the mcp-server-side index + the Siigo checklist. Commits (branch
> `feat/reference-credential-model` in both repos): mcp-server `eb9c125`; backend `6a5d31e`,
> `961c270`, `41b855a`, `2f97e24`.

## What "done" looks like (verified E2E, real data)

A user connects Cloudbeds with **pure OAuth (no form fields)**, and an agent calls all six tools with
**real property data**:

| Tool | Verified result |
| :-- | :-- |
| `get_hotel_details` | Real property (Xcale Partner Account, San Diego, USD, policies) |
| `list_room_types` | Real room types |
| `list_properties` (new) | The property the token can access — used for auto-discovery |
| `get_availability` | Real availability per date |
| `list_reservations` / `get_reservation` / `get_guest` | Real reservation + guest |

---

## The gaps we hit — and how to not repeat them in Siigo

### 1. Provider tools never reached the surfaces the UI reads (VISIBILITY)

**Symptom:** connected provider showed **0 tools** everywhere in the UI (integration panel, agent tool
catalog, agent tool picker), even though `/discover` + `tools/list` were healthy.

**Root cause (backend):** MCP tools load **per-agent-run into a per-conversation basket** (ADR-0003
tenant isolation) — they are **never** in the global `toolRegistry` nor mapped in the
`integrationRegistry`. Three UI surfaces read those global singletons, so they were empty for any MCP
provider.

**Fix:** a read-only projection (`xcale-backend/src/modules/mcp/mcp-tool-catalog.ts`) that lists each
configured provider's `tools/list` cross-referenced with the user's Rail A connection status, wired
into all three surfaces (`getIntegrationStatus`, `getToolsWithIntegrationInfo`, `GetToolGroupsUseCase`).

**For Siigo:** **nothing to do — it's generic.** Once Siigo is in `mcpToolboxes` and reaches a
`CONNECTED` Rail A connection, its tools surface automatically. Just don't assume "the server exposes
the tool" means "the UI shows it" — the projection is what makes it visible.

### 2. Required call context: DON'T collect it in a form — auto-discover it ⭐ (the big one)

**Symptom:** OAuth succeeded, but **every data read** returned `PROVIDER_ERROR: "Hotel not found"`.

**Root cause:** the provider's required context (`propertyID`) was collected in a **manual connect
form field** (ADR-0008 `connectFields`). A human pasted the **OAuth `client_id`** into that field by
mistake, so `metadata.propertyID` = the client id, which Cloudbeds rejects. This is a *data-entry trap
that will recur for any provider with a required context key.*

**Fix — declarative auto-discovery (mcp-server `eb9c125`):**
- `ProviderManifest.contextDiscovery = { key, tool, resultPath }` — Cloudbeds:
  `{ key: 'propertyID', tool: 'mcp_cloudbeds_list_properties', resultPath: '0.propertyID' }`.
- A **no-context discovery tool** `mcp_cloudbeds_list_properties` → `getHotels` (token-scoped, needs no
  propertyID).
- `createProvider` **exempts the declared discovery tool from context validation** (it cannot require
  the context it resolves — see `provider-factory.ts`).
- Backend `buildOAuthConfig` reads `contextDiscovery`: drops the manual field, registers an
  `onConnected` hook (ADR-0009) that calls the discovery tool with the fresh token, reads `resultPath`,
  and patches `metadata.{key}`. Fail-soft.

**For Siigo:** if Siigo has a **required context key** (a company/tenant/warehouse id forwarded on
every call), **declare `contextDiscovery` in its manifest and expose a no-context discovery tool.**
Do NOT ship a manual `connectFields` for it — that's the trap. If the context genuinely cannot be
discovered from the credential, document why and keep the field required, but treat manual entry as a
known error source.

> Note: `contextDiscovery` uses `resultPath` on the tool's **success `data`** (the shape produced by
> `ok(data)` → `structuredContent.data`). Keep discovery tools returning a plain array/object so the
> dot-path (`0.propertyID`) resolves.

### 3. A Connect Descriptor with NO fields must still be advertised

**Symptom:** after removing the manual field, clicking "Connect" gave **"Page Not Found" (404)**.

**Root cause (backend, ADR-0008):** the Connect Descriptor's OAuth method is emitted only when
`connectFields` is *defined*. Setting it to `undefined` made the descriptor null, so the frontend fell
back to the **legacy `connectUrl`** (`/api/{slug}/connect`, which 404s for a Rail A provider).

**Fix (backend `2f97e24`):** set `connectFields = []` (a *declared-but-empty* list = "pure OAuth, no
user input"). The descriptor then advertises the Rail A endpoint (`/api/v1/connections/{slug}/connect`)
with zero fields.

**For Siigo:** if Siigo needs no connect-form input (e.g. all context auto-discovered, credential via
Rail A), use `connectFields: []`, **never omit it.**

### 4. Config / secret sync (not a code bug, but it will bite)

**Symptom:** fresh OAuth failed at the token exchange with
`401 "The client secret supplied for a confidential client is invalid."`

**Root cause:** the `CLOUDBEDS_CLIENT_SECRET` in Doppler was stale (rotated in the provider portal, not
synced). The *old* connection kept working; the first *fresh* OAuth exposed it.

**For Siigo:** verify the client secret / API credentials in Doppler match the provider portal
**before** testing OAuth. When a provider rotates a secret, update Doppler **and restart the backend**
— secrets are injected at process start; a file-watch respawn does NOT reload them. (We also learned:
the backend runs `xcale/dev` by convention; a personal `dev_juanjo` copy exists for isolated changes —
whichever the process launched with is what counts, `doppler configure get config`.)

### 5. Operational gotchas (cost us real time)

- **mcp-server was launched without `watch`** (`tsx src/server.ts`), so it did NOT pick up code changes
  until a manual restart. The backend uses `ts-node-dev --respawn` (watches files) but **still needs a
  full restart to pick up new Doppler secrets**, and re-runs `initMcpRuntime` (provider discovery) only
  on a full process restart — so after changing the mcp-server catalog, **restart the backend** to
  re-discover it.
- **Port conflicts** (8080 / 3200): a second instance fails with `EADDRINUSE`; the *old* process keeps
  serving stale code. Kill the holder of the port before restarting.
- **Reconnect creates a NEW connection** (upsert key is `(userId, provider, accountKey)`; with
  auto-discovery `accountKey` defaults to the provider slug). A new connection id ⇒ new per-connection
  tool-name suffix (`mcp_{slug}_{verb}_{connId8}`), so any agent that had the provider's tools saved
  must be **re-pointed** to the new suffixed names (or rely on the agent-loop force-add).

### 6. Test data: the sandbox starts empty

The Cloudbeds dev property had **no accommodations**. To exercise the read tools we had to create, in
the provider PMS: room type(s) → **a base rate** (a room without a rate returns no availability) → a
reservation (which creates the guest). `get_availability` returns nothing until a **rate** exists for
the queried dates.

**For Siigo:** plan for an **empty sandbox**. Know the minimum records each read tool needs to return
non-empty (Siigo's analog of "room type + rate + reservation"), and either seed them via the provider
UI or accept that empty-but-valid responses are the expected "connected, no data yet" state.

---

## Checklist for the Siigo provider (condensed)

- [ ] **Manifest:** if a required context key exists, add `contextDiscovery` + a no-context discovery
      tool; do NOT ship a manual `connectFields` for that key.
- [ ] **Discovery tool** returns a plain `data` array/object; `resultPath` resolves against it.
- [ ] **Auth descriptor** (`credential_exchange` for Siigo) scopes/endpoints match the provider portal;
      credentials in Doppler are current.
- [ ] **Backend:** relies on the generic `buildOAuthConfig`/credential path — verify `contextDiscovery`
      flows into `onConnected`; `connectFields: []` if no user input.
- [ ] **Don't hand-verify tool visibility** — it's generic once `CONNECTED`; verify the *connection*
      reaches `CONNECTED` and the *context* is populated.
- [ ] **Restart discipline:** mcp-server first, then backend (re-discovers catalog); full restart after
      any Doppler secret change.
- [ ] **Sandbox seeding:** know the minimum records each read tool needs; expect empty-but-valid at
      first.

## Artifacts

- Backend durable write-up (root causes + code anchors): `xcale-backend/docs/design/mcp-client-runtime/gap-tool-catalog-visibility.md`
- mcp-server code: `src/providers/cloudbeds/{manifest,tools,auth}.ts`, `src/core/{provider-port,catalog,provider-factory}.ts`
- Backend code: `src/modules/mcp/{mcp-tool-catalog,mcp-bootstrap,entities}.ts`, `src/modules/integrations/service.ts`, `src/modules/user-agent-config/usecases/getToolGroups.ts`
- Commits: mcp-server `eb9c125`; backend `6a5d31e` `961c270` `41b855a` `2f97e24` (branch `feat/reference-credential-model`).
