---
name: git-workflow
description: Governs all git operations — branching, committing, pushing, PRs, and releases. Activates whenever the user asks to work on a feature, ship changes, commit, create a PR, release, or any git-related action. Also activates proactively when code changes are ready to be committed.
argument-hint: "[optional: ticket ID like XCA-74, or action like 'ship', 'release']"
---

# Git Workflow

This skill defines how code moves from local changes to production in xcale-mcp-server. Follow this methodology for every git operation — whether the user explicitly says "ship" or naturally says "let's work on feature X" or "commit this".

## Roles (two-dev model — decided 2026-06-11; self-merge revised 2026-08-20)

| Role | Who | May do | May NOT do |
|:--|:--|:--|:--|
| **Release owner** | Mateo (`matesjara`) | Everything below + **merge to `dev` and `main`** + Release | — |
| **Contributor** | Juan José (`JuanJo0775`) | Start Working + Ship: branch from `dev` (or from his own branches as a working technique), open PRs **to `dev`**, write + run his feature's QA scenarios, **merge his own PRs into `dev`** once CI is green | Merge to `main` · Release · push directly to `dev`/`main` |

- **Every PR targets `dev`** — no stacked PRs (PR into another work branch). A big feature ships as ordered vertical slices, each PR'd to `dev`, not as a PR tower.
- **Self-merge into `dev` is allowed** (revised 2026-08-20). The author may merge their own PR to `dev` once CI `verify` is green and they have run the Review & Merge gate below on their own diff. They do **not** wait for the release owner.
- **`main` is different.** Every merge to `main` needs the release owner's explicit authorization for *that* release, whoever opens or merges the PR — `main` auto-deploys to production.
- Enforcement is GitHub branch protection on both branches: PR required, CI `verify` green and up to date with the base, no direct pushes, no force pushes. **No approval is machine-required** — review is a team convention, so the gate below rides on the author's honour.
- Start Working and Ship apply to **both** devs. Release is **release-owner only**.

## When to Activate

- User asks to work on a feature, task, or bug fix → **start a branch**
- User says "ship", "commit", "push", "done", "send it" → **ship workflow**
- User asks to review an incoming/contributor PR ("revisa el PR de Juan") → **review & merge workflow**
- User asks to deploy, release, or promote to production → **release workflow**
- User asks to create a PR → **ship workflow** (PR is part of shipping)
- User asks to clean up, tidy branches, or after a PR merge → **cleanup workflow**
- You finish implementing a feature and the user hasn't committed yet → **suggest shipping**

## Branch Strategy

```
feat/XCA-74-desc  ──PR──▶  dev  ──PR(release)──▶  main (production)
hotfix/auth-crash  ──PR──────────────────────────▶  main (bypasses dev)
```

| Branch            | Purpose                                                     | Receives PRs from                  |
| ----------------- | ----------------------------------------------------------- | ---------------------------------- |
| **`main`**        | Production. DO App Platform auto-deploys (`xcale-mcp-server`). | `dev` (via release) or `hotfix/*`  |
| **`dev`**         | Integration/staging. Quality gate before production.        | `feat/*`, `fix/*`, `chore/*`, etc. |
| **Work branches** | One per task. Short-lived.                                  | —                                  |
| **`hotfix/*`**    | Critical production fixes. Branch from `main`.              | —                                  |

See [references/branch-strategy.md](references/branch-strategy.md) for naming conventions and detailed flow.

## Five Workflows

### 1. Start Working (`feat`, `fix`, `chore`, etc.)

When the user begins work on a task:

1. **Clean first**: `git fetch --prune` and delete stale local branches (see Cleanup workflow)
2. **Soak sweep**: scan `docs/design/*/ship-log.md` for any with `Status: in-soak` whose
   `Released to prod:` date is past the soak window. For each, surface it: *"`<slug>` has been
   in prod since `<date>` — anything still pending, or are we good to finalize the ship-log and
   archive it?"* This is where post-release follow-up gets closed (don't silently skip it). See
   [references/promote-docs.md](references/promote-docs.md).
3. Ensure `dev` is up to date: `git checkout dev && git pull origin dev`
4. Create a branch: `git checkout -b feat/XCA-74-short-description`
5. Begin implementation

If the user is already on a feature branch, just continue working — no branch creation needed.

### 2. Ship (commit + push + PR)

When changes are ready to ship:

1. **Format**: `npm run format:check` — **STOP if it fails**
2. **Type check + tests**: `npm run typecheck` then `npm test` — **STOP if either fails**
3. **Analyze**: `git diff --stat` — understand intent, check for secrets
4. **Ship-log checkpoint (Gate 1)**: if the change ships a feature with a folder in
   `docs/design/<slug>/`, ensure a `docs/design/<slug>/ship-log.md` exists (create it from
   [references/ship-log-template.md](references/ship-log-template.md) if not). Record the
   dev-side ops now — migration on dev (`✅`/`N/A`), and open the manual-QA section. Do **not**
   archive here — archival is a Release step, after the prod soak. Mark items `✅ done (date)` /
   `⬜ pending` / `N/A (reason)`; only `⬜` items are worth flagging. See `docs/README.md`.
5. **ADR numbering checkpoint**: if the branch added any **unnumbered** ADR (`docs/adr/<slug>.md`, no `NNNN-` prefix), run `npm run adr:number -- --apply` so its number is minted against `dev` right before merge — this is the guard against two branches colliding on the same number. (No-op if there are none.) See `.claude/skills/adr/SKILL.md`.
6. **QA evidence (feature PRs)**: if Gate 1 applied (feature with a design folder / new or
   changed API surface), the QA scenarios (`.claude/skills/qa/scenarios/<target>.md`) must exist
   and have run **green on dev** — the author writes and runs them (QA is part of delivering the
   feature, not the reviewer's favor). Attach the result summary to the PR description.
7. **Stage**: `git add <specific files>` — never `git add .`
8. **Commit**: Conventional format with Co-Authored-By footer
9. **Push**: `git push -u origin <branch>`
10. **PR**: `gh pr create --base dev` (or `--base main` for hotfixes)

**Never merge the PR on your own initiative.** Creating the PR is where Ship ends. A merge always
takes an explicit human "merge it" — from the PR's author or the release owner for `dev`, and from
the release owner specifically for `main`. What changed on 2026-08-20 is *who may authorize*, not
that authorization is needed: the author may now merge their own PR into `dev` once CI is green and
the Review & Merge gate has run, instead of waiting on the release owner.

See [references/commit-conventions.md](references/commit-conventions.md) for commit format and safety rules.

### 3. Review & Merge (before any merge)

Run this before a PR into `dev` is merged — by the release owner when he reviews someone else's PR
("revisa el PR de Juan"), and by the author on their **own** diff when they self-merge. The gate has
**two levels**:

**Level 1 — every PR, including chores:**
1. **CI `verify` green** (provider `inputSchema` guard, format, type-check, tests, `npm audit` on prod deps and on the full tree). Never review a red PR — send it back first.
2. **`code-reviewer` agent over the PR diff** (`gh pr diff <n>` as input) — **zero open Blockers**.
   Majors/Minors are judgment calls: request changes or accept-and-roadmap them, explicitly.
3. **Brief the release owner in plain terms — always, before any verdict.** Mateo reads the
   briefing, not the diff. Lead with *what changes and why*, in concrete language, no jargon dump:
   what the code did before, what it does now, what breaks if we merge it, and what is left open
   (ops, follow-ups, half-closed roadmap items). Short and specific — a screen, not an essay.
   Details go in the review notes below the fold; if he wants the diff he'll ask. On a self-merge
   to `dev` this is still owed — after the fact, in the turn that reports the merge.
4. **The human owns the verdict.** The agent and the briefing advise; a human decides — the author
   for their own `dev` merge, the release owner for anything touching `main`.

**Level 2 — feature PRs** (design folder in `docs/design/<slug>/`, or new/changed API surface), additionally:
4. **Ship-log exists** (`docs/design/<slug>/ship-log.md`) with dev-side ops recorded (Ship Gate 1).
5. **QA scenarios green on dev** — written and run by the PR author, result attached in the PR
   description. The reviewer may re-run them (`/qa <target>`) when in doubt.

**Verdict**: merge (the author for their own `dev` PR, the release owner for anything to `main`),
or request changes citing the specific gate items that
failed. After merging: run the Cleanup workflow. If anything was accepted-with-debt, park it in
`docs/design/roadmap.md` in the same breath.

### 4. Release (dev → main)

When `dev` is stable and ready for production:

1. **Ship-log gate (Gate 2)**: for each feature shipping in this release, its
   `docs/design/<slug>/ship-log.md` must have the **manual-QA loop closed** (no open
   adjustments) and **dev ops complete**. Surface any `⬜ pending` items before proceeding —
   a feature with an open QA loop is not ready for prod.
2. Generate changelog from commits on `dev` not on `main`
3. Create PR from `dev` to `main` with grouped changelog
4. User merges manually after review
5. **Post-deploy (prod ops)**: after `main` deploys, run prod migrations, smoke-verify, and
   record these in each ship-log; set `Status: in-soak` + `Released to prod: <date>`. The
   design folder **stays** in `docs/design/` through the soak — it is **not** archived now.
6. **Archival (after soak)**: archival happens later, once the feature has soaked with no open
   follow-ups — driven by the **Start Working** soak sweep, not by the merge. Procedure:
   [references/promote-docs.md](references/promote-docs.md).

> **Why archival is decoupled from the merge:** prod ops are only knowable *after* deploy, and a
> released feature needs a soak window before it's truly done. Archiving at merge would freeze
> the ship-log with empty prod facts. See ADR `post-build-ship-log-and-release-archival`.

See [references/release-process.md](references/release-process.md) for full process.

### 5. Cleanup (keep local and remote tidy)

Branches are short-lived. After a PR is merged, the branch should be deleted — both locally and on GitHub. This workflow runs:

- **Proactively** after a successful ship + merge cycle
- **On request** when the user says "clean up", "tidy branches", or similar
- **At the start of a new task** to ensure a clean working state

**Steps:**

1. **Prune remote-tracking refs** that no longer exist on origin:

   ```bash
   git fetch --prune
   ```

2. **Delete local branches** whose remote is gone (merged and deleted on GitHub):

   ```bash
   git branch -vv | grep ': gone]' | awk '{print $1}'
   ```

   For each branch found, delete it: `git branch -d <branch>`

3. **Delete remote branches** for merged PRs (GitHub auto-deletes if configured, but verify):

   ```bash
   gh pr list --state merged --json headRefName --jq '.[].headRefName' | head -20
   ```

4. **Return to `dev`** after cleanup:

   ```bash
   git checkout dev && git pull origin dev
   ```

5. **Report** what was cleaned: "Deleted N local branches, pruned remote refs. On `dev`, up to date."

**Proactive behavior:**

- After shipping (step 7 of Ship workflow), if the PR is later merged, suggest cleanup next time the user starts a new task
- At the start of "Start Working" workflow, run `git fetch --prune` and clean stale local branches automatically before creating the new branch

## Safety Rules (Always Apply)

- **TypeScript first**: Never commit code that fails `npm run typecheck`
- **Format clean**: Never commit code that fails `npm run format:check`
- **No secrets**: Scan for `.env`, credentials, API keys, Doppler tokens before staging
- **No force push**: Never to `main` or `dev`. Never without explicit request
- **No hook skipping**: Never `--no-verify` unless explicitly requested
- **No direct commits to `main`**: Always go through `dev` (or hotfix PR)
- **No direct pushes to `dev` or `main`**: both are protected — they only move via PRs with CI green
- **Self-merge to `dev` only**: the author may merge their own PR into `dev` after the Review & Merge gate; `main` always needs the release owner's explicit authorization for that release
- **No auto-merge**: Creating the PR ≠ merging it. A merge always takes an explicit human "merge it".
  **One carve-out** (2026-08-23): the `/agentic-ship` harness may merge its own PR into `dev` — and
  only into `dev` — when its three independent gates all pass and CI `verify` is green. Nothing
  else auto-merges, and nothing auto-merges to `main`. See ADR
  [agentic-auto-merge-to-dev](../../../docs/adr/0017-agentic-auto-merge-to-dev.md)
- **Never `gh pr merge --admin`**: with approvals at 0, the only rule it still bypasses is a red
  build. A red build is either a defect (fix it) or an out-of-diff advisory (decide on it) — merging
  fixes neither
- **New commits only**: Never amend unless explicitly requested
- **Atomic commits**: Suggest splitting unrelated changes

## Context Detection

When the user asks to ship, detect the current state automatically:

| Current branch                 | Action                              |
| ------------------------------ | ----------------------------------- |
| `main` or `dev` with changes   | Create branch from `dev`, then ship |
| Feature branch with changes    | Ship (commit, push, PR)             |
| Feature branch, already pushed | Update PR (push new commits)        |
| Any branch, no changes         | Nothing to ship — inform user       |
| `hotfix/*` branch              | PR targets `main` instead of `dev`  |
