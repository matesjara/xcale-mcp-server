# Architecture Decision Records — index & policy

ADRs capture **why** structural choices were made. They are durable and outlive feature designs.
Full rationale, alternatives, and the responsibility split live in `docs/architecture-review.md`.

## Policy — keep ADRs stable and infrequent

- ADRs are **stable and few.** They record **structural decisions and long-term principles only**.
- **Everyday implementation decisions do NOT get an ADR** — they live in code, feature designs, or
  commit history.
- **Create or modify an ADR only when a structural decision or a long-term principle changes.**
  Prefer **superseding** an old ADR (status `Superseded by …`) over editing its decision in place.
- House convention: created unnumbered (`<slug>.md`, `# ADR: …`); the number is minted at merge
  against `dev`. See `.claude/skills/adr/SKILL.md`.

## Index

| ADR | Status | Locks |
|:--|:--|:--|
| [consumer-agnostic-contract](consumer-agnostic-contract.md) | Accepted | Public contract reusable beyond xcale (principle #2) |
| [three-pillar-mcp-contract-with-discovery](three-pillar-mcp-contract-with-discovery.md) | Accepted | `server/discover` as the discovery pillar |
| [provider-knowledge-vs-credential-custody](provider-knowledge-vs-credential-custody.md) | Accepted | Knowledge → server, custody → Rail A; adaptive `authDescriptor` |
| [stateless-gateway-and-thin-acl](stateless-gateway-and-thin-acl.md) | Accepted | Stateless Streamable HTTP, single gateway, thin ACL |
| [typed-tool-result-error-contract](typed-tool-result-error-contract.md) | Accepted | Discriminated-union result + closed error codes |
| [additive-contract-versioning](additive-contract-versioning.md) | Accepted | Additive evolution; `schemaVersion`; provider lifecycle; catalog stability policy |
| [credential-forwarding-and-token-model](credential-forwarding-and-token-model.md) | Accepted (scope-bounded) | Token model; ephemeral references before financial providers |
| [credential-delivery-strategies](credential-delivery-strategies.md) | Accepted | `forwarded`\|`reference` strategies; credential-resolution phase; Hop-B reference resolution; `credential_exchange` descriptor variant |
| [typescript-strictness-config](typescript-strictness-config.md) | Accepted | Full strict minus exactOptionalPropertyTypes (MCP SDK type incompatibility); revisit trigger |
| [deployment-runtime-and-hosting](deployment-runtime-and-hosting.md) | Accepted | DO App Platform + Dockerfile; `tsx` as the production runtime (no build step); Doppler-rendered spec |
| [canonical-provider-pattern](canonical-provider-pattern.md) | Accepted | Reference adapter pattern: single-source schemas + typed handlers, explicit pagination, explicit context, fidelity-over-unification, share-policies-not-assumptions, DI+fixtures+conformance |
| [tool-derived-oauth-scopes](tool-derived-oauth-scopes.md) | Accepted | An oauth2 provider's `scopes` is the union of its tools' `requiredScopes` — never hand-written; guard vs the app registration |
| [control-plane-tools](control-plane-tools.md) | Accepted | `controlPlane` flag + `routableToolNames()`: menu ≠ router; control-plane tools callable but undiscoverable (documented exception; additive discovery later) |
| [supply-chain-audit-gate](supply-chain-audit-gate.md) | Accepted | `npm audit` covers the **full** tree (never `--omit=dev`), blocking at `high`, split into prod/full steps; `overrides` over `npm audit fix` |
