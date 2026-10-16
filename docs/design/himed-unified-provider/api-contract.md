# API Contract — HiMed unified multi-credential provider

> Companion to `feature-design.md` in this folder. English prose (mcp-server docs convention). This is
> an **atypical** contract: HiMed exposes no new REST endpoints — the surface is the MCP provider
> contract (authDescriptor shape, credential groups, the materializer, `buildCredentialConfig`, and the
> tool set). All concrete values (hosts, endpoints, field names, formats) are **sandbox-verified**
> (ship-log 2026-10-01), not assumed.

## 0. Metadata

| Field | Value |
|:--|:--|
| **Slug** | `himed-unified-provider` |
| **Status** | Draft (for review) |
| **Repos** | `xcale-mcp-server` (core + provider) · `xcale-backend` (consumer) |
| **Decisions honored** | probe = directory-only (`list_locations`); injection = (a) group-aware materializer |

---

## 1. Core auth contract change (mcp-server)

Today `materialize(auth, resolved)` reveals **one** secret (`resolved.secret`, `auth.fields[0]`) and
injects it into every call. The change makes a provider able to declare **credential groups** and lets
each tool pick its group. Additive — single-secret providers are unchanged.

### 1.1 Types (`src/core/provider-port.ts`)

```ts
export interface AuthField {
  key: string;        // e.g. 'api_key', 'token'
  label: string;
  placement?: string; // 'header' | 'query' | 'body'
}

/** A named credential used by a subset of a provider's tools. */
export interface CredentialGroup {
  key: string;            // 'demograficos' | 'directorio' | 'autoagendamiento'
  label: string;          // human label for the connect form
  field: AuthField;       // the secret this group injects (one secret per group)
}

export interface ProviderAuthDescriptor {
  type: string;                    // 'api_key' (HiMed)
  credentialDelivery?: string;     // 'forwarded'
  fields?: AuthField[];            // single-group providers (unchanged, back-compat)
  groups?: CredentialGroup[];      // NEW: multi-credential providers
}
```

```ts
// ToolDefinition gains an optional group tag (src/core/tool.ts)
export interface ToolDefinition<I, C = unknown> {
  // …existing…
  credentialGroup?: string; // which CredentialGroup.key this tool's secret comes from
}
```

### 1.2 Resolved credential bundle (`src/core/credential/resolved-credential.ts`)

```ts
export interface ResolvedCredential {
  secret: SecretString;                       // single-secret providers (unchanged)
  secrets?: Record<string, SecretString>;     // NEW: named bundle, keyed by CredentialGroup.key
  // …existing context…
}
```

### 1.3 Materializer (`src/core/auth/authentication-materializer.ts`)

```ts
// group is passed by the dispatcher from the called tool's `credentialGroup`.
export function materialize(
  auth: ProviderAuthDescriptor,
  resolved: ResolvedCredential,
  group?: string,
): HttpRequest;
```

Behavior:
- **No `group`** (single-secret providers): unchanged — `auth.fields[0]` + `resolved.secret`.
- **With `group`**: look up `auth.groups[].key === group` → use that group's `field` + `resolved.secrets[group]` for the single `.reveal()`. The handler still never sees the secret (Credential-in-Transit-Only preserved — decision (a)).
- Missing group field or missing `secrets[group]` → throw (fail closed; never send unauthenticated).

### 1.4 Dispatch wiring

When the gateway dispatches `tools/call`, it reads the called `ToolDefinition.credentialGroup` and passes it to `materialize`. `codigo_servicio` (non-secret context) stays handler-placed, read from `ctx.metadata`, exactly as the scheduling handlers do today.

---

## 2. Published CatalogEntry (`himed`)

```jsonc
{
  "slug": "himed",
  "displayName": "HiMed",
  "category": "health",
  "authDescriptor": {
    "type": "api_key",
    "credentialDelivery": "forwarded",
    "groups": [
      { "key": "demograficos",     "label": "Demográficos token",     "field": { "key": "api_key", "label": "API key (Demográficos)", "placement": "body" } },
      { "key": "directorio",       "label": "Service token (directory)", "field": { "key": "api_key", "label": "Service token",         "placement": "body" } },
      { "key": "autoagendamiento", "label": "Autoagendamiento token",  "field": { "key": "token",   "label": "Token",                 "placement": "body" } }
    ]
  },
  "contextSchema": {
    "type": "object",
    "properties": { "codigo_servicio": { "type": "string" } },
    "required": ["codigo_servicio"]
  },
  "connectionProbe": { "tool": "mcp_himed_list_locations" },
  "accountContextKeys": ["codigo_servicio"]
}
```

- No `connectWithoutProbe` (reverted): the probe is `list_locations` (directory group), a real read.
- `accountContextKeys: ['codigo_servicio']` → one clinic = one `codigo_servicio` = one connection identity.

---

## 3. Unified tool set (`himed`) with credential groups

All tool names collapse to the `mcp_himed_*` namespace. Wire values are sandbox-verified.

| Tool | Group | Host (`baseUrl` env) | Wire call | Notes |
|:--|:--|:--|:--|:--|
| `mcp_himed_create_patient` | demograficos | `HIMED_BASE_URL` | POST `Demograficos/crearPaciente.php` | `fecha_nacimiento` **YYYY-MM-DD** |
| `mcp_himed_update_patient` | demograficos | `HIMED_BASE_URL` | POST `Demograficos/modificarPaciente.php` | |
| `mcp_himed_change_patient_document` | demograficos | `HIMED_BASE_URL` | POST `Demograficos/modificarIdTipoIdPaciente.php` | |
| `mcp_himed_list_locations` | directorio | `HIMED_BASE_URL` | POST `Sedes/consultarSedes.php` | **connectionProbe** |
| `mcp_himed_list_doctors` | directorio | `HIMED_BASE_URL` | POST `Usuarios/consultarUsuarios.php` | curated (PHI allow-list) |
| `mcp_himed_patient_exists` | autoagendamiento | `HIMED_SCHEDULING_BASE_URL` | `accion: existePaciente` | identityPolicy subject-scoped |
| `mcp_himed_list_specialties` | autoagendamiento | scheduling | `accion: listarEspecialidades` | |
| `mcp_himed_list_professionals` | autoagendamiento | scheduling | `accion: listarUsuarios` | |
| `mcp_himed_list_modalities` | autoagendamiento | scheduling | `accion: listarModalidades` | |
| `mcp_himed_list_appointment_types` | autoagendamiento | scheduling | `accion: listarTiposCitas` | |
| `mcp_himed_get_availability` | autoagendamiento | scheduling | `accion: consultarDisponibilidad` | professional = **`idEspecialista`** |
| `mcp_himed_create_appointment` | autoagendamiento | scheduling | `accion: CrearCita` | result returns `idCita` only |
| `mcp_himed_list_patient_appointments` | autoagendamiento | scheduling | `accion: citasPaciente` | `forma: 'texto'`; identityPolicy subject-scoped |
| `mcp_himed_cancel_appointment` | autoagendamiento | scheduling | `accion: cancelarCita` | **requires `idPaciente`** |

**Name collision to resolve:** `himed-directory` and `himed-scheduling` both had a `list_locations`
(Sedes). In the unified provider, the **directory** `list_locations` is canonical (and the probe). The
scheduling `listarSedes` tool is **dropped** in favor of it — see Open Question OQ-1 (confirm directory
`idSede` ≡ scheduling `idSede`, which the sandbox suggested: both returned `idSede: 1` "Poblado").

**Body shapes (sandbox-verified):**
- demograficos/directorio: `{ ...payload, api_key }` (api_key injected by materializer per group).
- autoagendamiento: `{ accion, ...fields, codigo_servicio, token }` (`codigo_servicio` handler-placed from `ctx.metadata`; `token` materializer-injected).

---

## 4. Backend consumer contract (`xcale-backend`)

### 4.1 `McpCatalogEntry` (`src/modules/mcp/entities.ts`)

```ts
export interface McpAuthDescriptor {
  type: string;
  credentialDelivery?: string;
  fields?: Array<{ key: string; label: string; placement?: string }>;
  groups?: Array<{                 // NEW — mirrors the published catalog
    key: string;
    label: string;
    field: { key: string; label: string; placement?: string };
  }>;
}
```
Remove `connectWithoutProbe` (reverts ADR 0065).

### 4.2 `buildCredentialConfig` (`src/modules/mcp/mcp-bootstrap.ts`)

- **Form:** when `authDescriptor.groups` is present, the connect form is: the required `contextSchema`
  keys (`codigo_servicio`, text) + **one secret field per group** (`demograficos`, `directorio`,
  `autoagendamiento`). Today the function throws on >1 secret; it now accepts N **named** secrets when
  they come from `groups`.
- **Probe:** call `connectionProbe.tool` (`mcp_himed_list_locations`). Since that tool is the
  `directorio` group, the gateway materializes it with the directory secret. A 200 validates the
  connection (directory-only probe, by decision). Demográficos/Autoagendamiento validate on first use.
- **Storage (`MappedCredential`):** the credential is a **bundle** — a JSON object of the named secrets,
  stored encrypted (the `credential_exchange` pattern: credential-as-JSON), not a single `accessToken`.
  `codigo_servicio` → `metadata` and the `accountKey`.
- **Forward:** on `tools/call`, forward the bundle. `McpCallArgs` gains `credentials?: Record<string,string>`
  (named secrets); the gateway builds `ResolvedCredential.secrets` from it and materializes per the
  tool's group. Single-secret providers keep using `token`.

### 4.3 Vertical scope (`register-vertical-scopes.ts`)
One `himed` on the `health` axis (remove `himed-directory` and `himed-scheduling`). One agent, one turn,
all tools (AD-2).

### 4.4 i18n
One `himed.connect.*` block with the three secret-field labels + `codigo_servicio`, ES/EN. Remove the
`himed-directory.*` and `himed-scheduling.*` connect blocks.

---

## 5. Phase 3 ripple (tool-name map)

| Lifecycle-messages reference (today) | New |
|:--|:--|
| observer `HIMED_BOOKING_TOOL_NAME = 'mcp_himed-scheduling_create_appointment'` | `'mcp_himed_create_appointment'` |
| observer `matches` providerSlug `'himed-scheduling'` | `'himed'` |
| verifier `connectionsOf('himed-scheduling')` | `connectionsOf('himed')` |
| verifier read tool `mcp_himed-scheduling_list_patient_appointments` | `mcp_himed_list_patient_appointments` |
| `codigo_servicio` from the himed-scheduling connection | from the unified himed connection metadata |

Logic unchanged — rename + repoint only.

---

## 6. What gets reverted from Option A

| Artifact | Action |
|:--|:--|
| mcp-server `src/providers/himed-directory/` | delete (tools fold back into `himed`) |
| mcp-server `connectWithoutProbe` (manifest + core catalog field) | remove |
| mcp-server `himed-scheduling` provider | fold into `himed` (scheduling group) |
| backend `himed-directory` + `himed-scheduling` toolboxes entries | remove (one `himed`) |
| backend `connectWithoutProbe` (entities + buildCredentialConfig) + **ADR 0065** | revert |
| backend vertical-scope split (himed/-directory/-scheduling) | collapse to `himed` |
| **Kept (not Option A):** fecha YYYY-MM-DD, cancel+idPaciente, idEspecialista, baseUrl env | keep |

---

## 7. Open questions

- **OQ-1:** Do the directory `idSede` and the scheduling `idSede` match (so directory `list_locations`
  can feed the booking flow and the scheduling `listarSedes` tool can be dropped)? Sandbox suggests yes
  (both `idSede: 1` "Poblado"); confirm before dropping.
- **OQ-2:** `ResolvedCredential.secrets` vs `secret` — confirm the back-compat shape keeps every
  existing provider's materialization byte-identical (regression-guard in the materializer tests).
- **OQ-3:** The scheduling host differs (`HIMED_SCHEDULING_BASE_URL`), so the unified provider's client
  routes per group to the right base URL. Confirm the client indirection is per-group, not per-tool.

---

## 8. ADR

A dedicated ADR records AD-1 (a provider declares credential groups; the materializer injects per the
called tool's group; the credential travels as a named-secret bundle), superseding/reverting ADR 0065
(probe-less connect). It belongs in `xcale-mcp-server/docs/adr/` (core auth), with a backend companion
note where `buildCredentialConfig` consumes it.
