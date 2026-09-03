---
name: agentic-ship
description: Autonomously build a scoped change in an isolated worktree, run it past three independent agent gates, and auto-merge to dev — no human in the loop. The human gate stays downstream at dev → main. Use for the full agentic build-and-gate pipeline on a change or an issue in this repo.
argument-hint: "[the change to build, a docs/design/<slug> whose implementation-plan to execute, or an issue #N]"
---

# Agentic Ship

Take a scoped change from intent → built → gated → **auto-merged to `dev`**, with no human in the
loop. The human gate is unchanged and lives downstream at `dev → main` (`/git-workflow` Release),
where the release owner authorizes the deploy. This skill is the harness; the decision behind it is
ADR [agentic-auto-merge-to-dev](../../../docs/adr/0017-agentic-auto-merge-to-dev.md).

> **Safety contract.** This skill **only ever auto-merges to `dev`**, never to `main`. It merges
> only when **every gate passes AND CI `verify` is green on GitHub**. It **never** uses
> `gh pr merge --admin`. On any doubt it **escalates instead of merging**.

## Why this repo's gates are not the backend's gates

This harness is a port of `xcale-backend/.claude/skills/agentic-ship`, and three things were
**decided here, not copied**. Read this section before changing a gate — the conclusions are cheap
to restate and expensive to re-derive.

### 1. The third gate reviews the **contract**, not a running process

`xcale-backend`'s third gate is `api-qa`: it drives a Doppler-wrapped dev server with `curl`,
logs in over `POST /api/users/login`, and asserts against the `{ success, data, error }` envelope.
**None of that exists here** — no login, no Mongo, no envelope — and the copy of `api-qa` sitting
in `.claude/agents/api-qa/` is the backend's file, unadapted. It is **not** a gate in this
pipeline.

Adapting it would also duplicate work already done better by CI. `src/protocol/__tests__/mcp.integration.test.ts`
already boots the real Fastify app on an ephemeral port and drives it with a real MCP `Client` over
`StreamableHTTPClientTransport` — `tools/list`, `tools/call`, the metadata gate, and the typed
`PROVIDER_AUTH_EXPIRED` mapping, over the wire. `src/core/testing/provider-conformance.ts` machine-checks
every provider's manifest, auth-descriptor serializability, tool namespacing and `UNKNOWN_TOOL` path.
Both run in CI on every PR. A gate agent re-curling that surface would be a weaker copy that also
needs `MCP_SERVER_SECRET` in scope.

So the third gate is **`mcp-contract-qa`**, and it judges what tests structurally cannot:

- **Round-trip evidence, executed** — for a provider change, that the `add-provider` Definition of
  Done was actually met (catalog → `tools/list` → `tools/call` → forced 401), run and pasted, not asserted.
- **Agent-fitness of the published surface** — a tool description is a `string` to `runProviderConformance`;
  whether a model on the other end can pick the right tool from it is a human-grade judgement.
  Curation (a high-signal subset, not an endpoint dump), naming, and parameter legibility live here.
- **Additive-only evolution (ADR [0001](../../../docs/adr/0001-additive-contract-versioning.md))** —
  a removed or renamed tool, a narrowed input, a changed error code or catalog field without a
  `schemaVersion`/`providerVersion` bump. There is a live consumer (`xcale-backend`) on the other
  end of this contract and no test in this repo can see it break.
- **The credential boundary** — `.reveal()` only at provider egress, no token in a log line, an
  error message, or anything persisted (`docs/security/credential-boundary-review.md`).

The short form: **what can break here is a contract that a downstream agent and a downstream
service consume — not a process that returns 500. So the gate reviews the contract.**

### 2. "Green" is enforced by GitHub here, not by the harness's honour

`xcale-backend` is private on the Free plan, so branch protection returns `403` and its harness is
the *only* thing enforcing CI-green. **This repo is public and `dev` is genuinely protected**:
required status check `verify`, `strict: true` (the branch must be up to date with `dev`), no
direct pushes, no force pushes. So "green" here means all three, and the third is a platform rule:

1. Every gate returned `pass`.
2. `gh pr checks <n>` shows `verify` succeeded — nothing `fail`, nothing `pending`.
3. The branch is up to date with `dev` (`strict`). If GitHub reports it behind, run
   `gh pr update-branch <n>`, wait for `verify` to re-run, and re-check. Do not merge on a stale run.

Two consequences that are easy to get wrong:

- **Never `gh pr merge --admin`.** `enforce_admins` is `false` and `required_approving_review_count`
  is `0`, so the only thing `--admin` still bypasses is a **red build**. CLAUDE.md already forbids
  it; here it is a hard stop. Merge with `gh pr merge <n> --merge`.
- `verify` includes `npm audit` over the **full** tree (ADR [0014](../../../docs/adr/0014-supply-chain-audit-gate.md)).
  An advisory published between the branch cut and the merge can red CI on a diff that never touched
  a dependency. That is **not** a gate finding to iterate on — it needs an `overrides` bump, which is
  a separate decision. **Escalate**, do not patch it inside the run.

Details and the exact protection payload: [`references/merge-safety.md`](references/merge-safety.md).

### 3. The stricter bar is for changes that leave `src/providers/`, not for provider changes

The issue that requested this pipeline assumed a provider change deserves the higher bar. **The
architecture says the opposite, and the harness follows the architecture.** Provider
Self-Containment is the repo's first principle: a standard provider PR touches only
`src/providers/{slug}/` + its tests + one line in `src/providers/index.ts`. That containment is
precisely what makes it *the safest change in the repo* — it cannot break another provider and it
cannot break the consumer contract. What is dangerous is a change that leaves that box:
`src/core/**`, `src/protocol/**`, `src/auth/**`, or any non-additive move on the public contract.
Its blast radius lands in **another repository**, which this harness cannot build, test, or judge.

So the bar is drawn on **reach**, not on subject matter:

| The diff… | `mcp-contract-qa` | Auto-merge |
|:--|:--|:--|
| touches only docs / `.claude/` / `docs/adr` | skipped | yes |
| touches `src/providers/**` (+ tests, + the `index.ts` line) | **mandatory** | yes |
| touches `src/core/**`, `src/protocol/**`, `src/auth/**`, or breaks additive evolution | **mandatory** | **no — stop and escalate** |

> **The rule behind the table:** *the harness may auto-merge what it can fully judge; it may not
> auto-merge what escapes the repo.*

Provider changes still get one thing the backend's pipeline has no equivalent for: the **golden-rule
footprint check** is a `blocker`, not a note. CI only greps for hand-written `inputSchema`; nothing
mechanical checks the file footprint, and a provider PR that quietly edits `src/core/**` is exactly
the failure this repo's architecture is built to prevent. An exceptional ADR in the same diff is the
only thing that clears it (`add-provider` § the golden rule).

**Write-path tools** (a tool that mutates a customer's system — a Cloudbeds payment, a Siigo
invoice, a Toteat order) do not change the merge policy, they change the **evidence bar**:
`mcp-contract-qa` must see ADR [0015](../../../docs/adr/0015-fiscal-write-path.md) honored —
at-most-once semantics, no retry-on-timeout inside the adapter, idempotency left to the consumer —
and the executed round trip pasted in the PR. Reason: a defect here reaches a hotel's PMS or a
client's accounting, and the only control left downstream is the release owner reading this PR's
trail. The trail has to be worth reading.

## Inputs

- A scoped change description, **or** a slug under `docs/design/<slug>/` whose
  `implementation-plan.md` should be executed, **or** an issue `#N` (`gh issue view <n> --comments`).
- Derive **`reach`** from the plan before building — `docs`, `provider`, or `shared` per the table
  above. It decides whether the third gate runs and whether the harness may merge at all. When the
  built diff turns out to have wider reach than planned, **the diff wins**: re-derive from
  `gh pr diff <n> --name-only` after the build, never from the intent.

This repo has **no epic/`status:*` label lifecycle** (`gh label list` is stock GitHub). There is no
label to swap on pickup and no `blocked` label to apply — the backend's roadmap-issue mode has no
counterpart here. The issue thread and the PR are the whole audit trail.

## The pipeline

Execute in order. Narrate each step. **Do not skip the gates; do not merge on doubt.**

### 1. Isolate a worktree from `dev`

There is no `.claude/settings.json` and therefore no `WorktreeCreate` hook in this repo, so the base
branch is not enforced for you — set it explicitly and verify it:

```sh
git fetch origin
git worktree add .claude/worktrees/<slug> -b feat/<slug> origin/dev
git -C .claude/worktrees/<slug> merge-base --is-ancestor origin/dev HEAD   # must exit 0
```

Then `EnterWorktree` by path. A branch that did not come off `origin/dev` is an abort, not a
warning: `strict: true` on `dev` will reject it at merge time anyway, and the gates would have
judged the wrong baseline.

### 2. Build

Delegate the implementation to a **fresh `general-purpose` subagent pinned to `model: opus`** — an
explicit spawn override, so it does not inherit the session's model. Feed it the
`implementation-plan.md` (plus `feature-design.md`, `api-contract.md` and any ADRs), the repo's
`CLAUDE.md`, and — for a provider change — the `add-provider` skill. It writes **inside the
worktree**.

The implementer is independent from every gate that will judge it. That independence is the point;
never let the implementer's session double as a reviewer.

`npm ci` in the worktree before building. No dev server is needed — the gates run tests and
in-process probes, not `curl` against a live port (see § 1 above).

### 3. Open the PR

Ship via the `/git-workflow` Ship discipline — `npm run format:check`, `npm run typecheck`,
`npm test`, the ship-log checkpoint, `npm run adr:number -- --apply` if the branch added an
unnumbered ADR, focused `git add` (**never** `git add .`), a conventional commit with the
`Co-Authored-By` footer, `git push -u origin <branch>` — then `gh pr create --base dev`. Fill the
repo's PR template honestly, including the Provider Self-Containment checkboxes; the outward gate
reads it as a claim and checks it against the diff.

Reference the issue as `Refs #N`. **Never `Closes #N`** — the merge to `dev` is not the end of the
work; the release owner closes the issue after it ships to `main`.

### 4. Run the gates

Run [`references/gates.workflow.js`](references/gates.workflow.js) with
`{ prNumber, slug, reach, issue }` — pass the issue number whenever the run came from one, or
`pr-review` cannot check the diff against what was actually asked. It spawns **fresh, independent**
subagents and returns structured verdicts:

| Gate | Agent | Lens |
|:--|:--|:--|
| `code-review` | `code-reviewer` | inward — correctness, the credential boundary, architecture invariants |
| `pr-review` | `pr-reviewer` | outward — scope, contract fidelity, honesty of the PR body, hygiene |
| `contract-qa` | `mcp-contract-qa` | the published MCP surface — round trip, agent-fitness, additive evolution |

`contract-qa` runs whenever `reach !== 'docs'`.

**A gate that returns nothing is `blocked`, never absent.** The workflow synthesizes a blocking
verdict for any gate that crashed, timed out, or produced output the schema rejected — because step
7 merges on "every verdict says `pass`", a condition a *short* verdict list satisfies trivially. If
you ever see fewer verdicts than gates, that is the bug, not a green run.

### 5. Post the verdicts

One structured comment on the PR carrying every gate's result and findings
(`gh pr comment <n> --body …`), including the executed evidence `contract-qa` produced. **The PR is
the durable audit trail** — there is no other store, and it is what the release owner reads at
`dev → main`.

### 6. Auto-iterate on a block (cap N=2)

If any gate returns `blocked`:

- Hand the blocking findings back to the implementer subagent to fix **in the same worktree**, then
  re-run **all** gates (not just the one that blocked — a fix can break a lens that had passed).
- Repeat at most **twice**.
- Still blocked after the cap → **STOP and escalate**: leave the worktree, branch and PR in place,
  convert the PR to draft (`gh pr ready <n> --undo`) so nothing merges it by reflex, post the
  outstanding findings and the iteration diffs on the PR, and comment on the issue. Do **not** merge.

Escalate immediately, without spending iterations, when: `reach === 'shared'`, CI red for a reason
outside the diff (a fresh `npm audit` advisory), or a gate reports a finding that requires a
**business or architecture decision** the plan did not make. The harness never invents a decision —
it stops and asks.

### 7. Auto-merge (only when truly green)

When every gate is `pass`, `reach !== 'shared'`, and CI is green:

- **Verify CI yourself** — `gh pr checks <n>`: `verify` succeeded, nothing pending, nothing failed.
- **Verify the branch is current** — `gh pr view <n> --json mergeStateStatus`. `BEHIND` →
  `gh pr update-branch <n>`, wait for CI, re-check. `BLOCKED`/`DIRTY`/`UNKNOWN` → escalate.
- `gh pr merge <n> --merge`. **Never `--admin`.**
- Post the merge on the issue with the PR link, and leave the issue open.

Any gate `blocked`, any check not green, or `reach === 'shared'` → escalate, never merge.

### 8. Clean up

Nothing is auto-cleaned after a merge — this step is mandatory:

- `ExitWorktree` first (`gh pr merge --delete-branch` fails while the branch is checked out).
- `git worktree remove --force .claude/worktrees/<slug>`, then delete the local and remote branch.
- `git fetch --prune` and return to `dev`.

## What this skill never does

- **Never merges to `main`.** `dev → main` is the human gate and it auto-deploys to production.
- **Never merges with a blocked gate, a red or pending check, or a stale branch** — it escalates.
- **Never uses `gh pr merge --admin`**, and never force-pushes to `dev` or `main`.
- **Never auto-merges a change that reaches `src/core|protocol|auth/**` or breaks additive
  evolution** — that blast radius lands in a consumer repo it cannot judge.
- **Never lets the builder judge.** Every gate is a fresh subagent with no memory of the build.
- **Never invents a business or architecture decision.** A gap in the plan is an escalation, not an
  improvisation.
- **Never closes the issue.** Closing follows the release to `main`, not the merge to `dev`.
- **Never runs the backend's `api-qa`** as a gate here (see § 1).

## References

- [`references/gates.workflow.js`](references/gates.workflow.js) — the three-gate engine (fresh independent subagents).
- [`references/merge-safety.md`](references/merge-safety.md) — the real `dev` protection, what "green" means, and why `--admin` is banned.
- ADR [agentic-auto-merge-to-dev](../../../docs/adr/0017-agentic-auto-merge-to-dev.md) — the decision, its alternatives and its tripwire.
- [`/git-workflow`](../git-workflow/SKILL.md) — the Ship discipline this skill reuses and the Release gate it stops short of.
- [`/add-provider`](../add-provider/SKILL.md) — the golden rule and the Definition of Done the gates enforce on a provider change.
