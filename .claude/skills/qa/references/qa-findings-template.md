# Findings Ledger Template

Copy to `docs/design/<slug>/qa-findings.md` at the start of a QA reconcile loop. This is the durable
QA↔spec cross-check. The `ship-log.md` references it; it does NOT duplicate it. Archived with the
design folder.

```markdown
# <Feature> — QA Findings Ledger

> The disciplined cross-check of QA observations vs the spec (`feature-design.md`, `api-contract.md`,
> the ADRs). One row per finding — the input to the grill → reconcile → iterate loop.
> A finding is NOT a bug until triaged — the verdict can move *either* side (the spec can be wrong).
> **Last updated**: <YYYY-MM-DD> · **Iteration**: <n>

## Legend
- **Sev** — `Blocker` (security/correctness; gates release) · `Major` · `Minor` · `Enhancement`.
- **Verdict** (set at grill) — `code-bug` · `contract-wrong` · `design-gap` · `not-a-bug` · `deferred`.
- **Status** — `open` · `grill` · `fixed` · `deferred` · `wontfix`.
- **Exit**: zero open `Blocker`. Lower sevs graduate to `parked` GitHub issues.

## Findings

| ID | Sev | Spec anchor | Expected (per spec) | Observed (QA) | Verdict | Status |
|:--|:--|:--|:--|:--|:--|:--|
| F-01 | Blocker | api-contract §_ | <what the spec says> | <what QA saw> | <verdict> | open |

## Detail & grill notes
<Per-finding nuance: repro, the grill question, why the verdict. Link to file:line anchors.>

## Triage outcomes (filled at grill time)
> Each open/grill row gets a dated verdict + decision here, and graduates to:
> fix-this-iteration · `parked` issue (next iteration) · contract update · wontfix.

### <YYYY-MM-DD> — Grill: <topic> → Iteration <n>
- **F-__** — <decision, which side fixes, the design choice>.
```

## Cross-repo note

When the frontend returns its reconciliation slice, merge its **contract-touching** rows into THIS
ledger (same schema; reference the FE finding IDs, e.g. `≡ CR-03`). UI-only rows stay in the FE
repo's own ledger.
