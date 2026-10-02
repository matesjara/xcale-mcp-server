# Implementation Plan — HiMed unified multi-credential provider

> English prose (mcp-server docs convention). Companion to `feature-design.md` + `api-contract.md` in
> this folder. Honors the ADR `himed-multi-credential-provider` (core auth) and reverts the
> probe-less-connect approach. Spans two repos: `xcale-mcp-server` (`feat/himed-provider`) and
> `xcale-backend` (`feat/himed-connect`).

## Meta

Collapse the three HiMed providers into **one** `himed` provider with three **credential groups**
(`demograficos` / `directorio` / `autoagendamiento`). The core gains a group-aware materializer so each
tool injects its own secret; the consumer gains a multi-secret connect form that stores a credential
bundle and forwards it. One catalog card, one connection, one agent, one `list_locations` probe.
"Done" = sandbox booking flow works end-to-end through a single `himed` connection; `tsc`/lint/tests
green in both repos.

**Detail tapers by phase (rolling-wave):** F1–F4 touch code that exists today and are specified
per-file. F5 (Phase-3 ripple) touches existing `lifecycle-messages` code and is specified as a concrete
tool-name map; its per-file edits are mechanical renames anchored below.

---

## Target file trees

### `xcale-mcp-server`
```
src/core/
  provider-port.ts                         MODIFIED  (CredentialGroup; authDescriptor.groups; ToolDefinition.credentialGroup; remove connectWithoutProbe)
  tool.ts                                  MODIFIED  (credentialGroup on the tool factory type)
  catalog.ts                               MODIFIED  (CatalogEntry.groups; drop connectWithoutProbe; buildCatalog passthrough)
  credential/resolved-credential.ts        MODIFIED  (optional secrets bundle)
  credential/credential-resolver.ts        MODIFIED  (forwarded resolver parses the bundle when groups present)
  auth/authentication-materializer.ts      MODIFIED  (group param → inject that group's field)
  provider-factory.ts                      MODIFIED  (pass tool.credentialGroup to materialize)
src/protocol/mcp-server.ts                 MODIFIED  (thread provider groups into credential resolution)
src/providers/himed/
  manifest.ts                              MODIFIED  (displayName "HiMed"; groups; probe list_locations; drop connectWithoutProbe)
  auth.ts                                  MODIFIED  (groups descriptor)
  client.ts                                MODIFIED  (per-group baseUrl routing: demográficos/directorio on HIMED_BASE_URL, autoagendamiento on HIMED_SCHEDULING_BASE_URL)
  tools.ts                                 MODIFIED  (all tools: demográficos + directory + autoagendamiento, each tagged credentialGroup)
  provider.ts                              MODIFIED  (wire the two base URLs by env)
  errors.ts                                MODIFIED  (keep both unwrap variants)
  __tests__/himed.test.ts                  MODIFIED  (unified tool set + per-group injection)
src/providers/himed-directory/             REMOVED   (folds into himed)
src/providers/himed-scheduling/            REMOVED   (folds into himed)
src/providers/index.ts                     MODIFIED  (one himedProvider line)
docs/adr/himed-multi-credential-provider.md UNCHANGED (context)
```

### `xcale-backend`
```
src/modules/mcp/
  entities.ts                              MODIFIED  (McpAuthDescriptor.groups; remove connectWithoutProbe)
  mcp-bootstrap.ts                         MODIFIED  (buildCredentialConfig: multi-secret form + bundle; remove skipProbe)
  mcp-client.ts                            MODIFIED  (McpCallArgs.credentials bundle)
  mcp-tool-executor.ts                     MODIFIED  (forward the bundle)
  toolboxes.ts                             MODIFIED  (one himed entry; drop himed-directory/himed-scheduling)
  __tests__/mcp-bootstrap.credential.test.ts MODIFIED  (multi-secret; drop probe-less test)
src/modules/agent/usecases/
  register-vertical-scopes.ts              MODIFIED  (one himed on health)
  register-vertical-scopes.test.ts         MODIFIED  (health set = [himed, saludtools])
src/infrastructure/i18n/locales/{en,es}.json MODIFIED (one himed.connect.* block; drop -directory/-scheduling)
src/modules/lifecycle-messages/
  entities.ts                              MODIFIED  (LifecycleIntegration 'himed-scheduling' → 'himed')
  adapters/himed-appointment-facts.ts      MODIFIED  (HIMED_BOOKING_TOOL_NAME + matches → himed)
  verifiers/himed.ts                       MODIFIED  (connectionsOf('himed'); read tool → mcp_himed_list_patient_appointments)
  catalog/himed.ts                         MODIFIED  (integration 'himed')
  (+ the above files' *.test.ts)           MODIFIED
docs/adr/probe-less-credential-connect.md  REMOVED   (reverted)
```

---

## F1 — Revert Option A

| File:anchor | Symbol / change | Intent | Seam | Kind |
|:--|:--|:--|:--|:--|
| `src/providers/himed-directory/` | whole dir | remove the split-out provider | providers | REMOVED |
| `src/providers/index.ts:5,24` | `himedDirectoryProvider` import + list entry | un-register | provider list | REMOVED |
| `src/core/provider-port.ts` (`connectWithoutProbe`) | the field added in Option A | remove | manifest contract | REMOVED |
| `src/core/catalog.ts` (`connectWithoutProbe`) | CatalogEntry field + buildCatalog passthrough | remove | catalog | REMOVED |
| `src/providers/himed/manifest.ts:` `connectWithoutProbe: true` | manifest flag | remove (probe restored in F3) | manifest | REMOVED |
| backend `src/modules/mcp/entities.ts` `connectWithoutProbe` | McpCatalogEntry field | remove | consumer contract | REMOVED |
| backend `src/modules/mcp/mcp-bootstrap.ts:194` `skipProbe` path | the no-probe branch | remove (probe restored) | buildCredentialConfig | REMOVED |
| backend `docs/adr/probe-less-credential-connect.md` | the ADR | delete (reverted) | adr | REMOVED |
| backend `src/modules/mcp/__tests__/mcp-bootstrap.credential.test.ts` | the "connectWithoutProbe registers" test | remove; restore "no probe → null" as the only no-probe case | test | MODIFIED |

**Keep (NOT Option A):** `himed` `fecha_nacimiento` YYYY-MM-DD, `cancel_appointment` requires
`idPaciente`, `get_availability` uses `idEspecialista`, the `HIMED_*_BASE_URL` env overrides. These
move into the unified `himed` in F3.

**DoD:** both repos `tsc` clean after removal (the merge of tools happens in F3; F1 may leave himed
temporarily thin — sequence F1→F3 without an intermediate gate on himed tool completeness, or fold
F1 into F3's branch of work).

## F2 — Core multi-credential (mcp-server) — *foundation*

| File:anchor | Symbol (signature) | Intent | Seam | Kind |
|:--|:--|:--|:--|:--|
| `src/core/provider-port.ts:~9` | `interface AuthField { key; label; placement? }` | extract the field shape | auth | NEW/MOD |
| `src/core/provider-port.ts` | `interface CredentialGroup { key: string; label: string; field: AuthField }` | a named credential | auth | NEW |
| `src/core/provider-port.ts` (`ProviderAuthDescriptor`) | add `groups?: CredentialGroup[]` | multi-credential providers | auth | MODIFIED |
| `src/core/tool.ts` (`ToolDefinition`) | add `credentialGroup?: string` | a tool's group tag | tool | MODIFIED |
| `src/core/credential/resolved-credential.ts:16` | `interface ResolvedCredential { secret; secrets?: Record<string, SecretString> }` | named-secret bundle | credential | MODIFIED |
| `src/core/credential/credential-resolver.ts:19` | `forwardedCredentialResolver.resolve(inbound, groups?)` | when `groups`, parse `inbound` (JSON bundle) into `secrets`; else `{ secret }` | Hop-A resolution | MODIFIED |
| `src/core/credential/credential-resolver.ts:33` | `resolveCredential(delivery, inbound, deps, groups?)` | thread groups to the resolver | resolution | MODIFIED |
| `src/core/auth/authentication-materializer.ts:18` | `materialize(auth, resolved, reqSpec, group?)` | with `group`: use `auth.groups[group].field` + `resolved.secrets[group]`; else current `fields[0]`/`secret` | materialization | MODIFIED |
| `src/core/provider-factory.ts:114` | `materialize(spec.auth, ctx.credential, reqSpec, tool.credentialGroup)` | pass the executing tool's group | factory | MODIFIED |
| `src/protocol/mcp-server.ts` (tools/call handler) | pass `provider.auth.groups` into `resolveCredential` | wire groups at Hop-A | protocol | MODIFIED |
| `src/core/auth/__tests__/authentication-materializer.test.ts` | new cases: group injection; single-secret unchanged (byte-identical, OQ-2) | regression guard | test | MODIFIED |

## F3 — Unified `himed` provider (mcp-server)

| File:anchor | Symbol / change | Intent | Seam | Kind |
|:--|:--|:--|:--|:--|
| `src/providers/himed/auth.ts` | `himedAuth` → `type:'api_key'`, `groups: [demograficos, directorio, autoagendamiento]` | declare the three groups | auth | MODIFIED |
| `src/providers/himed/manifest.ts` | `displayName:'HiMed'`, `connectionProbe:{tool:'mcp_himed_list_locations'}`, bump version | one card, directory probe | manifest | MODIFIED |
| `src/providers/himed/client.ts` | `createHimedClient({ baseUrl, schedulingBaseUrl })` + a `callScheduling(...)` path | per-group base URL: demográficos/directorio POST `.php` on `baseUrl`; autoagendamiento RPC on `schedulingBaseUrl` | client | MODIFIED |
| `src/providers/himed/tools.ts` | 3 demográficos tools (`credentialGroup:'demograficos'`) + `list_locations`/`list_doctors` (`'directorio'`) + the autoagendamiento set (`'autoagendamiento'`), names `mcp_himed_*` | the unified tool set, each tagged | tools | MODIFIED |
| `src/providers/himed/tools.ts` | keep: fecha YYYY-MM-DD; `cancel_appointment` requires `idPaciente`; `get_availability` → `idEspecialista` | sandbox fixes carried over | tools | MODIFIED |
| `src/providers/himed/provider.ts` | wire `HIMED_BASE_URL` + `HIMED_SCHEDULING_BASE_URL` (drop `HIMED_DIRECTORY_BASE_URL`; directory shares `HIMED_BASE_URL`) | env routing | provider | MODIFIED |
| `src/providers/himed/errors.ts` | keep `unwrapHimed` (Demográficos 201/207) + directory/scheduling unwrap | error mapping | errors | MODIFIED |
| `src/providers/himed-scheduling/` | fold tools in; delete dir | merge | providers | REMOVED |
| `src/providers/index.ts` | one `himedProvider` | registration | list | MODIFIED |
| `src/providers/himed/__tests__/himed.test.ts` | unified tool set; per-group injection asserts (directory probe uses directorio secret; create_patient uses demograficos; create_appointment uses autoagendamiento) | coverage | test | MODIFIED |

**Name-collision resolution (OQ-1):** directory `mcp_himed_list_locations` is canonical + the probe;
the scheduling `listarSedes` tool is dropped (confirm directory `idSede` ≡ scheduling `idSede` against
the sandbox before dropping — both returned `idSede:1` "Poblado").

## F4 — Backend multi-secret consumer

| File:anchor | Symbol / change | Intent | Seam | Kind |
|:--|:--|:--|:--|:--|
| `src/modules/mcp/entities.ts` (`McpAuthDescriptor`) | add `groups?` mirroring the catalog | read published groups | contract | MODIFIED |
| `src/modules/mcp/mcp-bootstrap.ts:248` (`connectFields`) | build fields from `groups` (one secret per group) + required context | multi-secret form | buildCredentialConfig | MODIFIED |
| `src/modules/mcp/mcp-bootstrap.ts:261` (`validate`) | compose a **bundle** (JSON of named secrets), not one `accessToken`; probe via `connectionProbe` (directory) | bundle storage | validate | MODIFIED |
| `src/modules/mcp/mcp-bootstrap.ts:283-314` (single-secret throw) | allow N named secrets when `groups` present | lift the >1 throw | validate | MODIFIED |
| `src/modules/mcp/mcp-client.ts` (`McpCallArgs`) | add `credentials?: Record<string,string>` | forward the bundle | wire | MODIFIED |
| `src/modules/mcp/mcp-tool-executor.ts:126` (`callTool({... token ...})`) | forward `credentials` bundle for grouped providers; keep `token` for single-secret | egress | MODIFIED |
| `src/modules/mcp/toolboxes.ts:113-156` | one `himed` entry; remove `himed-directory` + `himed-scheduling` | catalog | MODIFIED |
| `src/modules/agent/usecases/register-vertical-scopes.ts:130-142` | one `himed` on `health` | vertical scope | MODIFIED |
| `register-vertical-scopes.test.ts:58,105` | health set `['himed','saludtools']` | guard | test | MODIFIED |
| `src/infrastructure/i18n/locales/{en,es}.json` | one `himed.connect.*` (codigo_servicio + 3 secret labels); drop `-directory`/`-scheduling` | i18n | MODIFIED |

**accountKey (OQ confirmed):** `accountContextKeys: ['codigo_servicio']` → the connection identity is
the clinic's `codigo_servicio`.

## F5 — Phase 3 ripple (backend lifecycle-messages)

Mechanical rename `himed-scheduling` → `himed`, no logic change (api-contract §5 map).

| File:anchor | Change | Kind |
|:--|:--|:--|
| `src/modules/lifecycle-messages/entities.ts` (`LifecycleIntegration`) | `'himed-scheduling'` → `'himed'` | MODIFIED |
| `adapters/himed-appointment-facts.ts` (`HIMED_BOOKING_TOOL_NAME`) | `'mcp_himed-scheduling_create_appointment'` → `'mcp_himed_create_appointment'` | MODIFIED |
| `adapters/himed-appointment-facts.ts` (`matches`) | providerSlug `'himed-scheduling'` → `'himed'` | MODIFIED |
| `verifiers/himed.ts` (`defaultDeps.connectionsOf`) | `findByUserAndProviderAll(userId, 'himed-scheduling')` → `'himed'` | MODIFIED |
| `verifiers/himed.ts` (`listPatientAppointments`) | tool `'mcp_himed-scheduling_list_patient_appointments'` → `'mcp_himed_list_patient_appointments'` | MODIFIED |
| `catalog/himed.ts` (`integration`) | `'himed-scheduling'` → `'himed'` | MODIFIED |
| the above `*.test.ts` | update fixtures/expected slugs | MODIFIED |

---

## Vertical slices (ordered)

| # | Slice | Phase | Band | Owned files |
|:--|:--|:--|:--|:--|
| S1 | Core types: CredentialGroup, authDescriptor.groups, ToolDefinition.credentialGroup, ResolvedCredential.secrets | F2 | foundation | provider-port.ts, tool.ts, resolved-credential.ts |
| S2 | Group-aware resolver + materializer + factory + protocol wiring (+ regression test) | F2 | foundation | credential-resolver.ts, authentication-materializer.ts, provider-factory.ts, protocol/mcp-server.ts |
| S3 | Revert Option A core/catalog + providers deletions | F1 | foundation | provider-port.ts, catalog.ts, providers/index.ts, himed-directory/ (del) |
| S4 | Unified himed provider (auth groups, client routing, merged tools, probe, manifest) + tests | F3 | integration | providers/himed/* |
| S5 | Backend contract: McpAuthDescriptor.groups; remove connectWithoutProbe; mcp-client bundle | F4 | foundation | mcp/entities.ts, mcp/mcp-client.ts |
| S6 | buildCredentialConfig multi-secret form + bundle + probe + executor forward (+ tests) | F4 | integration | mcp/mcp-bootstrap.ts, mcp/mcp-tool-executor.ts, mcp-bootstrap.credential.test.ts |
| S7 | Backend catalog + vertical scope + i18n (one himed) | F4 | integration | toolboxes.ts, register-vertical-scopes(.test).ts, i18n |
| S8 | Phase-3 ripple rename | F5 | integration | lifecycle-messages/* |
| S9 | Sandbox verification of the unified connection | F5 | verification | — |

**Fan-out:** 9 slices, ~24 files across two repos — **above threshold**, but the two repos' changes
are sequential (mcp-server S1–S4 must land/publish before backend S5–S8 consume the new catalog), and
within each repo the foundation slices are shared seams. Recommendation: **build solo, sequentially**
(S1→S2→S3→S4 in mcp-server; S5→S6→S7→S8 in backend; S9 verify), committing at each green slice. No
sub-issues (PD-1: one epic #1053, one lane per repo).

## Definition of Done

- Per slice: `npx tsc --noEmit` clean (mcp: `npm run typecheck`); the slice's tests green.
- mcp-server: `npm test` green; `scripts/contract-probe.mjs` if applicable.
- backend: `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit` clean; `npm test`
  for `src/modules/mcp` + `lifecycle-messages` + vertical-scopes green.
- S9: against the sandbox, one `himed` connection drives create patient → book → citasPaciente → cancel
  (the ship-log flow) through the unified provider.

## Open questions carried from the contract
- OQ-1 directory `idSede` ≡ scheduling `idSede` (confirm before dropping scheduling `listarSedes`).
- OQ-2 single-secret materialization byte-identical (regression test in S2).
- OQ-3 per-group baseUrl routing in the himed client (S4).
