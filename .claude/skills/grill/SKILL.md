---
name: grill
description: Adversarial grilling session that stress-tests a plan against xcale's domain model before you build. Interviews you one question at a time, challenges your terms against CONTEXT.md, invents edge-case scenarios, cross-references the actual code for contradictions, and updates CONTEXT.md inline as terms get resolved. Use when the user wants to pressure-test an idea, sharpen a fuzzy plan, align before a feature, or says "grill me". Runs in front of /feature-design.
---

# Grill

Interview the user relentlessly about a plan until you reach genuine shared
understanding — *before* any design doc or code. This is the alignment step: the most
common failure is the agent building the wrong thing because nobody surfaced the
disagreement early.

It sits in front of the docs lifecycle:

```
Grill (this skill) → /feature-design → /api-contract-authoring → implementation → /git-workflow ship → release (archives after soak)
```

## What to do

Walk down each branch of the design tree, resolving dependencies between decisions one
at a time. For **every** question:

- Ask **one question at a time** and wait for the answer before the next.
- Give your **recommended answer** with reasoning — don't just interrogate.
- If a question can be answered by **reading the code**, read the code instead of
  asking. Use the `Explore` agent for breadth.

Stop when every load-bearing branch is resolved, not when the user gets tired. Then
offer to hand off to `/feature-design`.

## Read the domain first

At the start, load the project's domain model:

- **`CONTEXT.md`** (repo root) — the glossary. This is your weapon: it gives you the
  canonical terms to challenge against.
- **`docs/adr/`** — existing decisions. Don't re-litigate a settled ADR; if the plan
  contradicts one, surface it explicitly rather than quietly going along.
- The relevant **module README** and `docs/architecture-guide.md` for the area.

## During the session

**Challenge against the glossary.** When the user uses a term that conflicts with
`CONTEXT.md`, call it immediately: *"Your glossary defines 'Reconnect' as the user
re-running OAuth, but you seem to mean the silent token refresh — which is it?"*

**Sharpen fuzzy language.** When a term is vague or overloaded, propose a precise
canonical one: *"You're saying 'integration' — do you mean the Toolbox the user
connects, or the Native vs Composio Integration behind it? Those are different things in
this codebase."*

**Invent concrete scenarios.** Stress-test relationships with specific edge cases that
force precision: *"User connects two Shopify stores — same `accountKey`? What happens to
the Tool Basket when store #2's token expires mid-conversation?"*

**Cross-reference the code.** When the user states how something works, check whether the
code agrees. On a contradiction, surface it: *"You said personal tools live in the global
registry, but ADR-0003 and `executionService.ts` resolve them per-conversation into the
Tool Basket — which is right?"*

**Apply the xcale lens.** This is xcale-mcp-server-soul.md's priority order — push back when the plan
violates it: is the **backend doing its job** or is the frontend being asked to think?
Is anything missing a **user-scope filter** (multi-tenant = data breach)? Will a failure
**surface or get swallowed**? Is an **abstraction earning its place**?

## Update CONTEXT.md inline

When a term gets resolved during the grilling, update `CONTEXT.md` **right there** —
don't batch it. Use the existing format in that file: canonical term, one-or-two-sentence
definition of what it *is*, and `_Avoid_:` for the rejected aliases. Keep it a glossary —
no implementation detail, no decisions. Create entries lazily, only when a term is
actually resolved.

## Offer an ADR sparingly

If the session produces a decision that is **hard to reverse**, **surprising without
context**, and **the result of a real trade-off** — all three — offer to record it via
the **`/adr`** skill (`docs/adr/NNNN-slug.md`). If any of the three is missing, skip it.
Don't reimplement ADR formatting here; defer to `/adr`.

## When done

Summarize the resolved decisions and open questions, confirm `CONTEXT.md` reflects any
new terms, then offer: *"Want me to turn this into a Feature Design doc with
`/feature-design`?"*
