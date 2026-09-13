# Handoff — xcale-mcp-server specifics

Read by `/handoff` beside the canonical `SKILL.md`. This file belongs to xcale-mcp-server: edit it here.

## Point at these instead of copying them

- **Feature design, API contract, implementation plan, ship-log** — `docs/design/<slug>/`: the source
  of truth while in flight; archived to `docs/archive/<year>-q<N>/<slug>/` after release and soak.
- **Certification and investigation journals** — the dated notes under `docs/design/<slug>/` (Spanish
  is allowed there): link the entry, never retell it.
- **ADRs** — `docs/adr/`: cite the number or slug, never re-explain the rationale.
- **Work** — GitHub Issues, by URL with their titles; accepted debt and deferred work are `parked`
  issues.
- **Contract and consumer** — `docs/foundation.md`, `docs/architecture-review.md`, and the
  xcale-backend issue or PR when a change waits on the consumer side.
- **Glossary** — `CONTEXT.md`. **Code anchors** — `src/providers/<slug>/...:line`,
  `src/core/...:line`.

## Watch for

- **Provider state**: which providers are live, dormant in production or sandbox-only, and what the
  next session must not switch on yet (a Doppler key it needs, an activation checklist issue).
- **Reach**: whether the in-flight change stays inside `src/providers/<slug>/` or touches
  `src/core|protocol|auth` — the second cannot auto-merge, and the next session should know before
  it builds.
- A handoff kept inside a design folder by request (such as `docs/design/siigo-read-only-provider/`)
  is part of that feature's record, not a baton: it follows the folder, not this lifecycle.
