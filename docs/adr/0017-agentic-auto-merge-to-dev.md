# ADR 0017: Agentic gates with auto-merge to `dev`; the human gate stays at `dev → main`

- **Status:** Accepted
- **Date:** 2026-08-23
- **Decision makers:** Mateo (release owner)
- **Tags:** process, agent, ci, git-workflow, security

## Context

Every change reaching `dev` today is written and merged by the same party. `/git-workflow` made
self-merge to `dev` explicit on 2026-08-20 — the author runs the Review & Merge gate on their own
diff and merges once CI `verify` is green — because a mandatory approval was permanently blocking
the contributor on a personal-account repo. The result is real throughput and **no independent
control**: the only thing standing between a change and `dev` is the author's own attention.

That matters more here than the repo's size suggests. This is where the connectors to **customer
systems** live — Cloudbeds (a hotel's PMS), Siigo (a client's accounting), Toteat (a restaurant's
POS). A defect does not degrade a page; it reaches into someone's business. The Cloudbeds connect
dead-end a real hotel hit in production ([xcale-backend#522](https://github.com/matesjara/xcale-backend/issues/522))
is the shape of the failure this repo produces.

Every other backend-shaped repo in the company already runs an `agentic-ship` pipeline —
`xcale-backend`, `nevatal-backend`, `nevatal-frontend`, `nevatal-marketing`, `xcale-website`. This
repo and `xcale-frontend` were the two that did not (audited 2026-08-23, issue #54).

The objection that has to be answered before removing a human from a merge path: if one agent
writes the code and another agent of the same model approves it, that is not an independent
control — same-model agents share correlated blind spots. The answer is not that the gates are
infallible. It is that **`dev` is not production**: `main` is, it auto-deploys from `main` on
merge, and the release owner authorizes every release. The human gate is not removed; it is
relocated to where the blast radius actually is.

## Decision

A change is built in a worktree branched from `origin/dev` by a **fresh implementer subagent**,
then judged by **three fresh, independent gate subagents** — none of them a continuation of the
implementer's session:

| Gate | Lens |
|:--|:--|
| `code-reviewer` | inward — credential boundary first, then correctness and the architecture invariants |
| `pr-reviewer` | outward — scope, fidelity to what was asked, honesty of the PR body, hygiene |
| `mcp-contract-qa` | the published MCP surface — executed round trip, agent-fitness, additive-only evolution |

The harness **auto-merges to `dev`** when every gate returns `pass`, GitHub's required `verify`
check is green, and the branch is up to date with `dev`. A blocking finding triggers auto-iteration
up to **N=2**, then escalation with the worktree, branch and PR left in place. **Auto-merge to
`main` is never permitted.**

Three things were decided for this repo rather than ported from `xcale-backend`:

1. **The third gate reviews the contract, not a running process.** The backend's `api-qa` drives a
   dev server with `curl` against a login and a response envelope that do not exist here, and the
   mechanical MCP round trip is already covered better by `mcp.integration.test.ts` (a real client
   over a real socket) and `provider-conformance.ts`, both in CI. What no test can judge is whether
   the *published* surface is usable by the agent on the other end and whether it evolved additively
   for the consumer on the other end. That is `mcp-contract-qa`, and it must produce executed
   evidence, not assertions.
2. **"Green" is platform-enforced here.** `xcale-backend` is private on the Free plan, so branch
   protection returns `403` and its harness is the only thing enforcing CI-green. This repo is
   public and `dev` is protected: required check `verify`, `strict: true`, no force pushes. The
   harness still self-checks, but GitHub is the backstop. Consequence: `gh pr merge --admin` is
   banned outright — with approvals at 0 the only rule it still bypasses is a red build.
3. **The stricter bar is drawn on reach, not on subject.** The requesting issue assumed a provider
   change deserves the higher bar. Provider Self-Containment says the opposite: a standard provider
   PR is confined to `src/providers/{slug}/` and is therefore the *safest* change in the repo. The
   dangerous one leaves that box — `src/core/**`, `src/protocol/**`, `src/auth/**`, or any
   non-additive contract move — because its blast radius lands in a **consumer repo this harness
   cannot build, test or judge**. The harness may auto-merge what it can fully judge; it stops and
   escalates on the rest. Provider changes keep one specific hard gate: the golden-rule file
   footprint is a blocker, because nothing mechanical checks it.

## Alternatives Considered

### Alternative A: Status quo — the author self-merges to `dev`
- **Pros:** Fastest; no token cost; already working.
- **Cons:** No independent control at all on a repo whose defects reach customer systems.
- **Why rejected:** It is exactly the gap issue #54 exists to close.

### Alternative B: Port `xcale-backend`'s pipeline unchanged
- **Pros:** Zero design work; one shape across the company.
- **Cons:** Its third gate targets a Fastify/Mongo API with a login and an envelope this repo does
  not have; its merge-safety doc describes a Free-plan private repo this one is not; its epic /
  `status:*` label lifecycle has no counterpart in this repo's stock label set.
- **Why rejected:** A gate that checks the wrong repo's invariants is worse than no gate — it
  produces a green verdict that a human downstream will trust.

### Alternative C: Graduated autonomy — auto-merge only docs and non-runtime changes
- **Pros:** Lowest risk on-ramp; keeps a human on every line of provider code.
- **Cons:** Caps the win to the cheapest changes; the connector work — the actual risk — still waits
  on a human.
- **Why rejected as the default, retained as the fallback:** this is exactly the mode the tripwire
  below reverts to.

### Alternative D (accepted): Three independent gates, auto-merge to `dev`, escalate on shared reach
- **Pros:** Removes the per-PR bottleneck where the change is contained by construction; keeps a
  human where the blast radius escapes the repo and where it reaches production; every merge carries
  an audit trail explaining why it entered `dev`.
- **Cons:** Rests on the `dev → main` release gate staying rigorous; correlated same-model blind
  spots are real; three top-model agents per change cost tokens on a bootstrapped budget.
- **Why accepted:** `dev` is integration, `main` is production, and the line between "the harness
  may merge this" and "a human must" is drawn on something checkable — the file footprint — rather
  than on judgement.

## Consequences

### Positive
- Cycle time on `dev` is bounded by build and gate speed, not by who is awake.
- Every merged PR carries three verdicts, so the release briefing at `dev → main` has something
  real to read.
- The golden rule gets a machine-run check for the first time; CI only ever greped for
  hand-written `inputSchema`.
- Parallel worktrees let several changes run without colliding.

### Negative
- The safety case **depends entirely** on the `dev → main` human gate staying rigorous. If that
  erodes, this scheme is unsafe. It must never be automated.
- Correlated same-model blind spots are mitigated (three different lenses, fresh sessions), not
  eliminated.
- Higher token cost per change.
- `dev` becomes a place people trust more than the agent panel may warrant — a cultural cost, not a
  technical one.

### Neutral
- `/git-workflow`'s "No auto-merge" safety rule now has exactly one carve-out: this harness, to
  `dev` only. Every other path still requires an explicit human "merge it".
- The harness owns post-merge cleanup; nothing is auto-cleaned.
- **Tripwire:** any defect that reaches a customer system through a change this harness merged
  reverts the policy to Alternative C (docs-only auto-merge) until the gap in the gates is closed
  and recorded here.

## References

- Requesting issue: [xcale-mcp-server#54](https://github.com/matesjara/xcale-mcp-server/issues/54)
- The harness: `.claude/skills/agentic-ship/SKILL.md`; merge safety and the verified protection
  payload: `.claude/skills/agentic-ship/references/merge-safety.md`
- Related ADRs: [additive-contract-versioning](0001-additive-contract-versioning.md) (what
  `mcp-contract-qa` enforces), [credential-forwarding-and-token-model](0003-credential-forwarding-and-token-model.md)
  (the boundary `code-reviewer` puts first), [supply-chain-audit-gate](0014-supply-chain-audit-gate.md)
  (the one CI failure the harness escalates instead of iterating on)
- Prior art: `xcale-backend` ADR 0015 `agentic-auto-merge-to-dev`, ported with the three deviations
  recorded above.
