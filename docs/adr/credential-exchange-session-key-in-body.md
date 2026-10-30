# ADR: `credential_exchange` — a session key placed in the body, body companions, and reuse until rejected

- **Status:** Proposed
- **Date:** 2026-10-29
- **Decision makers:** the CTO (C-level decision on matesjara/xcale-mcp-server#187), Sara Estrada
- **Tags:** auth, core, credential-exchange, integrations, mcp
- **Relates to:** extends [credential-delivery-strategies](0010-credential-delivery-strategies.md) (does not
  amend its hard gate); builds on [body-placement-for-api-key](body-placement-for-api-key.md); additive under
  [additive-contract-versioning](0001-additive-contract-versioning.md).

## Context

HotelSync (`docs/design/hotelsync-provider/`) authenticates with a **session login**: `POST
/api/user/auth/login` with `{token, username, password}` returns a session key `pkey`. Every data call is a
POST whose **JSON body** carries `token` (the partner token), `key` (the `pkey`) and `id_properties`. The
login declares **no lifetime**; a dead session answers `401 Session key invalid`; a login on an account with
2FA may answer `511` with a challenge.

Three things in today's `credential_exchange` do not fit:

1. **Placement.** The variant only allows `tokenPlacement: 'bearer_header'` (`src/core/provider-port.ts`).
   HotelSync reads no header.
2. **A second secret per call.** `ResolvedCredential` carries one secret (plus HiMed's group bundle). HotelSync
   needs the minted `pkey` **and** the partner `token` on every data call; the token is also a login input.
3. **Session lifetime** (consumer side). xcale-backend's Rail A reuses a minted token only when the descriptor
   declares an expiry (`credential-resolve.service.ts`), and any `PROVIDER_AUTH_EXPIRED` flips the connection
   to a reconnect prompt (`mcp-tool-executor.ts`). With no expiry, Rail A would log in on **every** tool call
   — repeated logins from a datacenter are the likeliest way to trip `511` — and a session ending normally
   would ask the hotel to reconnect.

## Decision

HotelSync is a `credential_exchange` provider with `reference` delivery, like Erbon and Siigo, and the variant
gains three **additive** options.

1. **Body placement of the minted token.** `tokenPlacement: 'bearer_header' | 'body'`, with a declared wire
   field name for `'body'` (`key` for HotelSync). The materializer reuses the existing JSON-body injector of
   the `api_key` body placement; the same rule applies — a JSON-string body is required, anything else is a
   descriptor bug that throws — and injection never overwrites a field the handler set.
2. **Body companions.** The descriptor may declare durable-credential fields the Credential Authority also
   returns at resolve, each placed in the body under its wire name (HotelSync: logical `partnerToken` → wire
   `token`). The Hop-B resolve response gains an additive `companions` map; the reference resolver wraps each
   value as a `SecretString`; the materializer reveals them in the same file, so `.reveal()` stays confined to
   one place. Names are knowledge (non-secret, ADR 0020); values are secrets.
3. **Reuse until rejected.** When the descriptor declares no `responseFields.expiry`, the Credential Authority
   reuses the minted token until it is invalidated. When a data call of a `credential_exchange` connection
   returns `PROVIDER_AUTH_EXPIRED`, the consumer drops the cached token, mints a fresh reference and re-issues
   the call **once**; only a rejected mint (resolve → 422 → `PROVIDER_AUTH_EXPIRED`) asks to reconnect. A
   re-mint is single-flight per connection. A `511` at login is an authentication failure, never retried.

No new `ProviderErrorCode`: the error-ownership boundary already says a rejected minted token proves nothing
about the durable credential; only the login does.

**HotelSync's descriptor, for illustration:** `type: 'credential_exchange'`, `credentialDelivery:
'reference'`, token endpoint `/api/user/auth/login` on a deployment-pinned host (`app.hotelsync.com` or
`beta.hotelsync.com`, never consumer-supplied), `bodyFields` `{partnerToken: 'token', username: 'username',
password: 'password'}`, `responseFields: { token: 'pkey' }` (no `expiry`), `tokenPlacement: 'body'` as `key`,
companion `partnerToken → token`. The executor reads the login body as JSON whatever its `Content-Type`, and
only on 2xx, so a `511` body's `pkey` is never accepted.

## Alternatives considered

| Alternative | Verdict |
| :-- | :-- |
| **A — log in inside the provider on every call**, forwarding `{token, username, password}` | ❌ The Execution Engine would see the durable credential on every call — ADR 0010's rejected Alternative A — for a provider whose production writes fiscal records (ADR 0003's reference class). Two HTTP calls per tool call, and repeated logins risk `511`. |
| **B — cache `pkey` in the server** | ❌ Breaks stateless auth (ADR 0005; ADR 0010 Alternative C). Rail A already holds the cache. |
| **C — partner token as deployment config of the server** | ❌ The server would hold a credential (ADR 0004/0005). The token came through a reseller and may be per account; staging and production differ; it carries permissions (`403` "read only"). It stays per connection in Rail A; if HotelSync confirms one institutional token per integrator, Rail A may source it from its own config — the server does not change. |
| **D (accepted) — body placement + companions + reuse until rejected** | ✅ Additive and declarative; one materializer, one reveal site; the session lives where custody lives. |

## Consequences

### Positive

- HotelSync fits the existing `credential_exchange` + `reference` path; the provider stays in
  `src/providers/hotelsync/`.
- One login per session, not per message; a session that ends is renewed silently; only a changed password,
  a revoked token or 2FA asks the hotel to reconnect.
- Fixes a latent flaw for Erbon and Siigo: a token revoked before its declared expiry no longer forces a
  reconnect.

### Negative / new surface (security)

- **The partner token reaches the Execution Engine for one request**, as Siigo's JWT does. Alone it cannot
  open a session (the login also needs the password); it is never cached or logged.
- **The request body carries two secrets.** The body-placement invariant extends to `credential_exchange`:
  never log a request body, never interpolate one into a result; a test pins that neither `pkey` nor `token`
  appears on any error path.
- **The consumer changes too** (xcale-backend): the descriptor mirror, the pinned registry entry, resolve
  companions, no-expiry reuse, invalidate-and-retry at the emitter, and `511` as an auth failure. Order:
  this core change → the backend → the provider → the connect form.

## To reverse

Before any connection uses them: drop the two descriptor options and the resolve `companions` field (one core
PR plus the matching backend PR). Once connections exist, superseding requires migrating them.
