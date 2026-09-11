# xcale-mcp-server — "Composio LATAM"

> **Status:** in production. Deployed on DigitalOcean App Platform from `main`
> (`deploy_on_push`), consumed by `xcale-backend` as an MCP client. Four providers are
> registered — `cloudbeds`, `toteat`, `siigo`, and the `echo` stub — publishing 74 tools.
> Decisions live in [`docs/adr/`](docs/adr/README.md); what runs where in
> [`docs/deploy.md`](docs/deploy.md).

xcale's own **MCP server** (a "Composio LATAM"): a separate service that centralizes
integrations with the platforms LATAM businesses actually use — and any provider Composio
will never cover — and exposes their capabilities as **tools over the MCP protocol
(JSON-RPC 2.0)**. xcale-backend consumes it as an MCP client, the same way it consumes
Composio, but over a protocol and a server xcale fully owns.

```
xcale-backend (MCP client)  ──/discover · tools/list · tools/call──▶  xcale-mcp-server (this repo)
  · owns business logic                                                · owns provider plumbing
  · Rail A owns credentials, forwards them per call                    · STATELESS w.r.t. auth
```

## Start here

- [`docs/deploy.md`](docs/deploy.md) — what runs where, how a change reaches production.
- [`docs/adr/README.md`](docs/adr/README.md) — the 16 decisions behind the shape (credential
  delivery, statelessness, tool-derived scopes, control-plane tools, the audit gate…).
- [`docs/design/`](docs/design/) — one folder per provider or protocol slice
  (`cloudbeds-*`, `toteat-provider`, `siigo-read-only-provider`, `protocol-skeleton`,
  `canonical-provider-pattern`) plus the roadmap.
- [`docs/foundation.md`](docs/foundation.md) — the founding pillar: vision, token model, the
  mechanical provider-onboarding recipe. Historical framing; where it and the code differ, the
  code is the truth.
- [`CONTEXT.md`](CONTEXT.md) — the glossary.

## Why

- Composio's catalog is global-SaaS-centric and won't cover LATAM apps (regional CRMs,
  payment gateways, appointment systems, accounting platforms).
- xcale needs full control of provider auth, data, cost, and roadmap.
- Long-term: migrate native provider plumbing out of xcale-backend so the backend becomes a
  pure consumer that only owns business rules.

## How it works

- **Transport.** Fastify 5 in front of the MCP **Streamable HTTP** transport in stateless mode:
  a fresh server + transport per request, no sessions (`src/protocol/`). Routes: `GET /health`,
  `GET /assets/:filename` (provider logos), `GET /discover`, `POST /mcp`.
- **Caller auth (Hop B).** One shared-secret bearer token guards `/discover` and `/mcp`; the
  process refuses to boot without `MCP_SERVER_SECRET`. Per-tenant identity is **not** carried by
  Hop B — it arrives per call.
- **Credentials never live here.** Two delivery strategies (ADR 0010): `forwarded` — the
  backend sends the usable credential in `X-Provider-Token` on every call (`echo`, `cloudbeds`,
  `toteat`); `reference` — the backend sends a single-use nonce and this server resolves it
  back at the backend's Credential Authority (`siigo`; needs `CREDENTIAL_RESOLVE_URL` and
  `CREDENTIAL_RESOLVE_SECRET`, plus `SIIGO_PARTNER_ID`). Routing context (`propertyID`,
  Toteat's `xir/xil/xiu`) travels in `X-Provider-Metadata`.
- **Discovery.** `/discover` publishes the capability catalog derived from the registry —
  auth *blueprints*, connection probes, context discovery — never secrets. `tools/list` is a flat
  namespaced list (`mcp_{slug}_{verb}`); `tools/call` routes by name.
- **Control-plane tools** (webhook subscriptions, app state, email templates…) are routable but
  withdrawn from `tools/list`, so an agent can never choose them (ADR 0013).
- **Stateless by decision** (ADR 0005): no database, no cache, no writes to its own filesystem.

## Repo layout (current)

```
xcale-mcp-server/
├── src/
│   ├── server.ts               ← Fastify app and routes
│   ├── config.ts · logger.ts
│   ├── auth/                   ← Hop B bearer, token / metadata header parsing
│   ├── protocol/               ← MCP JSON-RPC over stateless Streamable HTTP
│   ├── core/                   ← registry, catalog, provider port, credential resolvers,
│   │                              closed error codes, scopes, secret handling
│   └── providers/              ← cloudbeds · toteat · siigo · echo (explicit list in index.ts)
├── docs/                       ← deploy.md, adr/, design/<slug>/, foundation.md, security/
├── scripts/ · assets/          ← tooling; logos served at /assets
├── Dockerfile · doppler.yaml   ← runs `src/server.ts` under tsx, no build step
└── .claude/                    ← agent rules, skills (add-provider), agents, commands
```

## Conventions

- TypeScript, ES modules, `kebab-case.ts` files, `IPascalCase` interfaces, `camelCase`
  methods — same as xcale-backend, so contributors move between repos without friction.
- Artifacts (code, docs, ADRs, commits) stay in English. Conversation can be in any language.
- No xcale business logic lives here. This server only adapts providers to MCP.
- A provider is a manifest + tools + auth blueprint following the canonical pattern
  (ADR 0009); CI rejects hand-written `inputSchema` in providers and blocks on `npm audit`
  (ADR 0014).

## Relationship to xcale-backend

xcale-backend reaches this server through its `src/modules/mcp/` module: it discovers the
catalog at boot and re-discovers it every 30 minutes (backend ADR-0053), materializes one
toolbox per provider, and forwards the tenant's credential on each `tools/call`. Configuration on
the backend side is `MCP_SERVER_URL` + `MCP_SERVER_SECRET`; the Siigo credential-exchange
callback is served by the backend's `/internal` routes.
