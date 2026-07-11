---
name: api-contract-authoring
description: Creates comprehensive API contract documents before implementation. Use when the user wants to define a new feature/module's API surface, plan endpoints, DTOs, and frontend integration guidance BEFORE writing backend or frontend code. Designed for contract-first development in the agentic programming age.
---

# API Contract Authoring

## Purpose

This skill standardizes the creation of **contract-first API documents** — the single source of truth that drives both backend implementation and frontend consumption. An API contract is written **BEFORE** any code, enabling:

1. **Parallel Development** — Frontend and backend teams work simultaneously from the same spec.
2. **AI Agent Readability** — Structured, unambiguous contracts that AI coding agents can parse and implement without asking clarifying questions.
3. **Validation Before Code** — Catch design flaws, missing fields, and edge cases at the document level.
4. **Living Documentation** — Contracts evolve with the module and remain the authoritative reference.

## When to Use

- The user says "create an API contract", "define the API", or "plan the endpoints" for a new feature.
- The user wants to write the specification before implementing.
- A Feature Design (PRD) exists and the next step is to translate requirements into an API surface.

## Pre-Requisites

Before writing a contract, gather:

1. **Feature Design** — `docs/design/<slug>/feature-design.md` should already exist. The contract lands in the **same** folder. (If no feature design exists, run `/feature-design` first.)
2. **Backend Architecture Context** — Read `docs/architecture-guide.md` for Clean Architecture patterns, module structure, and conventions.
3. **Existing Modules** — Check `src/modules/` for related modules that this feature may interact with.
4. **AI Agent Tools** — Does this module expose AI Agent tools? Check `src/modules/agent/tools/` for patterns.
5. **Relevant ADRs** — Skim `docs/adr/` for architectural decisions this contract must honor (e.g. ADR-0001 on the V2 Agent invariant).

## Workflow

### Step 1: Research & Context Gathering

1. Read the feature design (`docs/design/<slug>/feature-design.md`) provided by the user.
2. Read `docs/architecture-guide.md` to refresh on patterns.
3. Skim `docs/adr/` for relevant architectural decisions.
4. Check in-flight contracts in `docs/design/*/api-contract.md` and archived ones in `docs/archive/*/<slug>/api-contract.md` for style consistency. (Legacy contracts in `docs/api/`, `docs/api_contracts/`, `docs/api-contracts/` are pre-lifecycle — read for reference only; do not save new contracts there.)
5. Identify all **entities**, **relationships**, and **user workflows** from the feature design.

### Step 2: Design the API Surface

Apply these design principles (from the template below):

1. **Resource-Oriented Design** — URLs represent resources (nouns), HTTP methods represent actions.
2. **Consistent Base Path** — Always `/api/v1/<module>`.
3. **RESTful Conventions** — `GET /` (list), `GET /:id` (detail), `POST /` (create), `PATCH /:id` (update), `DELETE /:id` (delete).
4. **Batch Operations** — If the PRD mentions bulk actions, add `POST /batch`.
5. **Status Transitions** — Use `PATCH /:id/<action>` for state machine transitions (e.g., `PATCH /:id/activate`).

### Step 3: Write the Contract

Use the **template** in [api-contract-template.md](templates/api-contract-template.md). Fill in every section. Follow the rules below.

### Step 4: Review Checklist

Run through the [checklist.md](checklist.md) before finalizing.

---

## Golden Rules for Contract Authoring

### 🔬 Evidence Before Contract (foundational)

> **An API contract describes only observed behavior of the real target system.** Documentation, SDKs,
> and examples prepare the verification but never substitute for evidence obtained by executing against
> the target environment.

When integrating an external provider whose surface is uncertain (multiple API "flavors", docs that lag
the live API), verify each concrete value — URLs, field names, headers, response shapes, provider error
codes — against a real sandbox/test call **before** it enters the contract. This is the contract-level
twin of the feature-design's "no new architecture" guardrail: **the contract introduces no assumptions.**

#### Evidence Before Contract (extended) — deferral over provisional

> **When primary provider wire semantics are unavailable, the API Contract is *deferred*, not written
> provisionally.** No wire contract is frozen from recollection or secondary sources. An un-inspectable
> vendor docs SPA is itself *evidence of an evidence-availability constraint*, not a reason to guess.

The Feature Design may carry controlled uncertainty (an open question like "confirm field names against
official docs"); the API Contract **cannot freeze unverified provider wire semantics** — it is the
two-sided source of truth. (It *may* enumerate provider-defined uncertainty — "MAY return one of these
values"; it may **not** say "confirmed later".) A contract with internal `TODO`/`pending` wire markers
fails at its one job and becomes documentation debt.

**Conditional artifact — `api-contract-preflight.md`.** *Only* when architectural decisions are already
closed (Feature Design approved) but primary provider evidence is *temporarily* unavailable, author a
short `docs/design/<slug>/api-contract-preflight.md` that separates **verified wire facts** from
**pending wire evidence** and names the exact evidence that lifts the deferral (a live sandbox or the
rendered official reference). It does **not** re-justify architecture (that is the Feature Design's job —
reference it, don't restate it). When the evidence arrives: verify each pending item → write
`api-contract.md` with only observed values (**authored only after primary evidence is complete**) →
retire the preflight. **Create the preflight only when the wait for primary evidence is expected to
outlive the current design cycle** — not for a transient docs outage. It is not a mandatory pipeline step
and does not appear for features whose provider surface is already observable.

### 🏗️ Architecture Alignment

| Rule | Why |
|:---|:---|
| **ALWAYS** use `/api/v1/` prefix | Project-wide convention |
| **ALWAYS** specify Auth + Permission per endpoint | Frontend needs this for route guards |
| **ALWAYS** follow Clean Architecture module pattern | `entities.ts → repository.ts → usecases/ → controller.ts → routes.ts` |
| **NEVER** omit error response examples | Frontend needs error handling patterns |

### 🎨 Frontend Integration Alignment

| Rule | Why |
|:---|:---|
| **ALWAYS** include i18n display rules | Backend messages are pre-localized via `Accept-Language` — never double-translate |
| **ALWAYS** specify frontend file paths for types and hooks | Agents need exact target locations |
| **ALWAYS** reference the standard response envelope | `{ success: boolean, data?: any, error?: string }` |

### 🤖 Agentic-Ready Design (Machine-First Documentation)

These rules ensure AI coding agents can implement directly from the contract:

| Rule | Why |
|:---|:---|
| **Every field MUST have an explicit type** | No `any`, no "see above". Agents need unambiguous types. |
| **Every optional field MUST use `?` suffix** | Agents distinguish required vs optional from the interface. |
| **Every enum MUST list all values inline** | Don't reference external files. Agents need the values in context. |
| **Mock data MUST cover 3+ scenarios** | Success, validation error, not found. Agents validate their output against mocks. |
| **Date formats MUST specify ISO 8601 with a comment** | Prevents timezone confusion. |
| **Query params MUST specify defaults** | Agents should generate correct default handling. |
| **Status codes MUST be explicit per endpoint** | Don't say "standard codes". List them: `201`, `400`, `404`, `409`. |
| **Validation rules MUST be inline with the DTO** | Don't separate validation from schema definition. |
| **Use semantic headers and tables** | Agents parse markdown structure. Tables > prose. |
| **Include the entity state machine** | Agents need to understand lifecycle transitions. |

### 📋 Contract Completeness

A contract is **incomplete** if it's missing any of these sections:

1. ☐ Module metadata (name, base path, last updated)
2. ☐ Implementation status tracker
3. ☐ Endpoint table with ALL columns filled
4. ☐ TypeScript interfaces for ALL entities
5. ☐ TypeScript interfaces for ALL request DTOs
6. ☐ TypeScript interfaces for ALL response DTOs (including wrappers)
7. ☐ Query parameter interfaces with defaults
8. ☐ Frontend hooks specification (if applicable)
9. ☐ Mock data for primary endpoints (min 3 scenarios)
10. ☐ Error response examples
11. ☐ State transition diagram (if applicable)
12. ☐ Agent Tool specification (if this module exposes tools)
13. ☐ Upcoming phases / roadmap section

---

## File Naming Convention

- **Location**: `docs/design/<slug>/api-contract.md` — same folder as the feature design.
- **Slug**: matches the feature design folder. The file is **always** `api-contract.md` (do not invent variants).
- **Examples**: `docs/design/scheduler/api-contract.md`, `docs/design/concierge-onboarding/api-contract.md`.
- **Phased modules**: use one folder per phase so each phase ships and archives independently. E.g. `docs/design/billing-v2-phase1/`, `docs/design/billing-v2-phase2/`.
- **Lifecycle**: this file lives in `docs/design/` only while in flight. At Release (dev→main), after the prod soak window, the `/git-workflow` Release step (reference: `.claude/skills/git-workflow/references/promote-docs.md`) moves the entire folder to `docs/archive/<year>-q<N>/<slug>/`. See `docs/README.md`.

> **NEVER** save new contracts to `docs/api/`, `docs/api_contracts/`, `docs/api-contracts/`, or the `docs/` root. Those are pre-lifecycle legacy locations.

---

## Quick Reference: Section Descriptions

| Section | Purpose | Primary Audience |
|:---|:---|:---|
| **1. API Contract** | Endpoint table, base URL, permissions | Backend & Frontend |
| **2. TypeScript Interfaces** | Enums, Entities, Request/Response DTOs | Frontend (copy-paste ready) |
| **3. Frontend Hooks** | Key factory, hook names, invalidation | Frontend |
| **4. Agent Tool Specification** | Tool definitions for AI agents | Backend (agent module) |
| **5. Mock Data** | JSON examples per endpoint | Frontend (dev mode) |
| **6. Error Reference** | Error codes, messages, UX suggestions | Frontend |
| **7. Roadmap** | Upcoming phases and their API impact | Both |

---

## See Also

- **Template**: [api-contract-template.md](templates/api-contract-template.md) — The fill-in-the-blanks template.
- **Checklist**: [checklist.md](checklist.md) — Pre-publish review checklist.
- **Agentic Best Practices**: [agentic-best-practices.md](examples/agentic-best-practices.md) — Deep dive on agent-optimized contracts.
- **Style Guide**: [style-guide.md](examples/style-guide.md) — Formatting and naming conventions.
- **Docs Lifecycle**: `docs/README.md` — The full design→archive flow and how the four lifecycle skills (`/feature-design`, `/api-contract-authoring`, `/implementation-plan`, `/adr`) hand off; archival is a `/git-workflow` Release step, not its own skill.
- **Backend Architecture**: `docs/architecture-guide.md` — Backend patterns and conventions.
- **ADRs**: `docs/adr/` — Durable architectural decisions any new contract must honor.
- **Feature Design Skill**: `.claude/skills/feature-design/` — The upstream skill that produces the companion `feature-design.md`.
- **Archival (Release step)**: `.claude/skills/git-workflow/references/promote-docs.md` — Closes the lifecycle at Release (dev→main), after the prod soak window, by archiving the design folder.
