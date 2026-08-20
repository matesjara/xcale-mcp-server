# xcale-mcp-server — Project facts

xcale's own MCP integration platform (a "Composio LATAM"). Provider knowledge lives here;
consumers (xcale-backend first) consume capabilities over stable, consumer-agnostic MCP contracts.

- **Identity & philosophy** — `.claude/rules/soul.md` (always loaded).
- **Working with Mateo** — `.claude/skills/working-with-mateo` (always loaded via the import
  in § Communication): report structure, altitude rules, decision surfacing.
- **Glossary** — `CONTEXT.md` (use its canonical terms in code, docs, commits).
- **Vision** — `docs/foundation.md`. **Target architecture & rationale** — `docs/architecture-review.md`.
- **Decisions** — `docs/adr/` (index + policy: `docs/adr/README.md`).
- **Onboarding / add a provider** — `docs/onboarding.md` + the `add-provider` skill.

## Communication — how to answer in chat

**Language: chat in Spanish, artifacts in English.** Every response you write to me is in Spanish.
Everything that lands in the repo or on GitHub stays in English — code, comments, docs, ADRs,
commit messages, PR titles and bodies, branch names. Quoting an artifact inside a Spanish answer
keeps its English wording; don't translate identifiers, paths, commands, or error strings.
**One sanctioned exception** (decided 2026-08-20): *internal working journals* — dated
investigation/certification diaries under `docs/design/` (e.g. the Cloudbeds certification
notes) — may be written in Spanish. Anything external-facing, contract-adjacent, or durable
(code, ADRs, design docs, READMEs) stays English.

Top-down. **Ceiling: ~12 lines; a release or PR briefing ~18.** Past that you are explaining, not
reporting — move the detail into the PR body, an ADR, or a doc and link it.

Order, always:

1. **Verdict first.** Line one is the outcome or what I have to do — never the setup.
2. **⚠️ Then what I must decide or watch.** Decisions, risks, blockers, things that break. Marked.
3. **Then facts, only if they'd change my decision.** Consolidated into one or two lines.

**Decisions close every work turn as their own numbered block.** After any turn that does work
(PR review, implementation, release…), if something needs my call, end the reply with:

> **Decisiones:**
> 1. <the decision, one line> — **Rec:** <your recommendation, a few words>

One line per decision, recommendation always included, nothing else in the block. No pending
decisions → no block (never an empty section). Items already parked in the roadmap only appear
here when they block or newly need my call.

Rules:

- **No walkthroughs.** Never one section per PR / file / commit / step — group them into a claim.
- **Numbers, not adjectives.** "227 tests green, 0 vulns" beats "everything passes cleanly".
- **Say it once.** No restating my request, no narrating what you just did, no closing recap.
- **Cut what I can infer.** "Gates green" — not a list of every gate that was green.
- **Rationale lives in artifacts** (ADR, PR body, docs), not in chat. Link, don't paste.
- If the honest answer is one line, it's one line. Length is never a proxy for rigor.

The full working agreement (report structure, altitude rules, decision surfacing) is the
`working-with-mateo` skill, auto-loaded here so every session starts with it:

@.claude/skills/working-with-mateo/SKILL.md

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

- `main` (default, protected: PR + CI `verify` green, no direct or force pushes) · `dev`
  (protected: same). Implementation: feature branch → PR → `dev`; release: `dev` → `main` PR.
  Repo: https://github.com/matesjara/xcale-mcp-server
- **Release owner** — Mateo (`matesjara`, CEO). A release to `main` needs his explicit
  authorization for *that* release, whoever opens or merges the PR.
- **No required approvals on `main`** (set 2026-08-20). GitHub personal-account repos have no
  admin role for collaborators — everyone but the owner is capped at `write` — so a mandatory
  approval permanently blocked Juan José from merging to `main`, and forced Mateo to `--admin`
  past it on every release. The enforced gate is now PR + green CI; **review stays a team
  convention, not a machine rule**. Giving Juan José real admin rights would require moving the
  repo to a GitHub organization.
- **Do not use `gh pr merge --admin`.** `enforce_admins` is still `false`, so with approvals at 0
  the only thing that flag still bypasses is a red build. Merge with `gh pr merge <n> --merge`
  once CI is green.

## Deploy

- **DigitalOcean App Platform** (project XCALE, `nyc`), one Docker service tracking **`main`** with
  `deploy_on_push` — merging the release PR *is* the deploy. Health: `GET /health`.
- Spec is versioned in `.do/app.yaml`; `MCP_SERVER_SECRET` is a placeholder rendered from Doppler
  (`prd`) at apply time. Runbook: `docs/deploy.md`. Rationale: `docs/adr/0012-deployment-runtime-and-hosting.md`.
