# `.claude/` — Agent toolset for xcale-mcp-server

What is left of this repo's own Claude harness while the xcale layer (`~/Documents/Projects/xcale`,
[xcale-harness](https://github.com/matesjara/xcale-harness)) takes it over step by step: the team's skills, agents and
rules live there once, and this folder keeps only what has not moved yet — listed below, with ⚙️ where an item is
still the backend's copy.

> **Identity:** the xcale layer's `.claude/rules/xcale-mcp-server-soul.md` (this repo's identity — loaded when a session works with a file in this repo).
> **Founding pillar:** `../docs/foundation.md` (read first).

---

## Skills, grouped by purpose

### 🎯 Design & align (before building)

`grill`, `feature-design`, `api-contract-authoring` (here the contract is the **MCP boundary**: `tools/list` + `tools/call`, schemas, error shapes), `implementation-plan` and `adr` live in the [xcale layer](https://github.com/matesjara/xcale-harness/tree/main/.claude/skills) since its step 3.3.4 — one version for every xcale repo, with a `references/xcale-mcp-server.md` for what differs here. So does the `architect` agent, which absorbed this repo's `mcp-architect`.

The engineering discipline — `git-workflow`, `tdd`, `diagnose`, `improve-architecture`, `creating-skills`, and the `debugger` and `prod-debugger` agents — lives there too since its step 3.3.5, with a reference for this repo wherever it differs (the `prod-debugger` one names this server's own app; the copies that lived here pointed at the backend).

So does review, since its step 3.3.6: `/pr-review` and the three gate agents — `code-reviewer` (inward: the credential boundary first, then correctness and the architecture invariants), `pr-reviewer` (outward: scope, fidelity, the honesty of the PR body, hygiene), each with a reference for this repo, and `mcp-contract-qa` (the published surface, with executed evidence: the round trip, agent-fitness, additive evolution, the boundary at egress). The `qa` skill and the `api-qa` agent that sat here were xcale-backend's copies, running backend scenarios; they are retired — `mcp-contract-qa` and the suite cover this surface.

So does the autonomous pipeline, since its step 3.3.7: `/implement` builds a scoped change in a worktree of this repo, runs those three gates and merges into `dev` when they pass and CI `verify` is green; what differs here — reach, the protected `dev`, the ban on `--admin` — is in its [`references/xcale-mcp-server.md`](https://github.com/matesjara/xcale-harness/blob/main/.claude/skills/implement/references/xcale-mcp-server.md). The contract probe stays in this repo as a test asset: `scripts/contract-probe.mjs`.

### 🔨 Build

| Skill | Use it to | Status |
|:--|:--|:--|
| **api-integration** | Implement an outbound provider integration (Sandwich: Tool → UseCase → Repository → API Client). Directly relevant to **provider adapters** — pairs with `add-provider`. | ⚙️ adapt — written for Fastify modules; the *pattern* applies, the file layout maps to `src/providers/{slug}/`. |

### 🔌 Project-specific (built for this repo)

| Skill | Use it to | Status |
|:--|:--|:--|
| **add-provider** | The **mechanical recipe** to onboard a new provider as a thin MCP adapter — the system's core leverage (`foundation.md` §9). | ✅ native to this repo |

### 📝 Document & iterate with the agent

| Skill | Use it to | Status |
|:--|:--|:--|
| **mintlify-documentation** | Build/maintain a Mintlify docs site if/when this server gets public docs. | ✅ portable (optional) |

---

## Agents

None in this repo: its three gate agents live in the xcale layer (above).

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

Or, fully autonomously — the layer's `/implement` runs the build and the gates and merges to `dev` itself:

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
