---
name: handoff
description: Write the handoff for the next session — HANDOFF.md at the repo root, committed and pushed so another session, or another machine, picks the work up cold. Use when the user asks for a handoff or wraps up work that continues later. Picking a handoff up needs no skill; the working policy says how.
argument-hint: "[what the next session will focus on]"
disable-model-invocation: true
metadata:
  canonical: xcale-harness
  derived_from: "https://github.com/mattpocock/skills/tree/main/skills/productivity/handoff (MIT, Matt Pocock)"
---

# Handoff

Write the baton for the next session: everything it needs to continue cold, and nothing it can read
somewhere else. The lifecycle — one at a time, committed, read first, absorbed, deleted in the commit
that absorbs it — is in `.claude/rules/working-policy.md`. This skill is how to write one.

If `.claude/skills/handoff/REPO.md` exists, read it first: it names this repo's authoritative sources and
any section this repo requires. It belongs to the repo; this file is canonical and is not edited here.

## Before writing

- **A `HANDOFF.md` already at the root has not been absorbed.** Say so, and ask whether to absorb it
  first or fold it into the new one. Never stack two.
- **Check what is true now**, not what the conversation believes: the branch and whether it is pushed,
  the open PRs and their state, the issues touched and their labels.

## What it holds

1. **Goal of the next session** — from the argument, or from where the conversation landed. One or two
   sentences.
2. **State** — done and verified; done but not verified; not started. A skipped or half-done step is
   said plainly: a handoff that inflates progress is worse than none.
3. **Branch and commits** — the branch, the last commit, whether it is pushed, the open PRs with their
   titles.
4. **Next action** — the one step to start with, concrete enough to start cold.
5. **What is left** — an ordered checklist.
6. **Open decisions and waits** — what waits on Mateo or on someone outside, each marked blocking or no
   rush, with the options when there are some. Decide nothing for them.
7. **Traps** — what will bite the next session and is not obvious: a doc that contradicts the code, a
   gate that needs an authorization, a workaround that is holding something together.
8. **Skills to use** — which skills the next session should run, in order.
9. **Pointers** — issues and PRs by URL with their titles, files by path, ADRs by number, memory files by
   name.

**Reference, never copy.** A design doc, a contract, an ADR, an issue thread or a commit already holds
its content; a second copy goes stale and gets believed. **No credentials, tokens or customer data** —
name where a secret lives (the Doppler key), never its value.

## Commit it

- Write `HANDOFF.md` at the repo root, in English and skimmable: headings, short lines, checkboxes.
- Commit that file alone and push it, so it reaches the other machine:
  `git add HANDOFF.md && git commit -m "docs(handoff): <focus>" && git push`.
- On the branch the work is on. On `dev` only if you may push to `dev`; never on `main`. With no work
  branch and no right to push to `dev`, cut `docs/handoff-<slug>` from `origin/dev` and push that.
- Tell the user the branch and the two or three things that matter most in it.
