# ADR: Dated, single-advisory exceptions for dev-only audit findings with no upstream fix

- **Status:** Accepted — amends [0014](0014-supply-chain-audit-gate.md)
- **Date:** 2026-11-17
- **Decision makers:** CTO (C-level decision on matesjara/xcale-mcp-server#217), Mateo (release owner)
- **Tags:** ci, security, supply-chain, tooling, dependencies

## Context

[ADR 0014](0014-supply-chain-audit-gate.md) keeps `npm audit --audit-level=high` blocking over the
full dependency tree and names a revisit trigger: a dev-only HIGH advisory with **no upstream fix**
that blocks an unrelated merge must not weaken the gate globally; the offending chain is reassessed
instead.

That trigger fired on 2026-11-17. `picomatch` carries GHSA-fc5q-39xc-vjpf (ReDoS through
single-branch repeated extglobs). The vulnerable range is `<= 4.0.7` and 4.0.7 is the latest
release, so no patched version exists. The only path to it is `vitest → vite → tinyglobby → fdir →
picomatch`; the production tree (`npm audit --omit=dev`) is clean. npm's suggested "fix" is vitest 3,
two majors back. Every PR to `dev` and `main` was red for a finding nobody can fix yet.

The chain is not the `vite → postcss` case ADR 0014 had in mind, where dropping a dependency was the
targeted fix: vitest is the test runner, not an incidental pull. And the finding is a ReDoS on glob
patterns that we author, not the compromised-toolchain threat the full-tree gate exists to catch.

## Decision

**The full-tree audit step stays blocking at high, and gains one narrow, dated, per-advisory
allowance.** The production audit step is unchanged: plain `npm audit --omit=dev --audit-level=high`.

An exception is allowed only when **all** of these hold:

1. The advisory is unreachable from the production tree.
2. No patched version exists.
3. The chain that carries it cannot reasonably be dropped.
4. The entry names exactly one GHSA id and one package, with a one-line reason, an expiry no more
   than 30 days after it was added, a tracking issue and a decision record.

Mechanics:

- Exceptions live in `audit-exceptions.json` at the repo root, one entry per advisory.
- `scripts/audit-gate.ts` (no new dependency; run with `tsx`) replaces `npm audit
  --audit-level=high` in the full-tree CI step. It reads `npm audit --json` and fails closed on
  non-JSON output, an `error` key, or a missing `vulnerabilities` object.
- It fails when a high or critical advisory is not excepted; when an entry matches an advisory id but
  names a different package; when an entry has expired; when an entry is **stale** (its advisory is no
  longer reported, so it must be removed); and when the file or an entry is malformed.
- Each applied exception prints a `::notice::` with its id and expiry, so it stays visible in every
  CI log.
- Expiry forces a reassessment of the chain under ADR 0014 and this ADR; it is not renewed by
  editing the date alone.

First use: **GHSA-fc5q-39xc-vjpf** on `picomatch`, expiring 2026-12-17, tracked in
matesjara/xcale-mcp-server#218.

## Alternatives Considered

### Alternative A (rejected): `--omit=dev`, or dev-only findings as warnings
- **Why rejected:** already rejected in ADR 0014 (Alternatives A and B). It would drop the
  toolchain from the gate globally to absorb one finding.

### Alternative B (rejected): Replace vitest with `node:test`
- **Why rejected:** vitest is the test runner of the whole repo, not an incidental dependency. The
  migration cost is out of proportion to a ReDoS on globs we author.

### Alternative C (rejected): Wait for an upstream fix
- **Why rejected:** blocks every PR with no end date and no way to know when it ends.

### Alternative D (rejected): `audit-ci` or `better-npm-audit`
- **Why rejected:** a new dependency inside the supply-chain gate itself. A short dependency-free
  script does the job, and we can read all of it.

### Alternative E (accepted): Dated, single-advisory exceptions
- **Pros:** the gate stays blocking; the allowance is one advisory, one package, with a deadline and
  a paper trail, and it fails CI when it goes stale.
- **Cons:** a small script and a data file to maintain.

## Consequences

### Positive
- Unrelated PRs merge again while the gate still blocks every other high or critical advisory.
- An exception cannot linger: it expires within 30 days and fails CI when its advisory goes away.
- Production reach stays guaranteed by the untouched `--omit=dev` step.

### Negative
- An expiry can turn CI red for everyone on a given day. Accepted: that is the forcing function.
- The gate now has its own code to keep correct; `scripts/__tests__/audit-gate.test.ts` covers it.

### Neutral
- ADR 0014's decision is otherwise unchanged; only its revisit trigger now has a recorded procedure.

## References
- [0014 supply-chain-audit-gate](0014-supply-chain-audit-gate.md)
- `audit-exceptions.json`, `scripts/audit-gate.ts`, `.github/workflows/ci.yml`
- matesjara/xcale-mcp-server#217 (decision), #218 (tracking)
