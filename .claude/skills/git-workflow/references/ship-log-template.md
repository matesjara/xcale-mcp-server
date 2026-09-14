# Ship-Log Template (Release reference)

The post-build artifact for a feature: `docs/design/<slug>/ship-log.md`. It is the **single
source of operational truth** for a feature — did the migration run, on which environment, was
the UI tested, what adjustments came out, is prod verified. It replaces the retired
`implementation-notes.md`. Durable architectural decisions still go to an **ADR**, not here.

**Keep it lightweight or it rots.** Dated lines and a checklist, not prose essays. Items are
`✅ done (YYYY-MM-DD)` / `⬜ pending` / `N/A (reason)`. Gates only flag `⬜` — `N/A` never
blocks (a feature with no migration just marks migrations `N/A`).

Lifecycle: **created at Ship (Gate 1, merge to dev)** → accrues through the dev QA period →
**finalized at Release (Gate 2, after prod deploy)** → archived after the soak window.

---

## Template

```markdown
# Ship Log — <feature slug>

- **Status:** on-dev | in-soak | archived
- **Released to prod:** <YYYY-MM-DD or "not yet">
- **Related:** feature-design.md · api-contract.md · ADR <slug> (if any)

## Build notes & deviations

<Why we deviated from the implementation-plan; build-time gotchas worth remembering.
Durable architectural decisions go to an ADR, not here. Optional — omit if nothing notable.>

## Ship Log

### Migrations
- [ ] `<script>` on **dev** — ⬜ pending
- [ ] `<script>` on **prod** — ⬜ pending
  <!-- or: N/A (no migration) -->

### Manual UI / QA (dev period)
- <YYYY-MM-DD> tested <flow>; result: <…>; adjustment: <… or none>
- <append a dated line per test + each adjustment/discussion it produced>

### Feature flags / config
- <flag flipped, env, date — or N/A>

### Deploy verification (prod)
- [ ] prod smoke / verification — ⬜ pending

## Known gaps at ship
- <deferred item> → captured as `parked` issue #NNN
- <incident, if any> → see `docs/incidents/<file>`
```
