---
name: add-provider
description: Mechanically onboard a new provider (LATAM app or any external API) into xcale-mcp-server as a thin MCP adapter. Use when the user wants to add, integrate, or wire a new provider/integration into the MCP server, or says "add provider", "integrate X", "new adapter". This is the core repeatable recipe — turning "integrate a provider" from a project into a procedure.
---

# Add a provider to xcale-mcp-server

This skill is the **mechanical recipe** for the system's reason to exist: adding a provider is a
procedure, not a bespoke engineering project. It operationalizes **Provider Self-Containment**
(principle #1) and **Consumer-Agnostic Reusability** (principle #2).

> Read `docs/architecture-review.md` §0 (the two principles + the golden rule) and `docs/onboarding.md`
> before starting. Keep adapters thin: an adapter translates the MCP contract ↔ one provider API
> and nothing else. No business logic, no token storage, no consumer-specific concepts.

## The golden rule (a reviewer will check this on your PR)

A **standard provider** PR touches **only** `src/providers/{slug}/` + tests + generic config
(secrets/env). It MUST NOT touch shared infra (`src/core/**`, `src/protocol/**`, `src/auth/**`),
public contracts, or any consumer (e.g. xcale-backend) code. If it must, stop and write an
**exceptional ADR** justifying why.

## Preconditions

- The provider's **slug** (e.g. `nevatal`) — a stable, consumer-agnostic id. Consumers discover it
  via `server/discover`; do **not** hardcode it into any consumer.
- The provider's **auth scheme** (OAuth2, API key, bearer, …). You declare it as a **non-secret**
  `ProviderAuthDescriptor`; you never store credentials. The decrypted token arrives per call via
  `ProviderCallContext.token`.
- The provider's API docs for the tools you intend to expose.

## The recipe

### 1. Scaffold the provider module

Create `src/providers/{slug}/` (or run `/scaffold-provider {slug}`):

- `manifest.ts` — `slug`, `displayName`, `category`, `schemaVersion`, `providerVersion`, and the
  `metadataSchema` (zod) for any routing metadata the adapter needs. (Lifecycle fields
  `apiVersion`/`deprecated`/`sunsetDate` are reserved — add when relevant.)
- `auth.ts` — the **non-secret** `ProviderAuthDescriptor` (adaptive: api_key → type + field
  labels; oauth2 → URLs/scopes/placement/`supportsRefresh`). **Never** put `clientId`/`clientSecret`
  here — those are the consumer's generic config (Doppler).
- `client.ts` — a thin API client (HTTP calls; applies the forwarded token; caches no secrets).
- `tools/` — one file per tool, declared with **`defineTool`/`toolFactory`**: `name`
  (`mcp_{slug}_{verb}`), `description`, and a **zod `input`** (the single source of truth — the
  JSON Schema is generated, never hand-written). **Curate at author time**: the high-signal subset.
- `errors.ts` — provider-specific error shaping on top of the shared `mapHttpStatusToErrorCode`.
- `provider.ts` — `createXProvider(deps?)` factory calling `createProvider({...})`; default instance.
- `__fixtures__/` (anonymized recorded responses) + `__tests__/` (conformance + behavior).

### 2. Implement via the canonical helpers (ADR: canonical-provider-pattern)

Use the core helpers — do **not** hand-roll a `callTool` switch or a JSON Schema:

```typescript
// metadata typed once (Explicit Context); omit if the provider needs no context
const tool = toolFactory<{ propertyID: string }>();

export const {SLUG}_TOOLS = [
  tool({
    name: 'mcp_{slug}_get_thing',
    description: '…',
    input: z.object({ id: z.string() }).strict(),       // single source of truth
    handler: async (args, ctx) => {                       // args + ctx.metadata are TYPED + validated
      const res = await requestJson(`${BASE}/thing/${args.id}`, { token: ctx.token /* egress only */ });
      // Error messages use status/code only — NEVER interpolate res.body (it may carry provider data).
      return res.ok ? ok(res.data) : err(res.errorCode, `provider error (HTTP ${res.status})`);
    },
  }),
  // list tools: use `definePaginatedList` (merges page/pageSize; returns the uniform PaginatedResult)
];

export function create{Slug}Provider(): IProvider {
  return createProvider({
    manifest: {slug}Manifest,
    auth: {slug}Auth,
    metadataSchema: z.object({ propertyID: z.string() }), // → published as contextSchema
    tools: {SLUG}_TOOLS,
  });
}
export const {slug}Provider = create{Slug}Provider();
```

- The dispatcher validates `ctx.metadata` and `args` **before** the handler (typed); unknown tool →
  `UNKNOWN_TOOL`, invalid → `INVALID_INPUT` — you don't write these.
- `ctx.token` is a `SecretString` — `requestJson` applies it at egress; call `.reveal()` **only** at
  the provider egress, never log it.
- `ctx.metadata` carries opaque, provider-scoped routing data (e.g. `accountKey`, `storeId`),
  validated against your `metadataSchema`. **No consumer-domain identity** (no tenant/plan).

### 3. Normalize errors (non-negotiable)

- Provider **auth failure (401/403)** → `ToolResult` with `kind:'error'`, `code:'PROVIDER_AUTH_EXPIRED'`
  so the consumer can trigger re-auth (xcale's Rail A calls `markConnectionAuthFailure()`). Must be
  distinguishable from a generic error.
- Other provider errors → a typed error result with a useful message. Never swallow.

### 4. Register the provider (one line)

Add it to the explicit provider list — no auto-discovery. This lives in `src/providers/index.ts`
(NOT `src/core/**`), so registration honors the golden rule (provider PRs touch only
`src/providers/**`). The core's `createRegistry()` consumes this list by dependency inversion.

```typescript
// src/providers/index.ts
export const PROVIDERS: readonly IProvider[] = [
  echoProvider,
  {slug}Provider,   // ← this line
];
```

The catalog (`server/discover`) is derived from this list automatically — the provider becomes
**discoverable** with no further wiring.

### 5. Generic config only (no consumer code)

If the provider uses OAuth, register its `clientId`/`clientSecret` as **secrets** (e.g. in the
consumer's Doppler). That is the **only** permitted consumer-side touch — generic config, not code.
The consumer (xcale-backend, or any other) discovers the provider + its `authDescriptor` via
`server/discover` and runs the auth flow **generically**. Do **not** add a per-provider entry in
consumer code.

### 6. Prove the round trip

- `server/discover` lists the provider with its `authDescriptor` + `schemaVersion`.
- `tools/list` returns the declared tools.
- `tools/call` executes one tool end-to-end with a real (or sandbox) token.
- A forced 401 returns the typed `PROVIDER_AUTH_EXPIRED` result, not an opaque error.

## Definition of done

- [ ] `src/providers/{slug}/` implements `IProvider`; adapter contains **no** business logic and
      **no** consumer-specific concepts.
- [ ] `ProviderAuthDescriptor` declared (non-secret); secrets only as generic config.
- [ ] Tools namespaced `mcp_{slug}_{verb}` with valid zod/JSON-Schema inputs; curated subset.
- [ ] Auth failures map to `PROVIDER_AUTH_EXPIRED`; other errors typed, never swallowed.
- [ ] Provider added to the explicit `PROVIDERS` registry (one line); discoverable via catalog.
- [ ] `server/discover` + `tools/list` + `tools/call` round trip proven (incl. the 401 path).
- [ ] **Golden rule held**: no shared-infra / public-contract / consumer-code changes (or an ADR).
- [ ] No raw token persisted, cached, or logged; `.reveal()` only at egress.

## Anti-patterns (reject these)

- ❌ Storing/caching/logging the forwarded token; calling `.reveal()` outside the egress.
- ❌ Business rules, or **consumer-specific concepts** (tenant/plan/xcale entities) in the adapter
  or on the wire.
- ❌ Hardcoding the provider into consumer code (it must be **discovered** via the catalog).
- ❌ Putting secrets in the `authDescriptor`.
- ❌ Auto-discovering providers by scanning the filesystem; sharing mutable state between providers.
- ❌ Dumping every provider endpoint as a tool — curate to a high-signal subset.
