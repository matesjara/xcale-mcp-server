---
name: qa
description: Runs QA test suites against the Xcale backend (via `api-qa` subagent over curl) and/or the frontend (via `quala` subagent over Playwright), AND runs the post-implementation reconcile loop that drives an already-shipped feature to zero open Blockers against its spec across BE/FE repos. Use when the user asks to "test", "qa", "verify", "smoke-test", "regression-check", validate that a feature/module/API contract meets its spec, OR to "reconcile findings", "register findings", "drive to zero blockers", run the post-implementation QA loop on a feature that landed on dev.
argument-hint: "[target: module name, feature slug, or 'all'. e.g., 'billing-v2', 'auth', 'all']"
---

# QA Orchestration

This skill runs QA for the **xcale-backend** repo.

> **Scope — this repo does BACKEND QA only.** It delegates HTTP-level tests to the **`api-qa`**
> subagent (curl against the dev server — auth flows, route handlers, error codes, signature
> verifiers, guards). **Frontend/UI QA is NOT run from here** — it lives in the separate **frontend
> repo** (`xcale-frontend`), which has its own Playwright/`quala` setup. The two repos meet at the
> **`api-contract`** (the shared seam): this repo verifies the API *serves* the contract; the FE repo
> verifies the UI *consumes* + renders it. This skill cannot drive a browser and cannot run anything
> in the FE repo — see the reconcile loop's cross-repo step for the handoff.

Tests are markdown scenarios in `.claude/skills/qa/scenarios/<target>.md`. A scenario file may include
UI scenarios (e.g. a "Part 2 — UI" section) authored here for completeness, but those are **executed in
the FE repo**, never from this skill.

**Two altitudes:**
1. **Suite runner** (this section + Workflow below) — run the scenarios for a target and report. Fast,
   used standalone and as the QA gate other flows call (e.g. `/git-workflow`).
2. **The reconcile loop** (see "Post-implementation reconcile loop" below) — the governance loop
   *around* the runner that drives a shipped feature to **zero open Blockers** against its spec. Its
   "discover" phase IS the suite runner.

## When to Activate

- User says: "test", "qa", "verify", "smoke-test", "regression-check", "run the test suite", "check the endpoints".
- After a merge to `dev` — proactively suggest running the suite.
- After a slice of work lands — run the relevant scenarios file to catch regressions.
- User references a Feature Design or API Contract and asks "does the code match?"

## Workflow

### 1. Resolve the target

Map the user's argument to a scenario file:

| User says | Scenario file |
|:--|:--|
| `billing-v2` | `.claude/skills/qa/scenarios/billing-v2.md` |
| `auth` | `.claude/skills/qa/scenarios/auth.md` |
| `all` | every file in `.claude/skills/qa/scenarios/` |
| (empty) | list available files and ask |

If no scenarios file exists for the named target, **create one** using the format in §3 before running. Use the corresponding API contract (`docs/api/<target>-api-contract.md`) as the source of truth.

### 2. Backend here; UI goes to the FE repo

- This repo runs **backend** scenarios via **`api-qa`** (curl against `https://localhost:3200`).
- **UI scenarios are NOT run here.** They execute in the FE repo (its own Playwright/quala). When a
  target's scenario file has UI scenarios, **hand them off as an artifact** (reconcile loop, cross-repo
  step) — never try to drive a browser from this skill.

### 3. Delegate

Spawn the subagent with:
- Path to the scenarios markdown file.
- Any credentials or base-URL overrides the caller provided (don't invent; pull from Doppler via `doppler secrets get --project xcale --config dev <KEY> --plain`).
- The list of scenario numbers to run (or "all").

Do **not** execute curl / Playwright calls from this skill's context — delegate so the logs stay out of the main conversation.

### 4. Consolidate & report

After the `api-qa` run returns, report the **backend** result:

```
Backend (api-qa):  ⚠️ 10/12 pass — 2 blockers

Blockers: 2
  • Scenario 3: /contacts omits the `pagination` envelope (contract §1)
  • Scenario 11: terminal-state control returns 400, contract says 409

Ready to ship? **No** — contract divergences in the list + control surfaces.
```

Do not hide failures. One failing scenario flips the verdict to "Not ready". **Frontend results are
NOT produced here** — in a cross-repo reconcile loop they come back from the FE repo as its own
report + the contract-reconciliation slice (merged into the ledger).

## Scenario File Format (§3)

Scenarios live in `.claude/skills/qa/scenarios/<target>.md` and follow this structure:

```markdown
# <Target> — QA Scenarios

> **Source**: docs/api/<target>-api-contract.md (§N)
> **Last reviewed**: YYYY-MM-DD

## Scenario 1: <one-line intent>

**Given**: <precondition>
**When**: `<METHOD> <path>` with body `<json or ->`
**Then**:
- Status is `<code>`
- Body has `<jq_path>` equal to `<value>`
- Body has `<jq_path>` present
```

Keep scenarios independent when possible. If one scenario must chain into another (create → use the created id), label them `1a`, `1b`, etc., and state in the Given block which prior scenario's output is required.

## Golden Rules

- **Dev only.** QA never touches prod. Base URL must be `https://localhost:3200` or the configured dev/staging deployment. Refuse if asked to hit prod.
- **Scenarios are source-of-truth.** Don't let agents improvise tests — they run what's written and nothing else. If coverage is missing, add scenarios, then re-run.
- **No destructive DB writes.** Verification-only. If a scenario needs fixtures, seed them via a setup use case (like `createSubscription`) hitting the running server — never raw Mongo updates.
- **Redact secrets in reports.** JWTs / passwords / webhook signatures show first 8 chars + `…`.
- **Scenarios evolve with the contract.** If you change an API contract, update the matching scenario file in the same commit.

## Post-implementation reconcile loop

The governance loop for driving an already-implemented feature (on `dev`) to **zero open Blockers**
against its spec — disciplined, documented, replicable. It orchestrates existing skills; it does not
re-implement them. **Golden rule: register everything, fix nothing until grilled** (discovery and
fixing are separate phases — never jump from a finding to a patch; the spec can be wrong, not just the
code).

1. **Discover** — run `api-qa` for HTTP here. The UI is verified **in the FE repo** (step 3 hands it a
   handoff artifact). **Seed deterministic fixtures** when the critical path is data-starved
   (`scripts/seed/<slug>-qa-fixtures.ts`) — a test fixture, NOT a fix, and it **must mirror the REAL
   key/ID schemes** (an idealized seed once masked a recall-killing `externalId` idempotency bug).
2. **Register** — every finding → `docs/design/<slug>/qa-findings.md` (the durable ledger; the
   `ship-log.md` stays light and *references* it). Fixed schema + legend → [references/qa-findings-template.md](references/qa-findings-template.md).
   `Sev` = Blocker|Major|Minor|Enhancement (rank by `xcale-mcp-server-soul.md`: security > correctness > perf > simplicity).
   `Verdict` (set at grill) = code-bug | contract-wrong | design-gap | not-a-bug | deferred.
3. **Cross-repo reconcile** — the `api-contract.md` is the shared seam: BE verifies it *serves* the
   contract, FE verifies it *consumes* + renders. **Write a handoff artifact** to
   `docs/design/<slug>/fe-qa-handoff.md` (template → [references/fe-handoff-prompt.md](references/fe-handoff-prompt.md)).
   **A human** then opens a Claude Code session in the FE repo and feeds it that artifact (Claude Code
   cannot start cross-repo sessions — the human carries it, exactly like the api-contract is consumed
   today). The FE session grills + runs its Playwright there, and returns its report + a
   **contract-reconciliation slice**. UI-only findings stay in the FE repo; **contract-touching findings
   flow back here** (where the contract lives) in the same ledger schema. Expect most "FE findings" to be
   *the API drifting from an already-correct contract* (code-bugs).
4. **Grill** (`/grill`) — one question at a time, adversarial, cross-referenced against the actual
   code. Resolve each finding's verdict + decision into a dated "Triage outcomes" section of the ledger.
5. **Plan + build** — `/implementation-plan` → a **NEW file per iteration** (`implementation-plan-iter<n>.md`;
   it's a snapshot) → `/tdd` (fan out independent slices; keep shared mutable files like a controller
   on the orchestrator).
6. **Self-review** — `code-reviewer` over the iteration diff; fix Blockers/Majors; re-verify
   `tsc`/`lint`/tests/`/qa`.
7. **Exit: zero Blockers** (not zero findings). Major/Minor/Enhancement graduate to `parked`
   GitHub issues and ride the next iteration. Else loop again.

### Living-vs-snapshot docs (traceability rule)

`api-contract.md` / `CONTEXT.md` / READMEs are **living** — edit in place + add a `## Revision History`
block referencing finding IDs; **never fork** `api-contract-v2.md`. `implementation-plan*.md` is a
**snapshot** (new file per iteration). `ship-log.md` is lightweight and references the ledger. The
"why" lives in git + the ledger, not duplicated. **Canonical worked example**: `docs/design/crm-revamp/`
(`qa-findings.md`, `api-contract.md` Revision History v2, `implementation-plan-iter2.md`, `ship-log.md`).

## See Also

- `/grill` · `/implementation-plan` · `/tdd` · `/git-workflow` · `code-reviewer` — the skills the
  reconcile loop orchestrates (it never re-implements them).
- `.claude/agents/api-qa/AGENT.md` — backend subagent definition.
- `.claude/agents/quala/` (if present locally) or the system-level `quala` agent — UI subagent.
- `.claude/commands/curl.md` — one-shot manual curl helper (superseded by this skill for anything beyond a single quick probe).
- `docs/api/*-api-contract.md` — source of truth for endpoint behaviour; scenarios derive from these.
