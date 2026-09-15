# xcale-mcp-server — Project facts

> **Open xcale sessions in the xcale layer**, `~/Documents/Projects/xcale` — the folder that holds this
> repo ([xcale-harness](https://github.com/matesjara/xcale-harness)). The team's harness lives there: the
> working policy, `/handoff`, how to report to Mateo, this repo's identity rule, the design flow (`/grill`, `/feature-design`,
> `/api-contract-authoring`, `/implementation-plan`, `/adr`, and the `architect` agent), the engineering discipline
> (`/git-workflow`, `/tdd`, `/diagnose`, `/improve-architecture`, `/creating-skills`, and the `debugger` and `prod-debugger`
> agents), review (`/pr-review`, and the `code-reviewer`, `pr-reviewer` and `mcp-contract-qa` agents) and, step by step, what this repo's
> `.claude/` still carries. A session opened inside this repo reads the layer's `CLAUDE.md` and working policy, but none of
> its skills or hooks.

xcale's own MCP integration platform (a "Composio LATAM"). Provider knowledge lives here;
consumers (xcale-backend first) consume capabilities over stable, consumer-agnostic MCP contracts.

- **Identity & philosophy** — the xcale layer's [`.claude/rules/xcale-mcp-server-soul.md`](https://github.com/matesjara/xcale-harness/blob/main/.claude/rules/xcale-mcp-server-soul.md) (loaded, from the layer, whenever a session works with a file in this repo).
- **Glossary** — `CONTEXT.md` (use its canonical terms in code, docs, commits).
- **Vision** — `docs/foundation.md`. **Target architecture & rationale** — `docs/architecture-review.md`.
- **Decisions** — `docs/adr/` (index + policy: `docs/adr/README.md`).
- **Onboarding / add a provider** — `docs/onboarding.md` + the `add-provider` skill.

## Language

Everything that lands in the repo or on GitHub is in English — code, comments, docs, ADRs, commit
messages, PR titles and bodies, branch names (the xcale layer's [working policy](https://github.com/matesjara/xcale-harness/blob/main/.claude/rules/working-policy.md) › Language).
**One sanctioned exception** (decided 2026-08-20): *internal working journals* — dated
investigation/certification diaries under `docs/design/` (e.g. the Cloudbeds certification
notes) — may be written in Spanish. Anything external-facing, contract-adjacent, or durable
(code, ADRs, design docs, READMEs) stays English.

## Stack

- TypeScript (strict; `exactOptionalPropertyTypes` off — see `docs/adr/0008-typescript-strictness-config.md`),
  Node ≥20 (CI and the production image run 22), ESM.
- Fastify 5 · `@modelcontextprotocol/sdk` (MCP, confined to `src/protocol/`) · zod · pino · Vitest.
- Run via **tsx** (no build step — *complexity on demand*). In production too, so `tsx` is a
  **runtime** dependency (`dependencies`), not a dev tool — see `docs/adr/0012-deployment-runtime-and-hosting.md`.
- Quality gates: Prettier (format), `tsc --noEmit`, Vitest, `npm audit` — all enforced in CI
  (`.github/workflows/ci.yml`) on every PR to `dev`/`main`.

## Scripts

- `npm run dev` — `doppler run -- tsx watch src/server.ts` (local; pulls secrets from Doppler).
- `npm start` — `node --import tsx src/server.ts` (env provided by the platform; same command the
  container runs).
- `npm run typecheck` — `tsc --noEmit`. `npm test` / `npm run test:watch` — Vitest.

## Secrets & config (Doppler)

- **Doppler project:** `xcale-mcp-server` · configs `dev` / `stg` / `prd` (pointer: `doppler.yaml`).
- `MCP_SERVER_SECRET` — Hop-B shared secret (backend → server auth). Never commit secrets.
- `PORT`, `NODE_ENV`, `LOG_LEVEL` — runtime config. Shape documented in `.env.example`.

## Architecture invariants (enforced by review + PR template)

- **Provider Self-Containment** — adding a provider touches only `src/providers/{slug}/` (+ one
  line in `src/providers/index.ts`) and generic config; never `src/core|protocol|auth` or a consumer.
- **Consumer-Agnostic** — no consumer concepts (tenant/plan/xcale entities) on the wire.
- **Credential-in-Transit-Only** — tokens via `SecretString`; `.reveal()` only at provider egress;
  never persisted/logged.

## Git workflow

- **How code moves** — the xcale layer's [`/git-workflow`](https://github.com/matesjara/xcale-harness/blob/main/.claude/skills/git-workflow/SKILL.md),
  with this repo's checks, deploy, gates and scopes in its
  [`references/xcale-mcp-server.md`](https://github.com/matesjara/xcale-harness/blob/main/.claude/skills/git-workflow/references/xcale-mcp-server.md).
- `main` (default, protected: PR + CI `verify` green, no direct or force pushes) · `dev`
  (protected: same). Implementation: feature branch → PR → `dev`; release: `dev` → `main` PR.
  Repo: https://github.com/matesjara/xcale-mcp-server
- **Working policy** — [`.claude/rules/working-policy.md` in xcale-harness](https://github.com/matesjara/xcale-harness/blob/main/.claude/rules/working-policy.md) (always loaded, from
  the xcale layer): done means merged into `dev`, merges into `dev` by Mateo or by
  `/agentic-ship` after its gates, nobody merges their own work, merge commits, the state labels,
  handoffs.
- **Release owner** — Mateo (`matesjara`, CEO). He merges into `dev` and `main`; a release to
  `main` needs his explicit authorization for *that* release. Juan José opens PRs to `dev` and
  merges none (2026-09-13 — the self-merge into `dev` allowed on 2026-08-20 is retired).
- **No required approvals on `dev` or `main`** (set 2026-08-20). On a personal-account repo a
  required approval is only met with `--admin` — an author cannot approve their own PR, and
  `/agentic-ship` merges under Mateo's identity — so the enforced gate is PR + green CI, and **the
  independent review is a team rule, not a machine rule**.
- **Do not use `gh pr merge --admin`.** `enforce_admins` is still `false`, so with approvals at 0
  the only thing that flag still bypasses is a red build. Merge with `gh pr merge <n> --merge`
  once CI is green.
- **Autonomous path** — `/agentic-ship` builds a scoped change in an isolated worktree and merges
  it to `dev` on its own when three independent gate agents (`code-reviewer`, `pr-reviewer`,
  `mcp-contract-qa`, all in the xcale layer) pass and CI `verify` is green. It never merges to `main`, never uses
  `--admin`, and escalates instead of merging anything that reaches `src/core|protocol|auth`.
  ADR: `docs/adr/0017-agentic-auto-merge-to-dev.md`.

## Deploy

- **DigitalOcean App Platform** (project XCALE, `nyc`), one Docker service tracking **`main`** with
  `deploy_on_push` — merging the release PR *is* the deploy. Health: `GET /health`.
- Spec is versioned in `.do/app.yaml`; `MCP_SERVER_SECRET` is a placeholder rendered from Doppler
  (`prd`) at apply time. Runbook: `docs/deploy.md`. Rationale: `docs/adr/0012-deployment-runtime-and-hosting.md`.
