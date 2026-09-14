# Promote / Archive Docs (Release reference)

Closes the docs lifecycle for a **shipped + soaked** feature: archive its
`docs/design/<slug>/` folder (ship-log included) to `docs/archive/<year>-q<N>/<slug>/`.

> This used to be the standalone `/promote-docs` skill. It is now a **Release-time step** of
> git-workflow, because archival is coupled to the prod soak, not to a dev merge. See ADR
> `post-build-ship-log-and-release-archival`.

## When archival happens

**Not at the dev merge. Not at the release merge.** Archival happens *after the soak window*,
once the feature has run in prod with no open follow-ups. It is triggered by the **Start
Working** soak sweep (which surfaces `Status: in-soak` ship-logs past their window), or on
explicit request ("archive `<slug>`").

Pre-requisites before archiving:

1. The feature is live in prod and **soaked** (no open issues from the follow-up window).
2. `docs/design/<slug>/ship-log.md` is **complete**: dev ops + manual-QA loop + prod ops all
   recorded, no `⬜ pending` items (unresolved ones must become `parked` GitHub issues —
   `gh issue create --label parked` — or move to `docs/incidents/` first).

## Procedure

### 1. Confirm the ship-log is final

Open `docs/design/<slug>/ship-log.md`. Every checklist item is `✅` or `N/A`. Any leftover
`⬜` is either done now or graduated to a `parked` issue / `incidents/` with a link. Flip
`Status: in-soak` → `Status: archived`.

### 2. Decide whether an ADR is warranted

If the feature locked in an architectural choice not yet recorded, write one via `/adr` **before**
archiving (created unnumbered; numbered at its own merge — see `.claude/skills/adr/SKILL.md`).
Most features have none. Don't manufacture an ADR per feature.

### 3. Determine the archive bucket

```bash
YEAR=$(date +%Y); QUARTER=$(( ($(date +%m) - 1) / 3 + 1 ))
mkdir -p docs/archive/${YEAR}-q${QUARTER}
```

### 4. Move the folder (history-preserving)

```bash
git mv docs/design/<slug> docs/archive/${YEAR}-q${QUARTER}/<slug>
```

### 5. Commit + report

```
docs: archive <slug> post-soak

- Moved docs/design/<slug>/ → docs/archive/<year>-q<N>/<slug>/
- ship-log finalized (Status: archived); prod ops + QA loop recorded
```

Report: where it was archived, ship-log final status, any items graduated to `parked` issues or
`incidents/`. Archival closes nothing: the feature's issue closed when its work merged into `dev`.

## Anti-patterns

- **Don't archive at the dev or main merge.** Archive after soak — the ship-log must carry real
  prod facts first.
- **Don't archive with `⬜ pending` items.** Resolve them or move them to `parked` issues /
  `incidents/`; archiving a half-filled ship-log defeats the artifact.
- **Don't delete the folder.** Archive it — future debugging needs the original spec + ship-log.
- **Don't manufacture ADRs.** Only for genuine architectural choices.
