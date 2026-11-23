# Ship Log — cadenax-provider

- **Status:** on-dev
- **Released to prod:** not yet
- **Related:** feature-design.md · implementation-plan.md · no api-contract.md until the first observed calls

## Build notes & deviations

- Built against shapes read from Cadenax's source, tests and OpenAPI (`CofinetCol/cofinet-backend` `main` at `bf7ce56`); no key existed, so nothing was called and the fixtures are not recordings (`src/providers/cadenax/__fixtures__/README.md`).
- A paginated search drops an unknown argument instead of refusing it: `definePaginatedList` merges the pagination input and the merged schema is not strict. The office still comes only from the connection; the tests assert the request.
- No logo: Cadenax's mark has not been supplied, so `logoUrl` is omitted.

## Ship Log

### Migrations

- N/A (stateless server, no migration)

### Manual UI / QA (dev period)

- 2026-11-23 `scripts/contract-probe.mjs --provider cadenax` (offline): catalog entry and 11 published tools; the two control-plane tools absent from `tools/list`. Adjustment: none.
- ⬜ pending — first observed calls with a development key: every read through the probe with `--live`, fixtures recorded, the provider corrected where the wire differs, `api-contract.md` written · matesjara/xcale-mcp-server#232 (first observed calls with a development key)

### Feature flags / config

- `CADENAX_BASE_URL` — ⬜ pending on **dev** (Doppler `xcale-mcp-server/dev`): Cadenax's development or staging API, set with the first key · matesjara/xcale-mcp-server#232
- `CADENAX_BASE_URL` on **prod** — N/A (empty means production)

### Deploy verification (prod)

- [ ] `whoami` with a production key connects one office — ⬜ pending, and not before the first observed calls on dev · matesjara/xcale-mcp-server#232

## Known gaps at ship

- Write tools → `parked` issue matesjara/xcale-mcp-server#233 (Cadenax write tools)
- The sync pull → `parked` issue matesjara/xcale-mcp-server#234 (the sync cursor tool)
- An office key reads the whole client book over live REST → Cadenax's to decide, CofinetCol/cofinet-backend#787
- A key that reaches several offices cannot connect (design AD-2), so there is no cross-office agent yet
