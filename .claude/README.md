# `.claude/` — Agent toolset for xcale-mcp-server

This folder makes the project **self-contained** when opened on its own in the editor: the
full set of Claude skills, agents, rules, and commands needed to **design, build, document,
and iterate** on this MCP server — without exposing the rest of `xcale-proyect`.

The skills and agents below are shared with `xcale-backend` (same org, same conventions, same
identity philosophy). They were brought in so the toolset travels with the repo. Process and
design skills are **portable as-is**; a few build/QA skills reference the backend's runtime and
need light adaptation (flagged ⚙️ below) before they fully apply here.

> **Identity:** the xcale layer's `.claude/rules/xcale-mcp-server-soul.md` (this repo's identity — loaded when a session works with a file in this repo).
> **Founding pillar:** `../docs/foundation.md` (read first).

---

## Skills, grouped by purpose

### 🎯 Design & align (before building)

`grill`, `feature-design`, `api-contract-authoring` (here the contract is the **MCP boundary**: `tools/list` + `tools/call`, schemas, error shapes), `implementation-plan` and `adr` live in the [xcale layer](https://github.com/matesjara/xcale-harness/tree/main/.claude/skills) since its step 3.3.4 — one version for every xcale repo, with a `references/xcale-mcp-server.md` for what differs here. So does the `architect` agent, which absorbed this repo's `mcp-architect`.

The engineering discipline — `git-workflow`, `tdd`, `diagnose`, `improve-architecture`, `creating-skills`, and the `debugger` and `prod-debugger` agents — lives there too since its step 3.3.5, each with a reference for this repo (the `prod-debugger` one names this server's own app; the copies that lived here pointed at the backend).

### 🔨 Build

| Skill | Use it to | Status |
|:--|:--|:--|
| **api-integration** | Implement an outbound provider integration (Sandwich: Tool → UseCase → Repository → API Client). Directly relevant to **provider adapters** — pairs with `add-provider`. | ⚙️ adapt — written for Fastify modules; the *pattern* applies, the file layout maps to `src/providers/{slug}/`. |

### 🔌 Project-specific (built for this repo)

| Skill | Use it to | Status |
|:--|:--|:--|
| **add-provider** | The **mechanical recipe** to onboard a new provider as a thin MCP adapter — the system's core leverage (`foundation.md` §9). | ✅ native to this repo |

### 🔍 Review & QA

| Skill | Use it to | Status |
|:--|:--|:--|
| **agentic-ship** | Build a scoped change in an isolated worktree, run it past three independent gate agents, auto-merge to `dev`. The human gate stays at `dev → main`. | ✅ native to this repo (ported from `xcale-backend`, with its three gates re-decided here) |
| **qa** | Run QA suites + the post-implementation reconcile-to-zero-blockers loop. | ⚙️ adapt — references the backend dev server (curl) + the `quala` (Playwright/UI) subagent that don't exist here. The reconcile-loop method is reusable; the suite machinery needs an MCP-server target (e.g. JSON-RPC scenarios against the `/mcp` endpoint). |

### 📝 Document & iterate with the agent

| Skill | Use it to | Status |
|:--|:--|:--|
| **mintlify-documentation** | Build/maintain a Mintlify docs site if/when this server gets public docs. | ✅ portable (optional) |

---

## Agents (`agents/`)

| Agent | Role | Notes |
|:--|:--|:--|
| **code-reviewer** | The **inward** gate: credential boundary first, then correctness and the architecture invariants. | rewritten for this repo 2026-08-23 — it was the backend's file (Mongo, use cases, i18n, soft delete) and judged invariants this repo does not have |
| **pr-reviewer** | The **outward** gate: scope, fidelity to what was asked, honesty of the PR body against the diff, hygiene. | native to this repo |
| **mcp-contract-qa** | The **contract** gate: executed `discover`/`tools\|list`/`tools\|call` round trip, agent-fitness of the published tools, additive-only evolution, credential boundary at egress. | native to this repo — the third gate of `/agentic-ship` |
| **api-qa** | Executes curl/HTTP test scenarios against a backend dev server. | ⚠️ **not used here** — it is `xcale-backend`'s file verbatim (JWT login, Mongo, `{success,data,error}`). It is **not** an `/agentic-ship` gate; `mcp-contract-qa` covers this surface instead. See `agentic-ship/SKILL.md` § 1 |

---

## Commands (`commands/`)

| Command | Does |
|:--|:--|
| **/scaffold-provider `<slug>`** | Generates the `src/providers/{slug}/` skeleton per the `add-provider` recipe. |

---

## Recommended lifecycle for this project

```
grill ─▶ feature-design ─▶ api-contract-authoring ─▶ implementation-plan ─▶ tdd / add-provider ─▶ code-reviewer ─▶ git-workflow
  │                                                                                                                    │
  └────────────────────── adr (whenever a durable decision is locked) ──────────────────────────────────────────────┘
```

Or, fully autonomously — `/agentic-ship` runs the build and the gates and merges to `dev` itself:

```
worktree from dev ─▶ implementer subagent ─▶ PR ─▶ code-reviewer ┐
                                                  pr-reviewer    ├─▶ all pass + CI green ─▶ merge to dev
                                                  mcp-contract-qa┘        any blocked ─▶ escalate
```

## Not yet present (recommended next seeds)

These files several skills lean on don't exist here yet — create them when you start the design
phase (grill/feature-design will help populate them):

- **`CONTEXT.md`** at the repo root — the domain glossary (seed it from `foundation.md` §17).
  `grill` and `feature-design` read and update it.
- **`CLAUDE.md`** at the repo root — project facts (stack, ports, conventions) once the stack
  is locked (`foundation.md` Q-6).
- **`docs/adr/`** — created by the first `adr` invocation.
