# Merge safety on `dev` — what "green" actually means here

The `/agentic-ship` harness auto-merges to `dev` without a human. This file records **what is
enforcing that merge** — because the answer differs from the sibling repo the pipeline was ported
from, and the difference is the whole reason the port needed a decision instead of a copy.

## The difference from `xcale-backend`

`xcale-backend` is **private on the GitHub Free plan**, where branch protection is unavailable —
the API returns `403 "Upgrade to GitHub Pro or make this repository public"`. Its harness is
therefore the *only* thing enforcing CI-green before a merge; its
`references/branch-protection.md` says so explicitly and treats the harness's own `gh pr checks`
call as the safety net.

**`xcale-mcp-server` is public**, so protection is available and `dev` is genuinely protected.
Verified on 2026-08-23 with `gh api repos/matesjara/xcale-mcp-server/branches/dev/protection`:

| Setting | Value | What it buys |
|:--|:--|:--|
| `required_status_checks.contexts` | `["verify"]` | GitHub refuses the merge unless CI passed |
| `required_status_checks.strict` | `true` | …and unless the branch is up to date with `dev` |
| `allow_force_pushes` / `allow_deletions` | `false` | `dev` cannot be rewritten or removed |
| `required_approving_review_count` | `0` | no human approval is machine-required — by design (CLAUDE.md, 2026-08-20) |
| `enforce_admins` | `false` | the repo owner **can** bypass all of the above |

`main` carries the same protection. Nothing in this harness ever targets it.

## What "green" means for the harness

Three conditions, all required, in this order:

1. **Every gate returned `pass`** — `code-review`, `pr-review`, and (unless the diff is docs-only)
   `contract-qa`. This is the harness's own judgement and nothing outside it checks this.
2. **`verify` succeeded** — `gh pr checks <n>`: no check `fail`, none `pending`. GitHub also
   enforces this, but the harness checks first so it reports honestly instead of getting a
   surprise `405` from the merge call.
3. **The branch is current with `dev`** — `strict: true` means a branch that fell behind is not
   mergeable even with a green run. `gh pr view <n> --json mergeStateStatus`: `BEHIND` →
   `gh pr update-branch <n>`, wait for `verify` to re-run, re-check. Never merge on the old run.

Merge command: `gh pr merge <n> --merge`.

## Why `--admin` is banned outright

With `required_approving_review_count: 0`, the *only* rule `gh pr merge --admin` still bypasses is
**a red or missing CI run**. There is no legitimate use of it in this harness: a red build is
either a real defect (iterate) or an out-of-diff failure (escalate), and neither is fixed by
merging anyway. CLAUDE.md already forbids `--admin` for humans; for the harness it is a hard stop.

`enforce_admins: false` is what makes the ban load-bearing rather than decorative — the platform
would let the owner's token through, so the discipline has to live in the harness.

## The one CI failure that is never a gate finding

`verify` runs `npm audit` over the **full** dependency tree, blocking at `high`
(ADR [supply-chain-audit-gate](../../../../docs/adr/0014-supply-chain-audit-gate.md) — deliberately
*not* narrowed to `--omit=dev`). A newly published advisory can therefore red CI on a diff that
never touched a dependency. The fix is an `overrides` entry, which is a supply-chain decision with
its own trade-offs — **not** something the implementer subagent should improvise mid-run.

The harness **escalates** on this, immediately, without spending an iteration.

## If protection is ever loosened

If `verify` stops being a required check, or `strict` is turned off, the harness silently loses
condition 3 and half of condition 2 — it would still self-check, but nothing would stop a human or
a stray token from landing an unverified merge alongside it. Re-verify this table before trusting
the pipeline again:

```sh
gh api repos/matesjara/xcale-mcp-server/branches/dev/protection \
  --jq '{checks: .required_status_checks.contexts, strict: .required_status_checks.strict,
         force: .allow_force_pushes.enabled, admins: .enforce_admins.enabled}'
```
