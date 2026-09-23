# Onboarding — xcale-mcp-server

Welcome to **xcale-mcp-server**, xcale's own integration platform (a "Composio LATAM"). This page
gets a contributor productive fast and points at the durable sources of truth.

## What this project is (in one minute)

A **stateless MCP gateway** that fronts thin per-provider adapters and publishes a capability
catalog. It owns **provider knowledge** (auth, tools, error mapping, how to call each API);
xcale-backend stays a **generic consumer** of capabilities and the **custodian of credentials**.

Read in this order:

1. **`docs/foundation.md`** — vision & principles (the founding pillar).
2. **`docs/architecture-review.md`** — the target architecture, the alternatives weighed, the
   responsibility split, and **principle #1: Provider Self-Containment** (§0).
3. **`docs/adr/`** — the durable decisions (contract pillars, knowledge/custody split, stateless
   gateway, error contract, versioning, credential model).
4. **`docs/security/credential-boundary-review.md`** — the credential threat model & control
   checklist (binding on implementation).
5. **`CONTEXT.md`** — the glossary. Use its canonical terms in code, docs, and commits.

## The two principles that govern everything

> **#1 Provider Self-Containment.** Adding a provider means working almost exclusively in
> `src/providers/{slug}/`. The only permitted touch on a consumer is _generic config_ (secrets
> / env vars) or _business policy_ — never provider-specific code. If you need a `switch`, an
> `if`, or per-provider logic in a consumer to support a standard provider, the architecture is
> incomplete (justify any exception with an ADR).

> **#2 Consumer-Agnostic Reusability.** xcale-backend is the **first** consumer, not the reason
> this server exists. Public contracts carry no consumer-specific concepts (no tenant/plan/xcale
> entities) — only _which token_ and _which tool_. Any MCP-compatible client could consume it.

## Adding a provider (the mechanical recipe)

A new provider is a **self-contained module** in `src/providers/{slug}/` plus one line in
`src/providers/index.ts`, built on the core's canonical helpers (ADR 0009): `createProvider`,
`defineTool`/`toolFactory`/`definePaginatedList`, and handlers that run every call through `ctx.request`, so
the adapter never touches a credential. The recipe — file layout, helpers, error normalization, tests and
the Definition of done — is the xcale layer's **`add-provider`** skill
([xcale-harness](https://github.com/matesjara/xcale-harness/blob/main/.claude/skills/add-provider/SKILL.md));
it is not restated here. Start from the closest real provider: `echo` (minimal), `siigo` (credential
exchange), `toteat` (call context), `cloudbeds` (OAuth with scopes derived from the tools),
`saludtools` (a provider that answers inside an envelope, curates what each tool returns, and hides
the operations an agent must never choose). Backend side: generic config only (the provider's secrets
in Doppler). **No backend code.**

**One habit worth copying from `saludtools`, whatever you are integrating:** its
`docs/design/saludtools-provider/production-evidence.md` records what the provider actually answered,
next to what its documentation claimed. The two disagreed in ten places and five of those would have
shipped as defects — a documented enum the live catalog contradicts, a page-size ceiling nobody
mentions that broke every paginated call, a "not found" that arrives as a success with an empty body,
and a create that returns its new id in the envelope rather than the body. **Make one real call per
shape before you believe it**, and write down where the vendor was wrong: the next person integrating
the same vendor, or one built on the same stack, is going to need that list more than they need your
code.

## Dev workflow

> The runtime stack is locked but not yet implemented: **TypeScript + Node ≥20 · Fastify 4 ·
> official MCP TypeScript SDK · zod · pino · Vitest**, deployed on **DO App Platform + Doppler**.
> This section gets filled in (scripts, ports, `doppler run` wrappers) when the protocol skeleton
> lands (roadmap Phase 2). Conventions match xcale-backend: kebab-case files, `IPascalCase`
> interfaces, Clean Architecture seams.

## The agent toolset

AI-assisted work on this repo runs from the xcale layer ([xcale-harness](https://github.com/matesjara/xcale-harness)),
the folder that holds this repo: its skills (grill, feature-design, api-contract-authoring, implementation-plan, adr,
tdd, add-provider, …), agents and pipeline serve this repo, with a reference for it where it differs.
