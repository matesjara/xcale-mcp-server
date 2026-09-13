<!-- canonical: xcale-harness — edit in xcale-harness/canonical/, then sync -->
# Working policy — the xcale repos

One policy for xcale-strategy, xcale-backend, xcale-frontend, xcale-mcp-server and xcale-website
([decision: xcale-harness ADR 0002](https://github.com/matesjara/xcale-harness/blob/main/docs/adr/0002-one-working-policy-done-at-dev-nobody-merges-their-own-work.md)). This file is copied byte for byte into each repo: change it in
`xcale-harness/canonical/`, never here. Where this repo's own skills or docs say otherwise, this file
wins — follow it, and fix the stale text in a PR.

## Done, and who merges

- **Done means merged into `dev`.** An issue closes when the PR that completes it merges into `dev`.
  The merge does not close it — GitHub's `Closes #N` only fires on the default branch, `main` — so
  whoever merges closes it by hand once the merge has landed:
  `gh issue close <n> --comment "Merged into dev in #<pr> (<PR title>)"`. A parent issue (an epic, a
  spec) closes with its last open child.
- **Production is read from the release PR** (`dev → main`), which lists what it ships — never from
  the issue.
- **Nobody merges their own work without an independent review.** A merge into `dev` is made by Mateo
  (`matesjara`), or by this repo's autonomous pipeline once its independent review gates pass. Nobody
  else merges into `dev`: Juan José (`JuanJo0775`) merges nothing, his own PRs included, and neither
  does any other contributor — they open the PR and it waits. Mateo's own PRs get an independent
  review too (the repo's reviewer agents, or `/pr-review` from the xcale layer) before he merges them.
- **`main` moves only through a release PR** (`dev → main`, or a `hotfix/*` PR), merged by a human and
  never by a pipeline. Nothing is pushed straight to `main`.

## How a PR merges

- **A merge commit, always:** `gh pr merge <n> --merge`, into `dev` and into `main`. Never squash,
  never rebase. The branch's commits stay the reading unit and the undo granularity
  (`git revert -m 1 <merge>` still undoes a whole PR), a stacked child keeps a diff of its own work,
  and `dev` and `main` share SHAs after a release.
- **Delete the branch as a separate step**, after the worktree that holds it is removed — never
  `--delete-branch` on the merge, which fails halfway when a worktree still has the branch.
- **Stacked PRs:** retarget every open child to `dev` (`gh pr edit <child> --base dev`) before deleting
  the parent's branch. Deleting a base branch closes the PRs stacked on it.

## Work state

State lives in issue labels — one set, the same in every code repo:

| Label | Means |
|---|---|
| `parked` | Not ready: needs a grill or a design, or is deferred work or accepted debt |
| `ready` | Curated and scoped — the next thing to build; a pipeline may take it |
| `status:building` | Taken: a lane is building it, a branch or PR exists |
| `blocked` | Overlay: cannot move until a dependency lands or a human decides — the reason is on the issue |

- An open issue carries exactly one of `parked`, `ready`, `status:building`, and `blocked` rides on top.
  Closed means merged into `dev` — or dropped, with the reason in a comment.
- Whoever moves the work moves the label, when it happens, and reads it back after writing:
  `ready → status:building` at pickup; `status:building` comes off as the issue closes at the merge;
  work handed back returns to `ready` with the reason; an escalation adds `blocked`.
- `status:on-dev` and `status:in-soak` are retired: merged is done, and what has not reached production
  yet is the `dev`-vs-`main` comparison.
- **No markdown roadmap, backlog or parking lot.** Deferred work and accepted debt are `parked` issues.
  A design folder may narrate its phases; each item is tracked in its issue.
- Kind labels (`bug`, `epic`, `spec`, `slice`, `area:*`, …) belong to each repo and say what an issue
  is, never where it stands.

## Language

The conversation with Mateo is in Spanish; with anyone else, in their language. What is written for the
repo and for GitHub — code, comments, commits, branches, PRs, issues, ADRs, docs — is in English, except
the carve-outs this repo documents (in-flight design prose, product copy in the product's languages).

## Handoffs

A handoff is a baton between two sessions, not a document that stays.

- At most one: `HANDOFF.md` at the repo root. To write one, run `/handoff` — or, when asked in words,
  read `.claude/skills/handoff/SKILL.md` and follow it.
- It is committed and pushed so it reaches the other machine: on the branch the work is on — on `dev`
  only by someone allowed to push there — and never on `main`.
- **A session starts by looking for it** (a SessionStart hook announces it where the repo has one).
  When there is one, the session reads it before anything else, verifies what it is about to act on,
  moves what must last to its home (the issue, the design doc, an ADR) and deletes it with
  `git rm HANDOFF.md` in the commit that absorbs it. No PR merges into `dev` with a `HANDOFF.md` in it.
