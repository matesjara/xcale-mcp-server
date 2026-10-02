# Feature Design — HiMed as a single multi-credential catalog app

> Language note: this repo keeps design docs in English (CLAUDE.md › Language). Code identifiers,
> paths and tool names are verbatim.

## 0. Metadata

| Field | Value |
|:--|:--|
| **Slug** | `himed-unified-provider` |
| **Status** | Draft (for review) |
| **Author** | Sara |
| **Date** | 2026-10-02 |
| **Repos** | `xcale-mcp-server` (core auth change) · `xcale-backend` (connect form + multi-secret connection + vertical scope) |
| **Replaces** | "Option A" (the `himed` / `himed-directory` / `himed-scheduling` split + `connectWithoutProbe` / ADR 0065) |
| **Epic** | #1053 (HiMed) |
| **ADR planned** | Yes — a multi-credential provider is a change to the core auth model |

## 1. Problem

HiMed exposes **three APIs with three distinct tokens** (Demográficos, Directory = Doctors+Sedes,
Autoagendamiento). Option A modeled them as **three providers = three catalog cards**. Reviewing the
UI, that is wrong:

- **Confusing UX:** the clinic sees three "HiMed" cards and must connect three times. It cannot tell
  why its clinic shows up fragmented.
- **Forces multiple agents:** under "one provider per turn" (ADR-0046), a single HiMed agent cannot use
  patients + directory + scheduling in the same turn. The clinic wants **one assistant** that registers
  patients, looks up doctors/sedes and books — not three.
- **Probe hack:** Demográficos has no read, so Option A invented `connectWithoutProbe` (ADR 0065) to
  connect it unvalidated. Debt we would rather not carry.

## 2. Goal & metrics

A clinic connects **HiMed once**, in **one card and one form**, and **one agent** operates every
surface.

| Metric | Today (Option A) | Target |
|:--|:--|:--|
| "HiMed" cards in the catalog | 3 | **1** |
| Connect forms for HiMed | 3 | **1** |
| Rail A connections per clinic | 3 | **1** |
| Agents needed to cover HiMed | 2–3 | **1** |
| Providers that connect without a probe (hack) | 1 (`himed`) | **0** |

## 3. Users

- **The clinic** that connects HiMed from xcale's integrations UI (pastes its tokens).
- **The clinic's agent** (vertical `health`) that uses HiMed tools in a conversation.
- **The xcale team** that maintains the provider and its credentials.

## 4. User stories

1. *As a clinic*, I open the **HiMed** card, see **one** form asking for my tokens (Demográficos,
   Servicio, Autoagendamiento) and the service code, paste them and connect **once**.
2. *As a clinic*, on connect the system **validates** my connection with a real read (`list_locations`)
   before storing it — a wrong token surfaces at connect, not later.
3. *As a health agent*, in one turn I can **register a patient**, **look up doctors/sedes** and
   **book/list/cancel appointments** without switching agent or connection.
4. *As xcale*, I add HiMed to the catalog as **one** self-contained provider.

## 5. Scope (MoSCoW)

**Must**
- A single `himed` provider in the catalog (mcp-server) with **all** tools (Demográficos + Directory +
  Autoagendamiento).
- A **multi-credential-per-provider** mechanism (mcp-server core): each tool uses its own
  credential/context (AD-1).
- `connectionProbe: mcp_himed_list_locations` (unified).
- Backend: one multi-secret form; one Rail A connection storing the credential **bundle**; forward the
  bundle to the gateway.
- One `himed` in the `health` vertical scope (one agent, one turn, all tools).
- Keep the sandbox-validated fixes: `fecha_nacimiento` YYYY-MM-DD, `cancelarCita` requires `idPaciente`,
  availability uses `idEspecialista`, `baseUrl` via env.

**Should**
- Map the **Phase 3** ripple (observer/verifier/tool-names stop using the `himed-scheduling` slug →
  `himed`).

**Could**
- Rotate one token without re-pasting the others (edit a single bundle field).

**Won't (now)**
- Multi-credential for other providers (the mechanism is generic, but only HiMed uses it here).
- Change the proactive reminder send flow (still gated on #1055).

## 6. UX & interaction (connect flow)

- The clinic sees **one** "HiMed" card in the catalog (icon 🩺, category healthcare).
- Clicking **Connect** opens **one** form (order: context → secrets):
  - `codigo_servicio` (text, required) — the Autoagendamiento service code.
  - `demograficos_api_key` (secret, required) — Demográficos token.
  - `directorio_api_key` (secret, required) — the "Token de Servicio" (Doctors + Sedes).
  - `autoagendamiento_token` (secret, required) — Autoagendamiento token.
  - Each field with its i18n label + instruction (ES/EN), noting HiMed issues **a distinct token per
    API**.
- On submit: the backend **validates** by calling `list_locations` (directory) with
  `directorio_api_key`.
  - **Success** → one connection is persisted with the encrypted bundle; the card shows "Connected".
  - **Failure** (401 / no response) → a localized "check the tokens HiMed issued" message; nothing is
    stored.
- **Connected state:** a single "HiMed" entry in the tenant's integrations; reconnect reopens the same
  form with empty fields (re-pasted).

## 7. Data model sketch

- **Catalog (mcp-server):** one `CatalogEntry` `himed` whose `authDescriptor` declares **credential
  groups** (see AD-1) and `connectionProbe: { tool: 'mcp_himed_list_locations' }`.
- **Connection (backend, Rail A):** one `Connection` `provider: 'himed'` whose credential is a
  **bundle** of named secrets (as `credential_exchange` stores JSON), plus `codigo_servicio` in
  `metadata`/accountKey. The `accountKey` identifies the clinic (e.g. `codigo_servicio`).
- **In transit:** the backend forwards the bundle; the provider, per tool, uses the right secret.

## 8. Architectural decisions

### AD-1 — One provider declares **credential groups**; each tool uses its own *(the heart → ADR)*

The mcp-server materializer today reveals **one** secret (`resolved.secret`, `auth.fields[0]`) and
injects it into every call. HiMed needs **each tool** to use a different credential:

| Group | Tools | Secret (body) | Context |
|:--|:--|:--|:--|
| `demograficos` | create/update/change patient | `api_key` = demograficos token | — |
| `directorio` | list_locations, list_doctors | `api_key` = servicio token | — |
| `autoagendamiento` | patient_exists, availability, create/cancel appointment, list_patient_appointments, list_* | `token` = autoagendamiento token | `codigo_servicio` |

**Decision:** the `authDescriptor` declares **several named secret fields** (each with its placement),
the `ResolvedCredential` carries a **map of named secrets** (bundle), and each `ToolDefinition` declares
which **group** it belongs to. At egress, the secret (and context) of the tool's group is injected.
Single-secret providers keep working (one implicit group) — an additive change.

**Sub-variant — DECIDED (2026-10-02): (a) group-aware materializer.** The gateway passes the tool's
group to `materialize`, which injects that group's field; the handler never sees the secret
(Credential-in-Transit-Only preserved, repo standard kept). Option (b) (egress in the handler) was
declined.

### AD-2 — One provider = one HiMed agent
Collapsing to one `himed` means "one provider per turn" (ADR-0046) no longer forces multiple agents: a
`health` agent bound to `himed` gets **all** tools. The QB1 agent split is no longer needed.

### AD-3 — Unified probe, no `connectWithoutProbe`
`list_locations` (directory) is a cheap read → it serves as the `connectionProbe` for the whole
connection. `connectWithoutProbe` and **ADR 0065** are **reverted** (no probe-less provider needed).

### AD-4 — Keep the sandbox fixes
Untouched: `fecha_nacimiento` YYYY-MM-DD, `cancelarCita` requires `idPaciente`, availability uses
`idEspecialista`, `baseUrl` via env (`HIMED_BASE_URL` for Demográficos+Directory on `m.medsas.co`,
`HIMED_SCHEDULING_BASE_URL` for Autoagendamiento). Note: Demográficos+Directory share the host
(`m.medsas.co`), so one `HIMED_BASE_URL` covers both groups.

### AD-5 — Phase 3 ripple
The publication observer, the verifier and the P3 tool names reference the `himed-scheduling` slug
(`mcp_himed-scheduling_create_appointment`, `citasPaciente`, `connectionsOf('himed-scheduling')`). On
unification they become `himed` (`mcp_himed_create_appointment`, etc.). Rename + repoint, no logic
change.

## 9. Risks & open questions

| Risk / Question | Mitigation |
|:--|:--|
| **Change in `src/core/auth`** (touches the credential contract) | ADR + human merge (the pipeline escalates core changes). Additive: single-secret stays as-is. |
| Backend `buildCredentialConfig` today **throws with >1 secret** (except `basic`) | Extend it to a bundle of N named secrets (see api-contract). |
| Storing multiple secrets in one `Connection` | Reuse the `credential_exchange` pattern (credential as encrypted JSON). |
| One wrong token among the three? The probe only validates `directorio` | **DECIDED (2026-10-02): directory-only probe (`list_locations`).** Demográficos (no read) and Autoagendamiento validate on first real use (AUTH_EXPIRED→reconnect) — strictly better than today, and lighter than multi-probe. |
| Is `codigo_servicio` part of the accountKey (clinic identity)? | Likely yes (one clinic = one codigo_servicio). Confirm in api-contract. |

## 10. Phasing

- **F0 — Design:** this feature-design + api-contract (the AD-1 mechanism) + ADR.
- **F1 — Revert Option A:** delete `himed-directory`, `connectWithoutProbe`/ADR 0065, the catalog /
  vertical-scope split; merge tools back into `himed` (keeping AD-4).
- **F2 — Core multi-credential (mcp-server):** AD-1 with `/tdd`.
- **F3 — Backend multi-secret:** connect form + bundle connection + forward + unified probe + single
  vertical scope + i18n.
- **F4 — Phase 3 ripple:** repoint observer/verifier/tool-names to `himed`.
- **F5 — Sandbox verification:** re-confirm the full flow against the sandbox with the unified
  connection.

## 11. Agentic context

- The core change (AD-1) lives in `xcale-mcp-server/src/core/auth/` + `src/providers/himed/`.
- The consumer lives in `xcale-backend/src/modules/mcp/` (toolboxes, mcp-bootstrap
  `buildCredentialConfig`, entities) + `src/modules/agent/usecases/register-vertical-scopes.ts` + i18n +
  `src/modules/lifecycle-messages/` (P3 ripple).
- Related docs: `xcale-backend/docs/design/himed-connect/` (Phases 1–3), ADR 0065 (to revert), ADR-0046
  (one provider per turn), the api_key body-placement ADR.
