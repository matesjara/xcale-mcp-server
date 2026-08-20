---
name: working-with-mateo
description: How to communicate and collaborate with Mateo (matesjara, CEO and release owner) — top-down reporting (outcome → decisions → confidence), decision-surfacing rules, and altitude discipline. Auto-loaded at session start via the CLAUDE.md import; applies to every report, briefing, status update, and question directed at him.
---

# Working with Mateo

Mateo is a bootstrapped founder; this MCP platform is one of several fronts he runs. He reads
conversations on the move, often on a phone. He reads the briefing, not the diff — everything
technical is already recorded in PRs, ADRs and docs; the conversation is for **what happened,
what it means, and what only he can decide**. This skill operationalizes CLAUDE.md's
"Communication — how to answer in chat"; where the two seem to disagree, CLAUDE.md wins.

## The report structure

Every report, briefing or status update follows this shape, in this order, in Spanish, within
CLAUDE.md's ceiling (~12 lines; ~18 for a release/PR briefing):

1. **Headline** — one or two sentences: what happened and what it means for him. If he reads
   nothing else, this must be enough.
2. **Decisions he must make** — the closing `**Decisiones:**` numbered block (CLAUDE.md),
   clearly separated from the narrative, blocking first, no-rush second. Each one carries:
   - the decision in plain language ("¿oficializamos los journals en español o los
     traducimos?" — never "decide el carve-out de la regla de idioma");
   - the PR / ADR / roadmap-entry **title** (plus number), never a bare number;
   - **Rec:** the recommendation — options without a stance are unfinished work;
   - one line on what changes when he answers, when it isn't obvious.
3. **Confidence and risk signals** — did the gates work, did something get caught, what is the
   honest state of what shipped. Never hide a control that fired on our own work — that signal
   is the product.
4. **Nothing else.** File lists, per-gate states, command outputs — only if he asks.

## Altitude rules

- **Meaning before mechanism.** Open with what the change does for the platform or the release,
  never with the code that does it. Identifiers, paths and commands are quoted (in English) only
  when he would act on them.
- **Depth is pull, not push.** Close with where the detail lives ("el detalle está en el PR
  *tal*") and zoom in when he asks. Opening at the bottom is never right.
- **Numbers only when they carry the decision or the confidence.** "250/250 verdes, 0 vulns"
  earns its place; an inventory of every gate that passed does not.
- **Money is always explicit** — amount and currency (COP or USD); spend decisions are his.

## Surfacing decisions

- Only bring him decisions that are genuinely his: releases, spend, vendors, public-contract
  posture, convention exceptions — anything CLAUDE.md or the git-workflow skill pins on the
  release owner. Implementation choices are delegated — do not ask about them and do not
  narrate them.
- **Blocking vs. no-rush, always labeled.** He should see in two seconds whether work is
  waiting on him.
- A decision that must survive the conversation gets parked in an artifact
  (`docs/design/roadmap.md`, an ADR, a PR body); the conversation carries the ask, the artifact
  carries the record.

## Example — the same PR-review update at the wrong and right altitude

**Wrong** (what actually got sent once, trimmed):

> El review del #34 llegó: 1 Blocker (ship-log con estado obsoleto: "Nothing committed/pushed
> yet", base `integration/all-20260812`) y Majors arreglables… `contextDiscovery` hoy es un
> objeto único `{ key, tool, resultPath }` (`src/core/provider-port.ts:99-106`), así que una
> segunda clave exige reformarlo a multi-entrada… [ten more lines of per-finding mechanics]

**Right:**

> **Los 3 PRs de Juan están revisados, corregidos y mezclados en `dev`.** El del provider traía
> un Blocker real — sus tools de listado rompían el contrato uniforme del catálogo — corregido
> in-branch antes de mezclar. Gates verdes, 250/250; la deuda aceptada quedó en el roadmap.
>
> **Decisiones:**
> 1. **Sin afán** — journals de certificación en español vs la regla English-only — **Rec:**
>    documentar la excepción en CLAUDE.md.

## Anti-patterns

- ❌ Opening with mechanism instead of meaning
- ❌ Bare PR/issue numbers without titles
- ❌ Asking him implementation questions, or permission for reversible delegated work
- ❌ Numbers that don't change a decision or carry confidence
- ❌ Burying a decision he must make inside a narrative paragraph
- ❌ Hiding that a gate fired on our own work
