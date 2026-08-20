# Commit Conventions Reference

## Format

```
<type>(<scope>): <description>

[optional body]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

## Types

| Type       | Purpose                          | Example                                                          |
| ---------- | -------------------------------- | ---------------------------------------------------------------- |
| `feat`     | New feature                      | `feat(composio): surface connected plugins in agent tool wizard` |
| `fix`      | Bug fix                          | `fix(composio): look up auth config ID dynamically`              |
| `docs`     | Documentation                    | `docs: update architecture guide`                                |
| `style`    | Formatting (no logic)            | `style(modules): fix inconsistent indentation`                   |
| `refactor` | Restructure (no behavior change) | `refactor(integrations): extract bulk status helper`             |
| `perf`     | Performance                      | `perf(agent): cache tool registry per request`                   |
| `test`     | Tests                            | `test(whatsapp): add vitest for token exchange`                  |
| `chore`    | Maintenance                      | `chore: clean up IDE configs`                                    |
| `build`    | Build system                     | `build: bump fastify to 5.x`                                     |
| `ci`       | CI/CD                            | `ci: add type-check step to PR workflow`                         |

## Scopes

Prefer backend module scopes that match `src/modules/`:

`agent`, `agent-collaboration`, `agent-db`, `agent-templates`, `billing`, `catalog`, `chat`, `composio`, `crm`, `escalation`, `goals`, `gsc`, `instagram`, `integrations`, `knowledge`, `nevatal`, `payments`, `plans`, `sanity`, `scheduler`, `shopify`, `subscriptions`, `tasks`, `user-agent-config`, `whatsapp`, `wordpress`

Cross-cutting: `auth`, `i18n`, `infra`, `db`, `config`, `deps`, `cors`, `build`, `ci`, `tools`

## Rules

- **Imperative mood**: "add" not "added", "fix" not "fixed"
- **Lowercase description**: `add analytics endpoint` not `Add Analytics Endpoint`
- **Under 72 chars**: for the first line (type + scope + description)
- **Scope**: module or feature area (see above)
- **Body** (optional): explain _why_, not _what_. The diff shows what changed.
- **Co-Authored-By**: always include when Claude assisted

## HEREDOC format

Always use HEREDOC to prevent shell escaping issues:

```bash
git commit -m "$(cat <<'EOF'
feat(composio): surface connected plugins in agent tool wizard

Emit one ToolGroupDTO per connected Composio plugin from
GET /user-agent-config/tool-groups so users can assign
those tools when creating or editing an agent. Tool names
match the format ComposioToolLoader generates at runtime.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Staging Rules

- **Never** use `git add .` or `git add -A` — prevents accidental secret/binary inclusion
- **Always** stage specific files by name
- **Verify** with `git diff --cached --stat` before committing
- **Split** unrelated changes into separate commits
- **Scan** for `.env`, `.env.local`, credentials, API keys, Doppler tokens — warn and exclude

## Safety

- **Pre-commit type check**: `npm run typecheck` must pass. STOP if it fails.
- **Pre-commit format**: `npm run format:check` must pass. STOP if it fails.
- **Pre-commit tests**: `npm test` must pass. STOP if it fails.
- **No amending**: Create new commits. Amending can destroy previous work.
- **No force push**: Never to `main` or `dev`.
- **No hook skipping**: Never `--no-verify`. Prettier runs as a hook on every edit — if it fails, fix the root cause.
- **Hook failure**: Fix the issue, re-stage, create a NEW commit (don't amend).
- **No auto-merge**: Ship creates the PR. User authorizes merging explicitly.
