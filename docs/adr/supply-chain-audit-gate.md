# ADR: Supply-chain audit gate covers the full dependency tree, not just production

- **Status:** Accepted
- **Date:** 2026-08-12
- **Decision makers:** Mateo (release owner), xcale team
- **Tags:** ci, security, supply-chain, tooling, dependencies

## Context

CI runs `npm audit --audit-level=high` on every PR to `dev`/`main` (`.github/workflows/ci.yml`).
It audits the **full** dependency tree. The production image does not: the `Dockerfile` installs
with `npm ci --omit=dev`, so `devDependencies` never ship.

That asymmetry is deliberate but had never been written down, and it surfaces as recurring
friction: a HIGH advisory in the test toolchain turns CI red and blocks a merge with exactly the
same urgency as one in a package the server actually runs. Each occurrence reopens the same
argument — *should the gate just audit what ships?* — with no recorded answer.

### What the history actually shows

The premise behind "narrow the gate" is that most of this churn is toolchain noise. The record
does not support it:

| Advisory | Date | Introduced by | Reaches prod? |
|:--|:--|:--|:--|
| `find-my-way` | 2026-07-23 | `fastify` | **Yes** |
| `postcss` (path traversal) | 2026-07-27 | `vitest → vite` | No |
| `fast-uri` | 2026-08-05 | `@modelcontextprotocol/sdk`, `fastify` | **Yes** |
| `hono` | 2026-08-05 | `@modelcontextprotocol/sdk` | **Yes** |
| `ip-address` | 2026-08-05 | `@modelcontextprotocol/sdk` | **Yes** |
| `nanoid` | 2026-08-12 | `vitest → vite → postcss` | No |

**Four of six were production-reachable.** Narrowing the gate to `--omit=dev` would have suppressed
two of six findings and saved no meaningful review time, while removing coverage from the four that
mattered. The prod tree is 139 of 213 installed packages (65%) — `--omit=dev` is not the large
reduction in audit surface it appears to be.

Both dev-only findings came from the **same chain**: `vitest → vite → postcss`. `vite` pulls
`postcss` to process CSS; this repo is a headless JSON-RPC server with no CSS files at all. That
chain is the identifiable, bounded source of the noise — not `devDependencies` in general.

### Why dev-only advisories still matter here

A compromised test-toolchain package is not harmless. It executes on CI runners and developer
machines with filesystem and network access, in a repo whose CI holds registry credentials and
whose developers hold Doppler tokens for `prd`. For a stateless server that persists nothing, a
malicious build-time dependency is plausibly a *higher* risk than a malicious runtime one.
`soul.md` puts Security first in the priority order; silently dropping the toolchain from the
supply-chain gate contradicts that.

## Decision

**The audit gate keeps covering the full dependency tree at `--audit-level=high`, and stays
blocking.** We explicitly reject narrowing it to production dependencies.

Two refinements, because the current single step conflates two different risk classes:

1. **Split the gate into two named steps** — `Audit (production deps)` running
   `npm audit --omit=dev --audit-level=high`, then `Audit (full tree, incl. toolchain)` running
   `npm audit --audit-level=high`. Both blocking, same threshold. The split changes no policy; it
   makes the CI log answer "is this reachable in production?" at a glance, which is the first
   question asked every time and currently requires a local `npm ls`.

2. **`overrides` is the standard remediation, not `npm audit fix`.** `npm audit fix` resolves the
   whole tree and drags in unrelated churn — for the `nanoid` bump it wanted to add 74 optional
   platform binaries to the lockfile for a single-package change. A pinned `overrides` entry is
   three lockfile lines, greppable, and states the intent. `package.json` already carries
   `esbuild` and `find-my-way` this way.

**Revisit trigger:** if a dev-only HIGH advisory appears with **no upstream fix available** and
blocks an unrelated merge, do not weaken the gate globally — reassess the offending chain instead.
For the known `vite → postcss` case the targeted fix is dropping the dependency, not the gate.

## Alternatives Considered

### Alternative A (rejected): Narrow the gate to `npm audit --omit=dev`
- **Pros:** The gate audits exactly what ships. No dev-only advisory ever blocks a merge.
- **Cons:** Removes supply-chain coverage from code that executes on CI runners and dev machines
  with credentials in scope. Against the actual history it would have suppressed 2 of 6 findings
  and none of the 4 that reached production — near-zero benefit for a real loss of coverage.
- **Why rejected:** trades a genuine security property for friction that the data shows is mostly
  imaginary.

### Alternative B (rejected): Full tree blocking at `critical`, dev-only HIGHs as warnings
- **Pros:** Dev-only HIGHs stop blocking; some signal is retained.
- **Cons:** A non-blocking warning in a green build is a warning nobody reads. It converts a hard
  gate into decoration while appearing to keep it.
- **Why rejected:** the worst of both — the coverage loss of Alternative A plus the false comfort
  of a step that still prints.

### Alternative C (rejected): Keep one combined step exactly as-is
- **Pros:** Zero change.
- **Cons:** Leaves the recurring question unanswered, so it gets relitigated on every red build,
  and still forces a local `npm ls` to classify the finding.
- **Why rejected:** the decision is the point of this ADR; the diagnostic split is cheap.

### Alternative D (accepted): Full tree stays blocking, split into two named steps
- **Pros:** No loss of coverage. The failing step names the risk class immediately. The policy is
  recorded, so the argument closes. Remediation convention is explicit.
- **Cons:** One extra CI step (~2 s) and a marginally longer log.
- **Why accepted:** keeps the security property, removes the ambiguity that caused the friction,
  and costs almost nothing.

## Consequences

### Positive
- Toolchain supply-chain coverage is retained and now deliberate rather than incidental.
- A red audit step identifies its own blast radius without local investigation.
- `overrides`-first remediation keeps advisory fixes reviewable — small, intentional diffs.

### Negative
- A dev-only HIGH still blocks a merge. Accepted: that is the cost of the coverage, and the
  revisit trigger handles the genuinely-stuck case.
- Two audit invocations instead of one.

### Neutral
- No change to `--audit-level`; `high` remains the threshold for both steps.
- The `Dockerfile` keeps `npm ci --omit=dev`. The gate being broader than the image is the
  intended relationship, not a defect to reconcile.

## References
- `.github/workflows/ci.yml` (the audit steps reference this ADR)
- `Dockerfile` (`npm ci --omit=dev` — the production install)
- `package.json` → `overrides` (the remediation mechanism)
- Related ADRs: [deployment-runtime-and-hosting](deployment-runtime-and-hosting.md)
  (`tsx` in `dependencies`, which is why `esbuild` is a *production* dep here)
- `.claude/rules/soul.md` — Priority Order (Security first)
