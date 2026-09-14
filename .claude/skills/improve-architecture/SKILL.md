---
name: improve-architecture
description: Whole-codebase architecture review that finds "deepening" opportunities — shallow pass-through modules to collapse, tangled seams to clean, untestable code to restructure — informed by CONTEXT.md and docs/adr. Use when the user wants to improve architecture, reduce a ball-of-mud, find refactoring opportunities, or make a module more testable/navigable. Complements code-reviewer (which is diff-scoped); this scans the whole tree.
---

# Improve Architecture (xcale)

Surface architectural friction across the codebase and propose **deepening
opportunities** — refactors that turn shallow modules into deep ones, so behavior is
easier to test and the tree is easier to navigate. This is the antidote to AI-accelerated
entropy (xcale-mcp-server-soul.md): run it periodically, not just when something hurts.

`code-reviewer` reviews a diff. **This skill scans the whole module tree** for structural
problems no single diff reveals.

## Vocabulary (use these exactly)

Consistency is the point — don't drift into "component", "service", "API", or
"boundary".

- **Module** — anything with an interface and an implementation: a function, an entity,
  a use case, a repository, a whole `src/modules/*` slice.
- **Interface** — *everything a caller must know* to use the module: types, invariants,
  error modes, ordering, required config — not just the type signature.
- **Depth** — leverage at the interface: a lot of behavior behind a small interface.
  **Deep** = high leverage. **Shallow** = interface nearly as complex as the
  implementation.
- **Seam** — where an interface lives; a place behavior can be swapped without editing in
  place (e.g. an `IFooRepository`). Use this word, not "boundary".
- **Locality** — what maintainers get from depth: change, bugs, and knowledge
  concentrated in one place instead of smeared across callers.

Two load-bearing tests:

- **Deletion test** — imagine deleting the module. If complexity *vanishes*, it was a
  pass-through (shallow). If complexity *reappears across N callers*, it was earning its
  keep (deep). "Concentrates complexity" is the signal you want.
- **Two-adapter rule** — one adapter at a seam is a *hypothetical* seam; two adapters
  make it *real*. Don't introduce a seam unless something actually varies across it.

## Process

### 1. Load the domain, then explore

Read **`CONTEXT.md`** (talk about modules in glossary terms — "the Connection Rail", not
"the FooHandler") and the **`docs/adr/`** in the area. ADRs record decisions you must
*not* re-litigate.

Then use the **`Explore`** agent to walk the codebase organically. Don't follow rigid
heuristics — note where *you* feel friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where were pure functions extracted *only* for testability, but the real bugs hide in
  how they're wired together (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- What's untested, or hard to test through its current interface?

Apply the **deletion test** to anything you suspect is shallow.

In xcale specifically, watch for: per-module copies of something the **Connection Rail**
or another rail already does (ADR-0005); tools that bypass the **Tool Basket** /
context-injection seam (ADR-0003); bespoke `ui` components that should be **UI
Primitives** (ADR-0006); business logic that drifted into a controller or the frontend
instead of a use case (the backend-driven principle).

### 2. Report the candidates

Write a **Markdown report** to the OS temp dir (`$TMPDIR` or `/tmp`), e.g.
`<tmpdir>/xcale-architecture-review-<topic>.md`, so nothing lands in the repo. Tell the
user the absolute path. (Offer a self-contained HTML version with before/after diagrams
only if the user asks — keep the default lightweight.)

For each candidate:

- **Module(s)** — what's involved, in glossary terms.
- **Friction** — why the current shape causes pain (cite the deletion test where it
  applies).
- **Deepening** — plain-English description of the shape after the refactor, and what new
  seam (if any) it creates. Apply the two-adapter rule before proposing a seam.
- **Payoff** — in terms of **locality** and **leverage**, and specifically how tests get
  easier.
- **Strength** — `Strong` / `Worth exploring` / `Speculative`.
- **ADR conflict** — if it contradicts an existing ADR, say so plainly and only surface
  it when the friction is real enough to reopen that ADR. Don't list theoretical refactors
  an ADR forbids.

End with a **Top recommendation**: which one to tackle first and why.

Do **not** design the new interfaces yet. Ask: *"Which of these do you want to explore?"*

### 3. Grill the chosen candidate

Once the user picks one, drop into a **`/grill`** session on it — walk the design tree,
the constraints, the shape of the deepened module, what sits behind the seam, which tests
survive. Side effects happen inline, same discipline as `/grill`:

- Naming a deepened module after a concept not in `CONTEXT.md`? **Add the term** there.
- The user rejects the candidate for a load-bearing reason a future review would need to
  avoid re-suggesting it? **Offer an ADR** via `/adr`.
- Ready to build it? Hand off to **`/feature-design`** (or straight to **`/tdd`** if it's
  a contained, test-first refactor).
