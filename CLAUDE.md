# xcale-mcp-server — Project facts

xcale's own MCP integration platform (a "Composio LATAM"). Provider knowledge lives here;
consumers (xcale-backend first) consume capabilities over stable, consumer-agnostic MCP contracts.

- **Identity & philosophy** — `.claude/rules/soul.md` (always loaded).
- **Glossary** — `CONTEXT.md` (use its canonical terms in code, docs, commits).
- **Vision** — `docs/foundation.md`. **Target architecture & rationale** — `docs/architecture-review.md`.
- **Decisions** — `docs/adr/` (index + policy: `docs/adr/README.md`).
- **Onboarding / add a provider** — `docs/onboarding.md` + the `add-provider` skill.

## Communication — how to answer in chat

**Language: chat in Spanish, artifacts in English.** Every response you write to me is in Spanish.
Everything that lands in the repo or on GitHub stays in English — code, comments, docs, ADRs,
commit messages, PR titles and bodies, branch names. Quoting an artifact inside a Spanish answer
keeps its English wording; don't translate identifiers, paths, commands, or error strings.

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

## Stack

- TypeScript (strict; `exactOptionalPropertyTypes` off — see `docs/adr/typescript-strictness-config.md`),
  Node ≥20 (CI and the production image run 22), ESM.
- Fastify 5 · `@modelcontextprotocol/sdk` (MCP, confined to `src/protocol/`) · zod · pino · Vitest.
- Run via **tsx** (no build step — *complexity on demand*). In production too, so `tsx` is a
  **runtime** dependency (`dependencies`), not a dev tool — see `docs/adr/deployment-runtime-and-hosting.md`.
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

- `main` (default, protected: PR + 1 review) · `dev` (protected: PR). Implementation: feature
  branch → PR → `dev`; release: `dev` → `main` PR. Repo: https://github.com/JuanJo0775/xcale-mcp-server
- **Release-owner override.** Mateo (`matesjara`, CEO) is the release owner and a repo admin;
  `enforce_admins` is `false` on `main`, so he can merge past the 1-review requirement. This is
  routine, not an incident: he authors most PRs and GitHub forbids self-approval, so a solo release
  would otherwise deadlock. Once he has authorized the release, merge with
  `gh pr merge <n> --merge --admin` — do not stop to ask who can approve. What still holds: CI must
  be green, the release gates must pass, and the authorization must be his and explicit for *that*
  release. Never use `--admin` to bypass a red build or an unreviewed contributor PR.

## Deploy

- **DigitalOcean App Platform** (project XCALE, `nyc`), one Docker service tracking **`main`** with
  `deploy_on_push` — merging the release PR *is* the deploy. Health: `GET /health`.
- Spec is versioned in `.do/app.yaml`; `MCP_SERVER_SECRET` is a placeholder rendered from Doppler
  (`prd`) at apply time. Runbook: `docs/deploy.md`. Rationale: `docs/adr/deployment-runtime-and-hosting.md`.
