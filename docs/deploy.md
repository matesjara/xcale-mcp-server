# Deploy — DigitalOcean App Platform

Operational runbook. The *why* behind these choices is in
[`docs/adr/deployment-runtime-and-hosting.md`](adr/deployment-runtime-and-hosting.md).

## What runs where

| | |
|:--|:--|
| Platform | DigitalOcean App Platform (project **XCALE**, region `nyc`) |
| App | `xcale-mcp-server` — one Docker service, `basic-xxs`, 1 instance |
| Source | GitHub `matesjara/xcale-mcp-server`, branch **`main`**, `deploy_on_push: true` |
| Image | `Dockerfile` (repo root) — `node:22-alpine`, `npm ci --omit=dev`, `node --import tsx src/server.ts` |
| Health | `GET /health` (public, no auth) |
| Spec | [`.do/app.yaml`](../.do/app.yaml) — versioned source of truth |
| Secrets | Doppler `xcale-mcp-server` / `prd` |

**Production is `main`.** Merging the release PR (`dev` → `main`) *is* the deploy — there is no
separate action.

## Prerequisites

- `doctl` authenticated (`doctl auth list`), `doppler` authenticated, `envsubst` (gettext).
- DigitalOcean's GitHub app must have access to `matesjara/xcale-mcp-server` (authorize it once in
  the DO dashboard: **Settings → GitHub** / on first app creation).

## Applying the spec

The committed spec keeps `MCP_SERVER_SECRET` as a `${MCP_SERVER_SECRET}` placeholder. It is
rendered from Doppler and **streamed to `doctl` over stdin — never written to disk.**

```bash
# Create the app (first time only).
doppler run --project xcale-mcp-server --config prd -- \
  sh -c "envsubst '\${MCP_SERVER_SECRET}' < .do/app.yaml" \
  | doctl apps create --spec - --project-id 875c7db9-d9be-4cfa-87fd-bfc8062ae9a3 --wait
```

```bash
# Apply a spec change (sizing, env vars, health check, …) to the existing app.
doppler run --project xcale-mcp-server --config prd -- \
  sh -c "envsubst '\${MCP_SERVER_SECRET}' < .do/app.yaml" \
  | doctl apps update "$APP_ID" --spec -
```

Rule: **every** infrastructure change goes through `.do/app.yaml` in a PR, then this command.
Editing the spec in the DO dashboard makes the repo lie — the next apply silently reverts it.

## Rotating the Hop-B secret

1. Update `MCP_SERVER_SECRET` in Doppler (`prd`).
2. Re-apply the spec (command above) — this redeploys with the new value.
3. Update the consumer (`xcale-backend`) with the same value; until both sides match, calls get
   `401 unauthorized`. Coordinate the two, or accept a short window of rejected calls.

## Verifying a deploy

```bash
APP_ID=$(doctl apps list --format ID,Spec.Name --no-header | awk '$2=="xcale-mcp-server"{print $1}')
URL=$(doctl apps get "$APP_ID" --format DefaultIngress --no-header)

curl -s "$URL/health"                                   # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' "$URL/discover" # 401 — Hop B is enforced

doppler run --project xcale-mcp-server --config prd -- \
  sh -c 'curl -s -H "Authorization: Bearer $MCP_SERVER_SECRET" '"$URL"'/discover' | head -c 400
```

## Operating

```bash
doctl apps logs "$APP_ID" --type run --follow      # runtime logs (build | deploy | run)
doctl apps list-deployments "$APP_ID"              # deployment history
doctl apps create-deployment "$APP_ID" --wait      # redeploy current main (no code change)
doctl apps restart "$APP_ID"                       # restart instances
```

**Rollback:** revert the offending commit on `main` (a PR, or `git revert` + push) — `main` is the
deploy trigger, so the rollback follows the same reviewed path as any other change. For an urgent
stop-the-bleeding rollback, the DO dashboard's *Deployments → Rollback* pins a previous build;
follow it immediately with the matching revert on `main`, or the next push re-deploys the bad code.

## Notes

- `basic-xxs` has no rolling deploy: expect a few seconds of restart per release.
- The server refuses to start without `MCP_SERVER_SECRET` (fatal, by design) — a missing secret
  shows up as a failed health check, not as an open, unauthenticated server.
- No custom domain yet: consumers point at the `*.ondigitalocean.app` ingress. `xcale.app` DNS is
  not managed in this DO account, so adding `mcp.xcale.app` means creating the CNAME at the
  external registrar and then adding a `domains:` block to `.do/app.yaml`.
