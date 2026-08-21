# Release Process Reference

## When to Release

Release `dev` → `main` when:

- Feature work on `dev` is complete and tested
- Manual QA against the `dev` environment passes
- No open blockers or failing type checks

## Process

### 1. Pre-flight Checks

```bash
git fetch origin main dev

# Verify dev is ahead of main
git log --oneline origin/main..origin/dev

# Check for open PRs targeting dev
gh pr list --base dev --state open
```

If `dev` has no new commits over `main`, there's nothing to release.
If there are open PRs, warn before proceeding.

### 2. Generate Changelog

List commits on `dev` not on `main`:

```bash
git log --oneline --no-merges origin/main..origin/dev
```

Group by conventional commit type:

```markdown
### Features

- feat(composio): surface connected plugins in agent tool wizard (#15)
- feat(whatsapp): embedded signup backend route (#11)

### Fixes

- fix(catalog): prevent nevatal decryption error from crashing endpoint (#10)
- fix(cors): add localhost:3370 to allowed origins (#9)

### Other

- chore: consolidate AI tooling on Claude Code (#8)
- docs: context compression + composio docs (#7)
```

**Rules:**

- Group: Features (`feat`), Fixes (`fix`), Other (everything else)
- Include PR numbers from merge commits when available
- Skip merge commits themselves
- One line per change

### 3. Create Release PR

```bash
gh pr create \
  --base main \
  --head dev \
  --title "release: promote dev to main" \
  --body "$(cat <<'EOF'
## Release Summary

Promoting `dev` → `main` for production deployment on Digital Ocean App Platform.

### Changes since last release

<generated changelog>

## Pre-release checklist
- [ ] All feature PRs merged to dev
- [ ] Type check passes (npm run typecheck)
- [ ] Format check passes (npm run format:check)
- [ ] Audit clean (npm audit --audit-level=high)
- [ ] Manual QA against dev
- [ ] No known blockers

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 4. After Merge

Once the release PR is merged to `main`:

- DO App Platform auto-deploys to production (`xcale-mcp-server`)
- `dev` and `main` are in sync
- New feature branches continue from `dev`

## Post-Hotfix Sync

If a hotfix was merged directly to `main` (bypassing `dev`), sync it back:

```bash
git checkout dev
git pull origin dev
git merge origin/main
git push origin dev
```

This prevents `dev` from diverging from production state.

## Safety

- **Never force push** `dev` or `main`
- **Never merge** the PR automatically — only create it. User merges manually.
- **Warn** if `dev` has failing type checks before creating the PR
- **Warn** if there are open PRs targeting `dev` that haven't been merged
