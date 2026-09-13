# Roadmap — moved to GitHub Issues

> **This file is a pointer.** Accepted debt and deferred work are `parked` GitHub issues — the working
> policy of the xcale repos (`.claude/rules/working-policy.md`) keeps no markdown roadmap, backlog or
> parking lot. Adding an entry here is drift, not tracking.

- **Everything deferred:** [open `parked` issues](https://github.com/matesjara/xcale-mcp-server/issues?q=is%3Aissue+is%3Aopen+label%3Aparked).
- **Accepting debt in a review:** open it as a `parked` issue in the same breath
  (`gh issue create --label parked`) with the PR it came from, the concrete risk, the fix and the
  trigger that pulls it back into scope.
- **The file as it was** until 2026-09-13 — including the closure notes ADR 0013 cites — is at
  [`7178e92`](https://github.com/matesjara/xcale-mcp-server/blob/7178e92/docs/design/roadmap.md).

## Where each entry went (2026-09-13)

| Source | Issues |
|---|---|
| Cloudbeds write-path review (#11, 2026-07-22) | #64 Core: reject an empty forwarded credential instead of calling out unauthenticated · #65 Config: require an https `CREDENTIAL_RESOLVE_URL` at boot or refuse to start · #66 Cloudbeds: make `thirdPartyIdentifier` required to close the double-book window · #67 Cloudbeds: make `modify_reservation.status` a `z.enum` instead of free text · #68 CI: implement the documented `.reveal()` grep gate · #69 Core: assert `contextDiscovery`'s tool name exists; write its ADR · #70 Core: type `ctx.metadata` as `unknown` when a provider has no `metadataSchema` · #71 Cloudbeds: stop discarding provider error bodies on HTTP failure in `unwrap` · #72 Cloudbeds: `unwrap` can throw on a non-object 200 body · #73 Core: the `api_key` materializer should throw, not silently drop extra fields · #74 Cloudbeds: parallelize sequential fan-out in composite reads and webhook removal · #75 Contract: version bump granularity hides mid-branch connect-requirement changes |
| Cloudbeds control-plane review (#19, 2026-08-06) | #74 (the sequential DELETE fan-out, folded) · #76 Cloudbeds: `classifyEnvelopeFailure`'s property-access match is knowingly coarse |
| Cloudbeds scope-coverage review (#20, 2026-08-06) | #77 Cloudbeds: rename `paymentsPath` to a surface-neutral name · #78 Cloudbeds: widen `create_email_template` cc/bcc to arrays if the spec allows it |
| Cloudbeds certification bundle (#18, 2026-08-06) | #79 Cloudbeds certification: split the ePayco annex out of the certification report |
| Siigo release follow-up (#42, 2026-08-20) | #80 Siigo: activation checklist to enable it in production |
| Siigo provider and docs wave (#33, #34, #35, 2026-08-18) | #81 Siigo: extend the traceability matrix to all 19 tools · #82 Siigo: trim `api-contract.md` section B of xcale-backend internals · #83 Siigo: add a boot-time warning for empty `SIIGO_PARTNER_ID` · #84 Siigo: read deployment config via a factory instead of module-scope `loadConfig()` · #85 Siigo: replace the placeholder monogram in `assets/siigo.svg` · #86 Siigo: gloss *Tercero* in `CONTEXT.md` |

Not migrated: the webhook-tools withdrawal (closed 2026-08-02 by `ToolDefinition.controlPlane`), the
Spanish certification journals (closed 2026-08-20, the exception is in `CLAUDE.md`), and the missing ADR
numbering script (already fixed: `scripts/number-adrs.ts`, `npm run adr:number`).
