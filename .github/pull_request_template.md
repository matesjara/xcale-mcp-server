<!-- xcale-mcp-server PR template. Delete sections that don't apply. -->

## What & why

<!-- One or two sentences. Link the design/ADR if relevant. -->

## Provider PR? — the Provider Self-Containment golden rule

If this PR adds or changes a **standard provider**, confirm it touches **only**:

- [ ] `src/providers/{slug}/` — descriptor, client, tools, validations (zod), error mapping
- [ ] Tests — unit + a conformance test (`tools/list`/`tools/call` round trip, incl. the auth-failure path)
- [ ] One line in `src/providers/index.ts`; its logo `assets/{slug}.svg` or `.webp`
- [ ] For a deployment value, one **optional** field in `src/config.ts` + its `.env.example` entry, where applicable
- [ ] Its own docs — `docs/design/<slug>…/**`, an ADR in `docs/adr/` with its README line
- [ ] Each tool that returns or changes a person's records declares its `identityPolicy` (ADR 0019)
- [ ] The consumer's registration data (xcale-backend) is asked for in a consumer issue, linked here

And does **NOT** touch (for a standard provider):

- [ ] shared infra (`src/core/**` and its shared tests, `src/protocol/**`, `src/auth/**`), dependencies
- [ ] public contracts (the three pillars, error codes, descriptor/context shapes)
- [ ] any consumer (e.g. xcale-backend) code

> If any forbidden box had to be ticked, link the **exceptional ADR** that justifies it:
> `docs/adr/<slug>.md`.

## Consumer-agnostic & security checks

- [ ] No consumer-specific concepts on the wire (no tenant/plan/xcale entities in public contracts)
- [ ] **Litmus test:** a third party could use this server without knowing xcale-backend exists
- [ ] No business logic added to the server
- [ ] No raw token persisted, cached, or logged; `SecretString.reveal()` only at provider egress
- [ ] Contract changes (if any) are **additive**; `schemaVersion`/`providerVersion` bumped if needed

## Notes

<!-- Anything reviewers should know. -->
