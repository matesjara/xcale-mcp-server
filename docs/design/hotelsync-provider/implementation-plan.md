# HotelSync provider — Implementation Plan

> **Design**: [`feature-design.md`](feature-design.md) · **Grill**: [`grill-notes.md`](grill-notes.md) ·
> **ADR**: [`credential-exchange-session-key-in-body`](../../adr/credential-exchange-session-key-in-body.md) ·
> **Issue**: #187
> **Status**: Planned — Phase 0 detailed; Phases 1a and 1b at slice level
> **Last Updated**: 2026-10-29

## Meta-description

Phase 0 builds the auth mechanism HotelSync needs and nothing provider-specific: `credential_exchange` gains
**body placement** of the minted token and **body companions** in xcale-mcp-server's core, and xcale-backend's
Rail A gains the HotelSync pinned entry, resolve companions, **reuse until rejected**, invalidate-and-retry on
`PROVIDER_AUTH_EXPIRED`, and `511` as an auth failure. It needs no HotelSync evidence: every behaviour is
proven with unit tests against fakes. Done means both repos green and the Siigo/Erbon behaviour byte-identical
(a descriptor without the new fields takes exactly today's path).

**The contract for Phase 0** is the ADR: the descriptor fields and the Hop-B resolve shape are our own
surface, observed by construction, and the ADR specifies them. The provider's tool contract
(`api-contract.md`) is authored for Phase 1a once the login yields evidence (evidence before contract); this
plan does not anticipate it.

**Detail tapers by phase.** Phase 0 is specified per file against code read on `origin/dev` on 2026-10-29.
Phases 1a and 1b stay at slice level: `src/providers/hotelsync/` does not exist and its shape depends on wire
facts not yet observed; their per-file detail is authored at their gate.

**Two repos, two PRs, provider before consumer** (`/cross-repo`): the xcale-mcp-server core PR merges first,
then the xcale-backend PR. Each PR is one branch with a commit per green slice.

---

## Phase 0a — xcale-mcp-server core

### Target file tree

```
xcale-mcp-server/
├── docs/adr/credential-exchange-session-key-in-body.md   UNCHANGED (this design PR)
├── src/core/
│   ├── provider-port.ts                                  MODIFIED
│   ├── auth/
│   │   ├── authentication-materializer.ts                MODIFIED
│   │   └── __tests__/authentication-materializer.test.ts MODIFIED
│   ├── credential/
│   │   ├── resolved-credential.ts                        MODIFIED
│   │   ├── reference-resolver.ts                         MODIFIED
│   │   └── __tests__/reference-resolver.test.ts          MODIFIED
│   ├── testing/provider-conformance.ts                   MODIFIED
│   └── __tests__/catalog.test.ts                         MODIFIED
└── src/providers/{siigo,erbon,cloudbeds}/                UNCHANGED (context — must stay byte-identical)
```

### Per-file changes

| File | Symbol | Change | Intent | Seam |
| :-- | :-- | :-- | :-- | :-- |
| `src/core/provider-port.ts:107-125` | `ProviderAuthDescriptor` (`credential_exchange` arm) | MODIFIED | `tokenPlacement: 'bearer_header' \| 'body'`; NEW optional `tokenBodyField?: string` (wire name when `'body'`); NEW optional `bodyCompanions?: Readonly<Record<string, string>>` (logical durable field → wire body field). All additive. | Published `authDescriptor` (ADR 0001) |
| `src/core/credential/resolved-credential.ts:14-22` | `ResolvedCredential` | MODIFIED | NEW optional `companions?: Readonly<Record<string, SecretString>>`, keyed by logical name. | Resolver → materializer |
| `src/core/credential/reference-resolver.ts:75-81` | `createReferenceCredentialResolver().resolve` | MODIFIED | On 200, read an optional `companions` object of non-empty strings and wrap each value in a `SecretString`; a non-object or a non-string value → `ReferenceResolutionError` (transport-owned). Absent → today's shape. | Hop-B resolve response |
| `src/core/auth/authentication-materializer.ts:68-77` | `materialize` (`credential_exchange` case) | MODIFIED | Split from `oauth2`. `'bearer_header'` unchanged. `'body'` → `injectBodyParam(body, auth.tokenBodyField, secret)`; then each `bodyCompanions` entry → reveal `resolved.companions[logical]` and inject under its wire name. A declared companion missing from `resolved` throws (fail closed, never sent half-authenticated). | The single reveal file |
| `src/core/auth/authentication-materializer.ts:126-139` | `injectBodyParam(body, key, value): string` | MODIFIED | Refuses to overwrite a key the handler already set (throw: descriptor/handler bug). Error text generalized from "api_key placement" to "body placement". | Shared by `api_key` and `credential_exchange` |
| `src/core/testing/provider-conformance.ts:25-37` | conformance `credential_exchange` case | MODIFIED | `tokenPlacement === 'body'` requires a non-empty `tokenBodyField`; every `bodyCompanions` logical key is a `bodyFields` key (a companion is a durable credential field). | Every provider's conformance run |
| `src/core/__tests__/catalog.test.ts:21-28` | catalog secret scan | MODIFIED | Also drop `bodyCompanions` (a name map, ADR 0020) before scanning values. | Catalog secret-scan guard |

### Slices

| # | Slice | Owns | Done when |
| :-- | :-- | :-- | :-- |
| S0a.1 | Descriptor + conformance | `provider-port.ts`, `provider-conformance.ts`, `catalog.test.ts` | Types compile; conformance rejects `'body'` without a field and a companion outside `bodyFields`; existing providers pass unchanged |
| S0a.2 | Resolve companions | `resolved-credential.ts`, `reference-resolver.ts` + test | Resolver tests: absent / valid / malformed companions; token-only path byte-identical |
| S0a.3 | Materialize in the body | `authentication-materializer.ts` + test | Tests below green; `bearer_header` cases unchanged |

**Tests S0a.3 must add:** `pkey` placed as `key` and the partner token as `token` in a JSON body; a non-JSON
or absent body throws; a declared companion missing from `resolved` throws; a handler-set `key` or `token` is
not overwritten (throws); no thrown error message contains the session key or the companion value; Siigo and
Erbon descriptors materialize exactly as before (parity — `auth-materialization-parity.test.ts`).

Sequential: S0a.1 → S0a.2 → S0a.3 (each builds on the previous types). No fan-out.

### Definition of Done — Phase 0a

- [ ] `npm run typecheck` clean
- [ ] `npm run format:check` clean
- [ ] `npm test` green, conformance and parity included
- [ ] `.reveal()` still appears only in `authentication-materializer.ts` and the reference nonce site
      (`git grep -n "\.reveal()" src`)
- [ ] PR body states the `src/core` reach and links the ADR (`/implement` escalates core changes; this PR
      goes through `/pr-review`)

---

## Phase 0b — xcale-backend Rail A

Gate: Phase 0a merged into xcale-mcp-server `dev`.

### Target file tree

```
xcale-backend/src/modules/
├── connections/
│   ├── credential-exchange.ts                     MODIFIED
│   ├── credential-exchange-providers.ts           MODIFIED
│   ├── credential-resolve.service.ts              MODIFIED
│   ├── internal-routes.ts                         MODIFIED
│   └── (their tests)                              MODIFIED
├── mcp/
│   ├── mcp-tool-executor.ts                       MODIFIED
│   └── mcp-bootstrap.ts                           MODIFIED
└── config (HotelSync host)                        MODIFIED — see S0b.1
```

### Per-file changes

| File | Symbol | Change | Intent | Seam |
| :-- | :-- | :-- | :-- | :-- |
| `connections/credential-exchange.ts:12-24` | `CredentialExchangeDescriptor` | MODIFIED | Mirror the mcp-server fields: `tokenPlacement: 'bearer_header' \| 'body'`, `tokenBodyField?`, `bodyCompanions?`. | Pinned mirror |
| `connections/credential-exchange.ts:48-51` | `CredentialExchangeError.isAuthFailure` | MODIFIED | Also `true` for `511` (a 2FA challenge is an auth failure, never retried); NEW getter `isTwoFactorChallenge` for the reason. | Connect + resolve classification |
| `connections/credential-exchange.ts:98` | `mintCredentialExchange` | UNCHANGED (context) | Already reads JSON whatever the `Content-Type` and only on `res.ok`, so a `511` body's `pkey` is never accepted — pin with a test. | — |
| `connections/credential-exchange-providers.ts:75-102` | NEW `HOTELSYNC: PinnedCredentialExchangeProvider` | NEW entry | `tokenEndpoint` from a deployment host allowlisted to `app.hotelsync.com` / `beta.hotelsync.com`; `bodyFields { partnerToken: 'token', username: 'username', password: 'password' }`; `responseFields { token: 'pkey' }` (no expiry); `tokenPlacement: 'body'`, `tokenBodyField: 'key'`; `bodyCompanions { partnerToken: 'token' }`; `connectFields` partnerToken (secret), username (text), password (secret), id_properties (text); `accountKeyField: 'id_properties'`, `routeAccountKeyToMetadata: true`. | Pinned registry; golden test |
| `connections/credential-resolve.service.ts:38-41` | `CredentialResolveOutcome` (`ok`) | MODIFIED | NEW optional `companions?: Record<string, string>`. | Resolve route |
| `connections/credential-resolve.service.ts:76-83` | `resolve` reuse branch | MODIFIED | Reuse the cached token when it is still valid **or** the descriptor declares no `responseFields.expiry` (reuse until rejected). | Mint/reuse policy |
| `connections/credential-resolve.service.ts:85-126` | `resolve` mint branch | MODIFIED | Read `credentialValues` on both branches when the descriptor declares companions, and return them. Re-mint single-flight per connection: NEW private `inFlight: Map<string, Promise<CredentialResolveOutcome>>`. On `isTwoFactorChallenge`, `lastError.message` says "two-factor authentication required". | — |
| `connections/credential-resolve.service.ts` | NEW `invalidateCachedToken(connectionId: string): Promise<void>` | NEW | Clears `accessToken` / `expiresAt` for a credential_exchange connection so the next resolve re-mints. | Called by the executor |
| `connections/internal-routes.ts:126-138` | `POST /credentials/resolve` handler | MODIFIED | 200 body `{ token, companions? }`; nothing logged. | Hop-B (mcp-server `reference-resolver.ts`) |
| `mcp/mcp-tool-executor.ts:276-291` | `mapResult` / `execute` | MODIFIED | When `credentialDelivery === 'reference'` and the provider is pinned credential_exchange: on `AUTH_EXPIRED`, call `invalidateCachedToken`, issue a fresh reference and re-run `callTool` **once**; only a second `AUTH_EXPIRED` (or a `reconnect_required` resolve) marks the connection and returns `reconnectRequiredResult`. Other providers: unchanged. | Executor ↔ Rail A |
| `mcp/mcp-bootstrap.ts:657-...` | `buildCredentialExchangeConfig().validate` error path | MODIFIED | A `511` at connect shows the 2FA message (new i18n key `connections.error.two_factor_required`, en/es) instead of "check what you pasted". | Connect form |

`invalidateCachedToken` must reach the repository the resolve service already uses
(`ConnectionReader.update`, `credential-resolve.service.ts:33-36`); the executor reaches it through the
connection service it already holds (`mcp-tool-executor.ts:121`). If the service lacks a method for it, the
build adds one there — read `connections/service.ts` at S0b.3 before choosing.

### Slices

| # | Slice | Owns | Done when |
| :-- | :-- | :-- | :-- |
| S0b.1 | Descriptor mirror + HotelSync pinned entry + host config | `credential-exchange.ts`, `credential-exchange-providers.ts`, config | Golden test pins `bodyFields` keys, `bodyCompanions` and host against `xcale-mcp-server`; host outside the allowlist refuses to load |
| S0b.2 | 511 as an auth failure | `credential-exchange.ts`, `mcp-bootstrap.ts`, i18n | Mint 511 → `isAuthFailure`, never retried; connect shows the 2FA message; a 511 body's `pkey` never cached |
| S0b.3 | Reuse until rejected + companions + single-flight | `credential-resolve.service.ts`, `internal-routes.ts` | No-expiry token reused across resolves; companions returned; two concurrent re-mints → one login; Siigo/Erbon expiry behaviour unchanged |
| S0b.4 | Invalidate-and-retry | `mcp-tool-executor.ts` | AUTH_EXPIRED → one re-mint + one retry → success; second AUTH_EXPIRED → reconnect; forwarded/OAuth providers unchanged |

Sequential: S0b.1 → S0b.2 → S0b.3 → S0b.4. Under the fan-out threshold (4 slices, ~10 files): one agent
builds it.

### Definition of Done — Phase 0b

- [ ] `cd xcale-backend && npx tsc --noEmit` clean; ESLint clean on changed files
- [ ] `npm test` green for `connections` and `mcp`
- [ ] No log line or error message carries a token, a session key or a password (test on the error paths)
- [ ] PR links the mcp-server core PR and #187

---

## Phase 1a — Reads (slice level)

Gate: Phase 0 merged into both `dev`s; Kunas answered Q-1/Q-2; the login in Doppler.

| # | Slice | Repo |
| :-- | :-- | :-- |
| S1a.1 | Evidence: login, property read, room types, availability, prices, restrictions, a `401` after logout — `sandbox-evidence.md` | xcale-mcp-server |
| S1a.2 | `api-contract.md` for the read tools (`/api-contract-authoring`) | xcale-mcp-server |
| S1a.3 | `src/providers/hotelsync/` reads + fixtures + conformance, one line in `src/providers/index.ts`, logo (`add-provider`) | xcale-mcp-server |
| S1a.4 | `booking` adapter: quote via `hotelsync_quote_room_type`, restrictions honoured | xcale-backend |
| S1a.5 | Connect form (four fields) from the descriptor | xcale-frontend |

## Phase 1b — Writes and webhooks (slice level)

Gate: Phase 1a merged; a staging property in HotelSync.

| # | Slice | Repo |
| :-- | :-- | :-- |
| S1b.1 | Staging evidence for create / modify / cancel and `test_webhook` | xcale-mcp-server |
| S1b.2 | Contract for writes, identity policies (ADR 0019, 0023) | xcale-mcp-server |
| S1b.3 | Write tools + webhook control-plane tools | xcale-mcp-server |
| S1b.4 | Webhook receiver (secret URL, re-read), register at connect / remove at disconnect | xcale-backend |

## Delegation

Below the threshold in every phase (≤ 4 slices per repo, ≤ ~12 files): build solo, one agent per repo, in
order. Phase 0a and 0b are independent of HotelSync and can start now.
