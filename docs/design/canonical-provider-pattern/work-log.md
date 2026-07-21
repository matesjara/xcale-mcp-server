# Work Log — PR A: Canonical provider pattern (core helpers)

- **Branch:** `feat/canonical-provider-pattern` · **ADR:** `docs/adr/canonical-provider-pattern.md`
- **Purpose:** implement the platform helpers that *enforce* the grill's decisions, so PR B
  (Cloudbeds) is a thin adapter touching only `src/providers/cloudbeds/`.
- **Convention:** this log states the **Plan** up front and the **Outcome / decisions / open items**
  at the end, so we can refine the pattern *before* building the first real provider.

---

## Plan (what will be done)

1. **`src/core/tool.ts`** — `defineTool({ name, description, input: zod, handler })`. `input` is the
   single source of truth. Handlers return a light `ToolOutcome` (`{ ok, data, message? }` /
   `{ ok:false, code, message }`) and receive **typed, pre-validated** args + typed metadata.
2. **`src/core/provider-factory.ts`** — `createProvider({ manifest, auth, metadataSchema?, tools })`:
   the generic dispatcher. Builds `listTools()` (JSON Schema generated from each `input`) and
   `callTool()` (validate metadata → validate args → call typed handler → wrap into `ToolResult`;
   unknown tool → `UNKNOWN_TOOL`; invalid args/metadata → `INVALID_INPUT`). Publishes `contextSchema`.
3. **`src/core/pagination.ts`** — `PaginatedResult<T>`, `paginationInput` (zod: page/pageSize +
   defaults + max), `buildPage()` (computes `hasMore`), `definePaginatedList()` convenience wrapper.
4. **`src/core/http.ts`** — `mapHttpStatusToErrorCode(status)` (the typed-error policy) +
   `requestJson()` (timeout, applies the token at egress via `SecretString`, never logs it,
   maps non-2xx to a typed error result; `fetchImpl` injectable for tests).
5. **`src/core/provider-port.ts` / `catalog.ts`** — add optional `contextSchema` to `IProvider` and
   `CatalogEntry` so the consumer can discover what context (e.g. `propertyID`) to forward.
6. **`src/core/json-schema.ts`** — `toJsonSchema(zod)` wrapper (zod-to-json-schema).
7. **Refactor `echo`** to the new pattern (`defineTool` + `createProvider` + `createEchoProvider`
   factory). Echo becomes the canonical mini-example and stops hand-writing `inputSchema`.
8. **Tests** — unit tests for every helper (dispatch paths, pagination math, status mapping,
   `requestJson` with injected fetch) + echo still green via conformance.
9. **Enforcement** — CI guard forbidding a hand-written `inputSchema:` under `src/providers/**`.
10. **Docs** — update `architecture-review` (§ canonical pattern) and the `add-provider` template to
    teach the new helpers; this work-log's Outcome section.

**Quality gate for PR A:** `tsc` clean · all tests green · `npm audit` 0 · `format:check` clean ·
CI guard active. PR A must NOT contain any Cloudbeds code (that is PR B).

---

## Outcome (what was actually done)

**Verification:** `tsc` clean · **43/43 tests** · `format:check` clean · CI guard active · `npm audit` 0.

### Done (closed)

- **`src/core/tool.ts`** — `defineTool`, `ToolOutcome`, `ok()`/`err()`, `ToolHandlerContext`, and
  **`toolFactory<M>()`** (binds the provider's metadata type so handlers get typed `ctx.metadata`
  while still inferring each tool's input — no per-tool generics).
- **`src/core/provider-factory.ts`** — `createProvider({ manifest, auth, metadataSchema?, tools })`:
  the generic dispatcher (validate metadata → validate args → typed handler → wrap to `ToolResult`;
  `UNKNOWN_TOOL`/`INVALID_INPUT`). Generates `inputSchema` per tool and publishes `contextSchema`.
- **`src/core/pagination.ts`** — `PaginatedResult<T>`, `paginationInput` (defaults + `MAX_PAGE_SIZE`),
  `buildPage()` (derives `hasMore` only when determinable), and **`definePaginatedList`** (merges
  pagination into a tool's input + wraps items into the uniform envelope).
- **`src/core/http.ts`** — `mapHttpStatusToErrorCode()` + `requestJson()` (timeout, token-at-egress
  never logged, typed error result, injectable `fetchImpl`).
- **`src/core/json-schema.ts`** — `toJsonSchema(zod)`.
- **`IProvider`/`CatalogEntry`** — added optional `contextSchema` so the consumer can discover the
  required context (e.g. `propertyID`).
- **`echo` refactored** to the pattern (`defineTool` + `createProvider` + `createEchoProvider`
  factory); no more hand-written `inputSchema`. It is now the canonical mini-example.
- **Tests** — `provider-factory`, `http`, `pagination` unit suites; echo still green via conformance.
- **CI guard** — fails if any `src/providers/**` hand-writes `inputSchema`.
- **ADR `canonical-provider-pattern`** + glossary + ADR index.

### Decisions taken during implementation

1. **`toolFactory<M>()`** introduced to give typed metadata ergonomically (a clean fix for TS
   invariance, instead of casts or fragile explicit generics).
2. **`tools: ReadonlyArray<ToolDefinition<any, M>>`** — a single, contained `any` for the *input*
   type is required to hold a heterogeneous tool collection; per-tool types stay sound at each
   `defineTool`/`tool()` call site. (When ESLint lands, this is the one allowed `no-explicit-any`.)
2. **`requestJson` applies the token as Bearer only** — Cloudbeds uses bearer. `api_key`/query/
   custom-header application is **deferred** until a provider needs it ("share policies, not
   assumptions").
3. **`contextSchema` published in the catalog** — the Explicit Context principle needs the consumer
   to *discover* what context to send, so it is exposed via `server/discover`.

### Open / deferred (to refine before / during PR B)

- **`definePaginatedList` — DONE in PR A (correction).** Initially deferred to PR B, but it is a
  **core** helper: building it in PR B would make the provider PR touch `src/core/**` and break the
  §10 demonstration (a provider PR touches only `src/providers/**`). So it belongs in this platform
  PR. PR B will be its first real consumer (Cloudbeds `list_reservations`) and may refine ergonomics.
- **Non-bearer token application in `requestJson`** — not built (no provider needs it yet).
- **`outputSchema` publishing** — reserved (additive), not implemented.
- **`add-provider` template + architecture-review** — updated to teach the helpers in this PR;
  deeper worked examples will follow with the Cloudbeds adapter (PR B) as the living reference.
- **Adapter message hygiene** — `requestJson` returns the provider's error `body` for adapters to
  craft messages; PR B must ensure adapters never echo sensitive provider data into result messages.

### Refinement questions for review (before PR B)

- ~~Build `definePaginatedList` in PR B?~~ **Resolved:** built in PR A (it is a core helper; keeping
  it out of the provider PR preserves the §10 demonstration).
- Keep `requestJson` bearer-only until a non-OAuth provider appears? (recommended: yes)
