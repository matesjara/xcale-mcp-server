# ADR: Deployment runtime and hosting (DO App Platform, Docker, tsx in production)

- **Status:** Accepted
- **Date:** 2026-07-21
- **Decision makers:** Mateo (release owner), xcale team
- **Tags:** infrastructure, deployment, runtime, cost

## Context

The server had no production home: it ran only locally under `tsx watch`. Deploying it forces
three coupled choices — **where** it runs, **how** the image is built, and **how** TypeScript
becomes a running process. Each one is durable (it constrains every future release), so they are
recorded together.

Constraints that shaped the decision:

- **Consistency beats novelty.** `xcale-backend` already runs on DigitalOcean App Platform:
  Dockerfile-based service, GitHub `main` with `deploy_on_push`, `/health` health check, region
  `nyc`. A second hosting model would be a second thing to operate.
- **Complexity on demand.** The repo deliberately has *no build step* (`tsx src/server.ts`).
  A production deploy is not, by itself, proof that a compile pipeline is needed.
- **Cost matters.** xcale is bootstrapped; the server is stateless and, at launch, low-traffic.
- **Credential-in-Transit-Only.** Nothing in the image or the spec may embed a plaintext secret.

## Decision

**1 — Hosting: DigitalOcean App Platform, one Docker service, tracking `main`.**
Same platform, region (`nyc`), and release trigger as `xcale-backend`: `deploy_on_push` from
`main`, so production always equals `main` (releases stay a `dev` → `main` PR). Health check hits
the public, unauthenticated `GET /health`.

**2 — Build: a plain (single-stage) Dockerfile, not a buildpack.**
The Dockerfile is in the repo, reviewable, and identical locally and in CI. It installs with
`npm ci --omit=dev` and copies `src/`, `tsconfig.json` and `assets/` (the last one is runtime
state: `/assets/:filename` serves provider logos).

**3 — Runtime: TypeScript executes through `tsx`; no build step, no `dist/`.**
`tsx` therefore moves from `devDependencies` to **`dependencies`** — in this design it is a
runtime dependency, and calling it a dev tool would be a lie that breaks `--omit=dev`.
The entrypoint is `node --import tsx src/server.ts` (not `npm start`), so the Node process is
PID 1 and App Platform's `SIGTERM` reaches the graceful-shutdown handler directly instead of
being swallowed by an `npm` wrapper.

**4 — Sizing: `basic-xxs`, one instance.**
512 MB / 1 shared vCPU (~$5/month) for a stateless server with no launch traffic. Scaling up is
a one-line spec change when real load exists.

**5 — Secrets: Doppler is the source of truth; the committed spec holds a placeholder.**
`.do/app.yaml` is versioned and declares `MCP_SERVER_SECRET` as `${MCP_SERVER_SECRET}`, rendered
from Doppler (`xcale-mcp-server` / `prd`) at apply time (`docs/deploy.md`). No secret is ever
committed, and the app spec never drifts from the repo.

**Revisit triggers:** measured cold-start or memory pressure attributable to `tsx` (→ adopt a
compile step, which then needs its own ADR); traffic that outgrows one `basic-xxs` instance
(→ resize / add instances); a second deployable service in this repo (→ revisit the single-service
spec).

## Alternatives Considered

### Alternative A (rejected): DO Node.js buildpack instead of a Dockerfile
- **Pros:** No Dockerfile to maintain; auto-detected.
- **Cons:** The buildpack's install/prune behaviour is outside our control and is exactly what
  breaks a `tsx`-based runtime (dev dependencies pruned under `NODE_ENV=production`). It is also
  not reproducible locally.
- **Why rejected:** hides the one mechanism this runtime depends on, and diverges from
  `xcale-backend`.

### Alternative B (rejected): add a compile step (`tsc` → `dist/`, run plain `node`)
- **Pros:** Faster startup, no transpiler or `esbuild` in the runtime image, conventional.
- **Cons:** Introduces a build pipeline, a `dist/` artifact, source-map handling, and a second way
  for local and production to diverge — for a measured gain of a few hundred milliseconds at boot
  (measured: ~440 ms to first healthy response under `tsx`).
- **Why rejected:** "complexity on demand" — no demonstrable need yet. It stays the documented
  escape hatch if cold start or memory ever becomes a real problem.

### Alternative C (rejected): keep `tsx` in `devDependencies` and install all dependencies in the image
- **Pros:** No `package.json` reclassification.
- **Cons:** Ships `vitest`, `prettier`, `typescript` and the whole dev toolchain into the
  production image — a larger image and a larger attack surface, to preserve a label that is
  factually wrong.
- **Why rejected:** the classification should describe reality; `tsx` *is* the runtime here.

### Alternative D (accepted): App Platform + Dockerfile + `tsx` as a runtime dependency
- **Pros:** One hosting model across xcale; reproducible builds; no new pipeline; smallest viable
  cost; secrets stay in Doppler.
- **Cons:** Transpilation happens at boot; `tsx`/`esbuild` live in the production image.

## Consequences

- Production = `main`. A merge to `main` deploys; there is no separate deploy action.
- `npm start` is the same command locally and in the container — no "works on my machine" gap.
- Adding an environment variable is a spec change (`.do/app.yaml`) *and* a Doppler change, both
  reviewable.
- `basic-xxs` has no rolling deploy: a release causes a brief restart. Acceptable while the server
  is not yet on a customer-facing critical path; revisit with the sizing trigger above.
