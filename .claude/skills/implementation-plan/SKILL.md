---
name: implementation-plan
description: Produces an executive-level Implementation Plan — the durable, code-grounded "HOW we build it" artifact that sits between the API contract and writing code. Maps the target file tree, the per-file symbol-level changes (signatures + intent, NOT bodies), the ordered vertical slices, and a subagent delegation map for long plans. Use after /feature-design and /api-contract-authoring, before implementation. The persistent, committed alternative to ephemeral plan mode.
---

# Implementation Plan

## Purpose

This skill standardizes the creation of an **Implementation Plan** — the executive-level
build map authored **after** the feature design and API contract, **before** any code is
written. It is the durable, committed answer to *"how exactly will this land in the
codebase?"*

It is the persistent counterpart to Claude Code's **plan mode**: plan mode researches and
proposes changes in an ephemeral, read-only context that vanishes when the session ends; this
skill captures that same thinking as a **versioned artifact** in the design folder, so the
plan survives, gets reviewed, drives delegation to subagents, and archives with the feature.

```
/grill → /feature-design → /api-contract-authoring → /implementation-plan → build → /git-workflow ship → release (archives after soak)
         (WHY + WHAT)       (the API surface)         (the HOW — this skill)  (code)
```

An Implementation Plan exists to be **a context-management tool, not documentation.** Its
reason to exist is that the agent who builds the feature — and any subagents it delegates to —
read *the plan*, not the whole repository. Every rule below derives from that single principle:
the plan must be self-sufficient and grounded in the real code.

## When to Use

- A feature design **and** an API contract already exist in `docs/design/<slug>/` and the next
  step is to plan the implementation.
- The user says "plan the implementation", "how do we build this", "map the file changes", or
  "make an implementation plan".
- A feature is large enough that the implementing agent would otherwise have to re-research the
  codebase, or large enough to warrant delegating slices to subagents.
- You want the plan-mode thinking as a **durable, reviewable artifact** instead of ephemeral
  session context.

## When NOT to Use

- No feature design or API contract exists yet → run `/feature-design` and
  `/api-contract-authoring` first. This skill is **downstream** and refuses without them.
- The change is a small bugfix or one-file enhancement → just implement it (or use plan mode
  for a quick read-only pass). A formal plan artifact is overkill.
- You're writing the actual code → that's the build step; use `/tdd` to execute the plan's
  slices, not this skill.

> **Multi-phase is supported.** A plan may cover one phase or several (e.g. CRM Phase 1 XL →
> Phase 2 L → Phase 3 L) in a single artifact, and the build may run continuously to completion.
> See "Multi-Phase Execution" below — phases are ordered by dependency and separated by
> verification gates, not human stops.

## Mandatory Inputs (refuse without them)

Before authoring, the following MUST exist; if any is missing, stop and point the user to the
upstream skill:

1. `docs/design/<slug>/feature-design.md` — the WHY/WHAT and the phase scope.
2. `docs/design/<slug>/api-contract.md` — the API surface this plan implements.
3. Any **ADRs** the feature references (`docs/adr/NNNN-*.md`) — the plan must honor them.
4. The **real codebase** — this skill reads actual module files; see the Reality Check below.

## ⚠️ Output File Convention (MANDATORY)

- **Location**: `docs/design/<slug>/implementation-plan.md` — the **same folder** as the
  feature design and API contract.
- **Slug**: identical to the feature design folder. The file is **always**
  `implementation-plan.md` (no variants).
- **Phased features**: prefer a **single plan covering all phases** when they will be executed
  in one continuous build (phases as top-level sections, ordered by dependency, with gates
  between them — see Multi-Phase Execution). Split into separate plan folders only when phases
  ship on genuinely independent timelines.
- **Lifecycle**: the plan is a **build-time, "as-planned" snapshot**. It is committed and lives
  in `docs/design/` while in flight, and the `/git-workflow` Release step (reference:
  `.claude/skills/git-workflow/references/promote-docs.md`) archives it with the folder at Release
  (dev→main), after the prod soak window. It
  is **not** maintained as an "as-built" reflection of the final code — it records what was
  planned, with checkboxes ticked as slices land.

> **NEVER** save the plan to `docs/`, `docs/plans/`, or anywhere outside the design folder.

## Authoring Discipline (read-only until the write)

Author the plan as if you were in plan mode: **read, explore, and reason — but do not edit
source code.** The only file this skill writes is the single `implementation-plan.md` artifact.
No source edits, no scaffolding, no "while I'm here" fixes. The plan describes changes; the
build step makes them.

## Workflow

### Step 1: Codebase Reality Check (anti-hallucination — mandatory)

A plan with invented file paths is **worse than no plan** — it sends the build agent to
construct on fiction. Before drafting anything:

1. Read the **actual** target module(s): `entities.ts`, `repository.ts`, `repository.mongo.ts`,
   `usecases/`, `controller.ts`, `routes.ts`, and the `main.ts` wiring.
2. Read the **real seams** the feature touches: the repository interfaces, the existing tool
   registrations, the scheduler registry, the i18n keys — whatever the contract implies.
3. **Anchor every change to a real `file:line` you actually read** (like the ADRs do). If you
   cannot anchor a change to real code, you do not invent the path — you flag it as a genuinely
   new file and justify it.

The plan's credibility is its grounding. No anchor → no claim.

### Step 2: Write the meta-description

A short executive paragraph: what this implementation does, the shape of the change, the seams
it moves, and what "done" looks like for the phase. This is the orientation a build agent reads
first.

### Step 3: Draw the target file tree(s)

The directory/file tree **after** the plan is executed, marking each node `NEW` / `MODIFIED` /
`UNCHANGED (context)`. This is the map. For a multi-phase plan, draw **one tree per phase you can
anchor to real code** (a "detail tapers by phase" note up front), and leave far phases whose code
does not exist yet at slice level — their tree is authored at their gate (see Multi-Phase
Execution, rule 3).

### Step 4: Author the per-file change table (executive level)

For each touched file, list the **symbols** affected — function/method/class/interface — with:

- **Signature** (name + params + return type),
- **One-line intent** (what it does / why it changes),
- **The seam** it touches (which interface/contract/caller),
- **`NEW` / `MODIFIED` / `REMOVED`**.

**Do NOT write function bodies or implementation code.** This is the line that keeps the plan
executive and prevents it from becoming the code-in-prose that drifts. Signatures and intent,
not bodies. (See "The Executive-Level Contract" below.)

### Step 5: Sequence the vertical slices

Break the work into **ordered vertical slices**, each one a thin end-to-end cut (entity →
repository → use case → controller/route, or the relevant seam) that can be built and verified
on its own. Each slice is sized to hand directly to `/tdd` as one red-green-refactor loop.

### Step 6: Build the subagent delegation map

For longer plans, declare how the work fans out so the orchestrating agent's context stays
clean (see "Subagent Delegation Model"). Mark each slice `foundation` / `independent` /
`integration`, and give each independent slice a **self-contained brief**.

### Step 7: Define the test strategy and Definition of Done

State the objective checks per slice and for the phase (see "Definition of Done"). No slice is
"done" without its check.

### Step 8: Run the checklist

Before finalizing, run [checklist.md](checklist.md). Every item must pass.

---

## The Executive-Level Contract

The plan operates at the level Claude Code's plan mode operates at: **it names what changes, it
does not write the change.**

| ✅ In the plan | ❌ Not in the plan |
|:--|:--|
| `compileRule(rule: ISegmentRule, userId: string): MongoQuery` | The body of `compileRule` |
| "Injects `userId`, validates keys vs catalog, throws `InvalidPredicate` on unknown subtype" | The `if/else` chain that does the validation |
| "New method on `ICRMEventRepository`: `appendEvent(e): Promise<void>`" | The Mongoose `insertOne` call |
| `file:line` anchor to the real caller that must change | A full diff of the caller |
| "Add i18n keys `crm.error.invalid_subtype` (en/es)" | The translated strings themselves (build step) |

The test: a competent engineer or build agent should be able to **execute** the plan without
re-researching the codebase, and **without** the plan having pre-written the solution. If you
wrote the code in markdown, you went too deep. If the build agent has to go re-read the module
to know which method to touch, you went too shallow.

---

## Subagent Delegation Model

Long plans threaten the **orchestrating** agent's context window — not the subagents'. The plan
is how we manage that: the orchestrator stays thin (it holds the plan and the phase gates) and
delegates the heavy reading and writing to subagents that report back summaries.

The plan declares a **delegation map** in three bands:

1. **Foundation (orchestrator, sequential).** Shared types, interfaces, entities, enums —
   anything multiple slices depend on. Built **first, once**, by the main agent. Fanning these
   out causes conflicting/duplicated definitions.

2. **Independent slices (one subagent each).** Vertical slices with no shared mutable seam.
   Each gets a **delegation brief** (below). These fan out via the Agent tool (or a Workflow
   for many).

3. **Integration + verification (orchestrator).** Route wiring, `main.ts` registration,
   cross-slice glue, and the final `tsc`/`lint`/test/`/qa` run. Done by the main agent after
   the slices land.

### The delegation brief — a focus, not a cage

A subagent is a developer on the team, not a blindfolded contractor. Give it **rich context**:
the **full implementation plan, the API contract, and the relevant ADRs**, plus the freedom to
**read any files it judges necessary**. On top of that, the brief is a *focused assignment*:

- the slice's goal,
- the exact files it **owns** (writes),
- the symbols to implement (from the per-file table),
- the already-built foundation seam(s) it builds on,
- its Definition of Done.

The brief is **not** a restriction to "read nothing else" — that is not how real software gets
built, and a context-starved subagent does worse work, not better. The brief *focuses* the
subagent; the shared spec and read-freedom keep it *contextualized*.

**The one hard rule that survives:** no two parallel subagents **write** the same mutable seam.
Conflict avoidance comes from foundation-first ordering and **disjoint file ownership**, never
from starving subagents of context.

**When to recommend fan-out (threshold).** Always include the delegation map, but only
**recommend executing with subagents** when the plan exceeds a threshold — **> 4 independent
slices** or **> ~12 files touched** (count across all phases for a multi-phase plan). Below
that, the main agent builds it solo. State the recommendation explicitly in the plan.

## Multi-Phase Execution

A feature design may have several phases (CRM: Phase 1 XL → Phase 2 L → Phase 3 L). The plan can
cover **all phases in one artifact** and the build can **run continuously to completion** —
Opus-class context plus subagent delegation make this viable. Two rules keep it correct:

1. **Phase order honors dependencies.** Phases are top-level sections; each declares which
   earlier phase it builds on (CRM Phase 2 and 3 both depend on Phase 1's event model). The
   sequential spine is explicit; independent slices *within* a phase still fan out in parallel.

2. **Phase boundaries are verification gates, not human stops.** Before a phase's work begins,
   the prior phase's Definition of Done must be **green** (`tsc`/`lint`/tests/`qa`). A gate that
   fails **halts and surfaces** — it never silently builds the next phase on a broken foundation
   (xcale-mcp-server-soul.md correctness). A gate that passes proceeds automatically.

3. **Detail tapers by phase (rolling-wave) — and the plan says so.** The vertical slices cover
   **all** phases (the spine is complete and visible up front). The per-file detail (file tree +
   symbol tables) is **deepest for the imminent phase(s) and lighter for later ones**, governed by
   the anti-hallucination rule: a later phase that touches code which *does not exist yet* (e.g. an
   integration not built) **cannot** be specified per-file without inventing paths — so it stays at
   slice level until its gate, where a focused Reality Check authors its detail against the
   *as-built* prior phase. This is deliberate, not an omission — **state it explicitly in the
   plan** (a "detail tapers by phase" note) so a reader never mistakes the lighter far-phase detail
   for a gap. Fully specify any later phase whose code already exists today.

**No human in the loop until the plan is fully implemented.** The plan is detailed and grounded
enough to run autonomously to completion. The only thing that stops the build is a **failed
gate** (a real error to surface and fix), never a checkpoint waiting on a human. The review
surface is the finished PR, not a mid-flight phase.

**Commit checkpoints, one PR.** The whole plan is **one branch → one PR**, with the orchestrator
**committing at each green gate** as an implementation checkpoint (and optionally per landed
slice). Many commits, one reviewable PR at the end — clean, bisectable history without ever
pausing the build. Use `/git-workflow` for the branch, commits, and PR.

For the continuous run itself, the natural engine is the **Workflow** tool: phases → pipeline
stages, independent slices within a phase → `parallel`/`pipeline`, phase gates → checks between
stages that halt on failure, and **each green gate → a commit**.

---

## Definition of Done

`xcale-mcp-server-soul.md` correctness: nothing is "done" without an objective check. Every slice and the phase
as a whole carry a Definition of Done tied to **real commands**:

- Type check: `npx tsc --noEmit` clean.
- Lint: `npm run lint` clean.
- Tests: the slice's tests pass (`/tdd` produces them).
- Behavior: where applicable, a `/qa` scenario or `/curl` against `http://localhost:3200`.

The plan tracks these as **checkboxes** that are ticked during the build — the same file is the
plan and the progress tracker.

---

## Golden Rules

| Rule | Why |
|:--|:--|
| **Anchor every existing-file change to a real `file:line`** | A plan built on invented paths is worse than no plan |
| **Signatures + intent, never bodies** | Keeps the plan executive; prevents code-in-prose drift |
| **Phases honor dependencies; gate between them** | Build Phase N+1 only on a green Phase N — never a silent build on a broken foundation |
| **Slices span all phases; per-file detail tapers (rolling-wave)** | Show the full spine up front, detail the imminent phase fully, leave not-yet-existing far phases at slice level — and say so, so lighter detail never reads as a gap |
| **Refuse without feature-design + api-contract** | This skill is downstream; it implements an agreed surface |
| **Foundation before fan-out; disjoint file ownership** | Shared seams built once, then parallel slices write non-overlapping files — that is what avoids conflicts |
| **Delegation briefs focus, never blindfold** | A subagent gets the full plan + contract + ADRs + read-freedom; the brief assigns the slice, it doesn't cage it |
| **Autonomous to completion; one PR, many commits** | No human-in-loop until done; commit at each green gate, the finished PR is the review surface — only a failed gate stops the build |
| **Real-or-absent verification** | No "done" without `tsc`/`lint`/test/`qa` passing |
| **Honor the ADRs** | The plan implements decisions already locked; it does not relitigate them |

## See Also

- **Template**: [implementation-plan-template.md](templates/implementation-plan-template.md) — the fill-in artifact skeleton.
- **Checklist**: [checklist.md](checklist.md) — pre-finalize review.
- **Upstream**: `/feature-design`, `/api-contract-authoring` — produce the inputs this skill consumes.
- **Build-time**: `/tdd` (executes each vertical slice), `/improve-architecture` (whole-codebase deepening review).
- **Downstream**: the `/git-workflow` Release step (reference: `.claude/skills/git-workflow/references/promote-docs.md`) — archives this plan with the design folder at Release (dev→main), after the prod soak window.
- **Architecture**: `docs/architecture-guide.md` — the module pattern the file tree must follow.
- **Lifecycle**: `docs/README.md` — the full design → ship → archive flow.
