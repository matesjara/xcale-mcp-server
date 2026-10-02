# ADR: A provider may declare credential groups; the materializer injects per the called tool's group

- **Status:** Accepted
- **Date:** 2026-10-02
- **Decision makers:** Sara (design), Mateo (release owner)
- **Tags:** core, auth, credentials, himed
- **Number:** _unassigned (assigned at merge)_

## Context

The core materializer (`src/core/auth/authentication-materializer.ts`) reveals **one** secret per call —
`materialize(auth, resolved)` uses `auth.fields[0]` and `resolved.secret` (the single `.reveal()` in the
runtime). Every provider to date authenticates every tool with the same single credential.

HiMed does not fit. It is **one clinical system exposed as three APIs, each with its own token**
(confirmed against the sandbox + the developer docs, 2026-10-01):

| Group | Tools | Secret (body) | Context |
|:--|:--|:--|:--|
| `demograficos` | patient create/update/change-document | `api_key` = Demográficos token | — |
| `directorio` | list_locations, list_doctors | `api_key` = Service token | — |
| `autoagendamiento` | availability, book, cancel, patient_exists, citasPaciente, list_* | `token` = Autoagendamiento token | `codigo_servicio` |

The Demográficos token 401s on the directory and vice versa — they are genuinely separate credentials.

We first modeled this as **three providers** (himed / himed-directory / himed-scheduling). Reviewing the
UI that is poor: the clinic sees three cards and connects three times, "one provider per turn"
(ADR-0046 on the consumer) forces multiple agents, and Demográficos (no read) needed a probe-less-connect
hack (the consumer's ADR 0065). The product wants **one HiMed app, one connection, one agent**.

## Decision

A provider may declare **credential groups**, and each tool selects its group:

- `ProviderAuthDescriptor` gains `groups?: CredentialGroup[]`, where
  `CredentialGroup = { key, label, field: AuthField }`. `fields` stays for single-secret providers
  (unchanged, back-compat).
- `ToolDefinition` gains `credentialGroup?: string` — the group whose secret this tool uses. Tools of a
  single-secret provider omit it (one implicit group).
- `ResolvedCredential` gains `secrets?: Record<string, SecretString>` — a named bundle keyed by group.
  `secret` stays for single-secret providers.
- `materialize(auth, resolved, group?)` becomes **group-aware**: with a `group`, it injects
  `auth.groups[group].field` with `resolved.secrets[group]`; without, it behaves exactly as today. The
  dispatcher passes the called tool's `credentialGroup`. The handler still never sees the secret — the
  single `.reveal()` stays in the materializer (Credential-in-Transit-Only preserved). This is the
  decided variant (a); variant (b), revealing in the handler, was declined.
- Non-secret context (`codigo_servicio`) stays handler-placed from `ctx.metadata`, as the scheduling
  handlers already do.

HiMed is published as **one** `himed` provider carrying all three groups, with
`connectionProbe: mcp_himed_list_locations` (the `directorio` group — a cheap read). The probe validates
the connection via the directory token; Demográficos and Autoagendamiento validate on first real use
(`PROVIDER_AUTH_EXPIRED` → reconnect). This **supersedes/reverts** the probe-less-connect approach (the
consumer's ADR 0065): with a real probe, no provider needs to connect unvalidated.

## Consequences

- **Additive.** Single-secret providers are byte-identical: no `groups`, no `credentialGroup`, `materialize`
  called without a group. Guarded by the materializer tests.
- **One HiMed app end-to-end.** One catalog card, one connect form (the three tokens + `codigo_servicio`),
  one Rail A connection (a credential bundle), one agent (all tools in one turn).
- **Core change.** This touches `src/core/auth` and the credential types — a human-reviewed merge
  (the pipeline escalates core changes), not an auto-merge.
- **Wire.** The consumer forwards the bundle; the gateway builds `ResolvedCredential.secrets` and
  materializes per the tool's group. Single-secret providers keep forwarding one token.

## Alternatives considered

- **Three providers (Option A)** — rejected on UX (three cards), the multi-agent consequence of
  one-provider-per-turn, and the probe-less hack it forced for Demográficos.
- **Reveal in the handler (variant b)** — rejected: moves `.reveal()` out of the materializer, breaking
  the single-reveal invariant and the pattern where HiMed handlers never touch the secret.
- **One provider, one shared token** — impossible: the three HiMed APIs reject each other's tokens.
