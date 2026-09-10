---
name: pr-review
description: Walk the whole stack of open PRs with the release owner, one PR at a time, grill-style — board first, parallel agent review second, self-verification of every blocker third, then a one-question-at-a-time conversation that ends with a merge/return decision per PR. Use when the user says "/pr-review", "revisemos los PRs", "review the open PRs", or asks what is waiting to be merged.
---

# PR Review — the whole open stack, one PR at a time

This is the **release owner's** review of everything waiting on `dev`. It is not `/agentic-ship`
(which auto-merges its own work behind three gates) and not `code-reviewer` (which reads one diff).
It is the conversation that turns a pile of open PRs into merge/return decisions, one decision at a
time.

**Why one at a time.** A batch report asks the release owner to hold ten unrelated contexts at once
and answer questions about code he has not read. He cannot, and he should not have to. So the agent
does all the reading, and then walks him through the stack **one PR per turn**: what it is, what the
review found, one question, one recommendation. He answers; the next turn opens the next PR. Nothing
is merged until he says so, per PR.

## Roles

Merging is the release owner's call, always (see `/git-workflow` › Review & Merge). Self-merge into
`dev` exists for the author of a PR — it is not this skill's mandate. This skill never merges on its
own initiative and never batches merges the owner has not each approved. **Never `gh pr merge
--admin`**: with approvals at 0 the only rule it still bypasses is a red build.

---

## Phase 0 — Build the board (silent)

Do this before saying anything to the user. It is research, not conversation.

1. **List the stack**: `gh pr list --state open --limit 50 --json number,title,author,baseRefName,headRefName,isDraft,additions,deletions,changedFiles,updatedAt`
2. **CI per PR**: `gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup` — write each to
   a temp file, then summarize with `jq`. The single required check is `verify` (format, type-check,
   Vitest, `npm audit`, provider `inputSchema` guard). Never review a red PR; it goes back before
   anything else.
3. **Chains**: any PR whose `baseRefName` is not `dev` is stacked. Record the chain order.
   ⚠️ **Merging a base branch and deleting it auto-CLOSES the PR stacked on top of it.** Retarget the
   child to `dev` *before* the parent's branch is deleted. This has bitten this repo before.
4. **Pairwise conflicts**: for every pair of PRs that touch a shared file, run
   `git merge-tree --write-tree --name-only origin/<branch-a> origin/<branch-b> | grep -i conflict`.
   The repeat offenders here are the **provider registry** (`src/providers/index.ts` — every new
   provider adds a line to the same list), a single provider's `tools.ts` / `manifest.ts` when two
   PRs extend the same adapter, `docs/design/roadmap.md`, and the ADR index. Conflicts decide merge
   order; they are not the owner's problem to solve.
5. **ADR number collisions**: two branches can each mint the same `NNNN-` prefix. Any PR carrying an
   unnumbered ADR (`docs/adr/<slug>.md`) needs `npm run adr:number -- --apply` against fresh `dev`
   right before its merge; two PRs carrying numbered ADRs with the same prefix is a finding.
6. **Hotfix drift**: `git rev-list --count origin/dev..origin/main` — anything with real content on
   `main` and not on `dev` must be back-merged before a release.
7. **Process gates** (from `/git-workflow`, Level 2): for each feature PR, does a
   `docs/design/<slug>/ship-log.md` exist, are QA results attached, and is the change reflected in
   `docs/design/roadmap.md`? A new provider or a new tool with no design folder is a finding, not a
   detail.
8. **Release steps hiding in the diffs** — this repo has no migrations; its equivalents are:
   - a **new provider or new tool** → the published catalog changes, so xcale-backend's discovery
     surface changes with it; if the contract moved at all, the consumer needs a ticket in
     `matesjara/xcale-backend`, filed as a URL, never as an edit to that repo;
   - a **new Doppler secret or env var** → it must exist in `dev` / `stg` / `prd` before `main`
     deploys, and be documented in `.env.example`;
   - a change to **`.do/app.yaml`** or the Dockerfile → the spec must be re-applied at release, not
     just merged;
   - a **contract-shaped change** (`src/protocol/`, `src/core/`, error codes, `authDescriptor`) →
     treat it as a public API change; it needs an ADR or it breaks the additive-evolution rule.

   Collect these now — they are what the owner actually has to schedule.

## Phase 1 — The gates per PR, in parallel

Launch the agents for **all** code PRs **in a single message** so they run concurrently. Which
agents, per PR:

| PR shape | Agents |
|:--|:--|
| Touches `src/` | `code-reviewer` + `pr-reviewer` + `mcp-contract-qa` |
| Docs, roadmap, ADR, CI config only | read directly by the main agent — do not spend an agent |
| Dependency bumps / chores | `code-reviewer` alone |

These are the same three gates `/agentic-ship` runs, used here on someone else's work:
`code-reviewer` is the inward lens (correctness, security, architecture), `pr-reviewer` the outward
one (does it deliver what was asked, does the body tell the truth about the diff, does it integrate
with `dev`), `mcp-contract-qa` the published surface (discover → tools/list → tools/call round trip,
additive-only evolution, credential boundary at egress — executed evidence, never assertions).

Every agent prompt carries:

- the PR number, its title, and the worktree path (with "run everything from there");
- `gh pr diff <n>` and `gh pr view <n> --json title,body` as the inputs;
- the repo rubric: `.claude/rules/soul.md` (its priority order is the tiebreaker), `CLAUDE.md`, the
  three architecture invariants, `docs/foundation.md`, `docs/architecture-review.md`, and the ADRs
  the diff touches;
- the domain-specific lens for that PR:
  - **any new tool or manifest change** → the consumer-agnostic litmus (*could a third party use this
    without knowing xcale-backend exists?*), and whether the tool is actually fit for an LLM agent on
    the other end — description, arguments and result shaped for a caller with no provider knowledge;
  - **anything touching a provider adapter** → Provider Self-Containment (only `src/providers/{slug}/`
    plus one registry line), fidelity over unification, explicit pagination;
  - **anything touching auth or an outbound call** → Credential-in-Transit-Only: `SecretString`,
    `.reveal()` at egress only, never persisted, never logged, not in an error message;
  - **anything mapping provider errors** → 401/403 must surface as a typed "reconnect required",
    never an opaque error, and the code must be one of the closed set;
  - **anything in `src/core|protocol|auth`** → this is the shared spine; a change here is a contract
    change and needs an ADR;
- and **this, always, verbatim in spirit**:

  > CRITICAL: verify that every factual claim the PR description makes about its own behaviour is
  > actually TRUE in the diff. PRs in this repo are written persuasively; a tool announced in the
  > manifest is not the same as a tool wired into the handler, and a documented scope is not the same
  > as a scope the provider actually grants.

Ask each agent for a compact verdict — MERGE / MERGE-WITH-NOTES / REQUEST-CHANGES, blockers with a
concrete failure scenario, majors/minors one line each, and any claim the diff does not back up. Tell
them: no praise, no restating what the PR does.

## Phase 2 — Verify every blocker yourself

**Hard rule: never carry an agent's blocker to the owner without confirming it in the code first.**
A subagent's finding is a lead. Grep the call sites, read the function, count the branches, run the
test. If the finding does not survive your own check, drop it and say nothing about it. If it
survives, you can tell the owner you verified it — and that sentence is the reason he can act on your
recommendation without reading the diff himself.

The failure shapes this repo is most exposed to:

- a tool **published in the manifest but not reachable** — declared in `tools.ts`, missing from the
  handler map, so `tools/list` advertises what `tools/call` cannot serve;
- a **provider capability claimed but not granted** — the adapter calls an endpoint the credential's
  scope or plan does not cover, and the failure only appears against the real provider;
- a fix applied to *some* of the call sites, with the title claiming all of them;
- a value computed and stored but never reaching the tool result that was the whole point;
- a **contract change dressed as a feature** — a field, error code or descriptor variant added to the
  published surface with no ADR and no consumer ticket.

## Phase 3 — The walk (this is the skill)

Open with **two or three sentences of orientation only**: how many PRs, how many are clean, how many
need a decision. No table of ten rows. No findings yet.

Then, **one PR per turn**, in this order: docs and trivial first, chains in dependency order, the
ones with real findings last. Each turn has exactly this shape and nothing else:

> **PR #N — <plain-language name>**
>
> **Qué es** (2–4 sentences). The problem it solves and for whom, in the product's language — what an
> agent on a customer conversation can do after this that it could not do before. No file names, no
> method names, no git mechanics. If it is part of a bigger line of work, say which.
>
> **Qué encontró la revisión** (2–5 sentences). What is true about it, including anything the PR
> claims that the code does not do — stated plainly, and marked as verified by you when it is.
>
> **La pregunta** — exactly ONE, in plain language, about something only he can decide. Followed by
> your **recommendation** and one line on what changes depending on the answer.

Then **stop and wait.** Do not open the next PR in the same turn. Do not ask a second question "while
we are here". If a PR genuinely has no decision in it, say so in three lines and ask only whether to
merge it — that is still one question.

**What counts as his question:** product scope, whether a provider capability reaches customers
before the consumer can use it, whether to hold a release, whether a line of work is wanted at all,
money, anything that changes what we promise a client. **What does not:** merge order, conflict
resolution, retargeting a chain, ADR renumbering, which file gets the fix, whether a test double is
missing. You decide those and mention them only as "lo manejo yo".

**An answer usually opens work — do it immediately, in the same turn.** "Ship it as it is" often
contradicts something else the branch says: a manifest describing a tool the same answer just
narrowed, an error string pointing at a connect method we no longer publish, an ADR describing the
opposite. Say the contradiction in ONE sentence, propose the resolution, and carry it out — while the
context is loaded. Do not batch it to the end; by then you will have re-read six other diffs.

The same applies to a decision that outlives the walk: a founder decision to NOT build something is
as worth recording as one to build it, or the next person reads the gap as a bug and starts building.
Park an entry that states the decision, what is true today, what it would take, and what would unpark
it.

Keep a running tally of decisions taken so far, so the walk can be resumed after an interruption or a
context compaction: PR, verdict, what he said.

## Phase 4 — Execute what was decided

Only after the walk, and only for the PRs he approved:

1. Merge in an order that respects chains and the conflict map. Retarget stacked children to `dev`
   **before** deleting a parent branch. Mechanics that cost time the first run:
   - **Squash the standalone PRs, but merge-commit the parent of a chain.** After a squash the parent
     branch is no longer an ancestor of `dev`, so retargeting the child re-shows the parent's changes
     in its diff. A merge commit keeps the child's diff to its own work.
   - Merge the parent, **then** `gh pr edit <child> --base dev`, then merge the child. Delete no
     branch until the whole chain has landed.
   - Mint ADR numbers (`npm run adr:number -- --apply`) on the branch, against fresh `dev`, right
     before its merge — never earlier in the walk.
   - `gh pr merge` prints nothing on success and `gh pr list` can serve a stale page straight after.
     Confirm with `gh pr view <n> --json state`, never by re-listing.
   - Push to a branch and its checks restart: re-read `gh pr checks <n>` before merging anything you
     just committed to.
2. After each merge, move the roadmap entry in `docs/design/roadmap.md` (and the issue's label, where
   an issue exists) from building to on-dev.
3. For every returned PR, post the findings as a PR comment — specific, cited, and phrased as what
   the code does versus what the description says. Never merge a PR he sent back.
4. Anything accepted with debt becomes a parked entry in `docs/design/roadmap.md` (and an issue where
   one is warranted) in the same breath. Work that lands on the consumer goes to
   `matesjara/xcale-backend` as an issue there, cross-linked by URL — never as an edit to that repo.
5. Run the Cleanup workflow from `/git-workflow`. Note that the reviewing worktree ends the session on
   whatever branch the last agent checked out — return it to a detached `origin/dev` rather than
   leaving it on a merged branch.
6. Report back in one screen: what merged, what went back, what release steps this batch created
   (new secrets, spec re-apply, consumer tickets, contract changes), and what is still open.

## Register

Spanish in the conversation, English in everything that lands in git. Every PR is named with its title
or a short description — **never a bare number**. Concept level throughout: the owner decides what and
why, the agent owns the how. See `.claude/skills/working-with-mateo/SKILL.md`.
