# HotelSync provider — ship log

Build notes and the operational log, newest first. The plan is `implementation-plan.md`; this records what
was built and what the build decided that the plan left open.

## 2026-10-30 — Provider built from the OpenAPI, before access

Mateo, 2026-10-30: build with the token and the docs; do not wait for HotelSync access. So the provider and
its contract are written from HotelSync's OpenAPI and tagged by source (`api-contract.md` › Evidence); the
first login confirms or corrects them. This sets aside the repo's evidence-before-contract rule for this
provider, by the release owner's call.

**Observed (first contact with the wire).** The partner token Kunas sent was probed without an account: a
login with an unknown user, on `app` and on `beta`, answers `401 Invalid username/password` for the real
token and for an all-zero one alike; a data call with an unknown session answers `401 Session key invalid`
for both. HotelSync checks the user (login) or the session (data) before the token, so the token's
environment cannot be learned without a real login. Nothing was created; no account was touched. The token
also differs from the one Kunas' help center publishes.

**What was built** — `src/providers/hotelsync/`: manifest (with `connectionProbe`), auth descriptor, context
(`id_properties`), client (JSON POST, host allowlist `app`/`beta`), error unwrap, 15 tools (5 on the menu, 10
`controlPlane`), fixtures from the OpenAPI's examples (placeholders, see `__fixtures__/README.md`), 29 tests;
one line in `src/providers/index.ts`; `assets/hotelsync.svg`; optional `HOTELSYNC_BASE_URL` in
`src/config.ts` and `.env.example`.

**Decided during the build**

- Reservation tools are all `controlPlane`, with no `identityPolicy`: the Cloudbeds modify-verified flow
  enforces who-is-asking in xcale-backend's `booking` module, not in tool metadata (grill notes D5 rewritten).
- Cancel is `/api/reservation/delete/delete` with a reason; `/api/reservation/edit/status` sets the guest
  status, not the reservation's — the grill notes had it wrong.
- Create and modify are passthroughs that check only what makes a write unsafe (dates, rate plan, a room
  and a guest, the reservation id); the property is always the context's, even when a passthrough body
  carries another.
- A host outside the allowlist throws in the factory; the default instance then fails closed and warns at
  boot instead of stopping the server.
- Known plain-text errors map to fixed reasons; a read-only token refusing a write is `PROVIDER_ERROR` so the
  connection is not marked expired.
- The logo is a placeholder house tile (letters HS) until HotelSync's mark is traced.

**Checks** — typecheck clean · format clean · `npm test` 859 passed.

**Found after the grill:** xcale-backend already has the Kunas epic (#1694, Esteban, 2026-10-19) with
#1691 (access, the open questions), #1692 (booking adapter, with a deposit through the property's payment
link and unit photos) and #1693 (CRM by webhook). The contract's § 5 carries the questions they add.

## 2026-10-29 — Phase 0a built (core)

Branch `feat/187-hotelsync-auth`. No HotelSync call is made: every behaviour is proven against fakes.

**What changed**

- `src/core/provider-port.ts` — `credential_exchange` gains `tokenPlacement: 'body'`, `tokenBodyField` and
  `bodyCompanions`. Additive: a descriptor without them is unchanged.
- `src/core/credential/resolved-credential.ts`, `reference-resolver.ts` — the resolve response may carry
  `companions`; each is wrapped in a `SecretString` on arrival. A malformed answer (not an object, an empty
  or non-string value) is a `ReferenceResolutionError`, transport-owned, and names no value.
- `src/core/auth/authentication-materializer.ts` — `credential_exchange` is split from `oauth2`; `'body'`
  injects the minted token under `tokenBodyField` and each companion under its wire name. A missing
  `tokenBodyField` or companion throws.
- `src/core/testing/provider-conformance.ts` — `'body'` requires `tokenBodyField`; a companion must be a
  `bodyFields` key.
- `src/core/__tests__/catalog.test.ts` — the secret scan drops `bodyCompanions` (a name map, ADR 0020).

**Decided during the build**

- Companions are keyed by **logical** name on the wire and in `ResolvedCredential`; the descriptor maps them
  to wire names, so the consumer never needs to know HotelSync's field names.
- `injectBodyParam` now refuses to overwrite a field the request already carries. It applies to the
  `api_key` body placement too (HiMed): no handler writes an auth field, and the suite confirms it. Its error
  text says "body placement" instead of "api_key placement 'body'".
- Tool names take the `mcp_<slug>_` prefix conformance requires (`mcp_hotelsync_*`); the grill notes are
  corrected to match.

**Checks**

- `npm run typecheck` clean · `npm run format:check` clean · `npm test` 825 passed.
- `himed-credentials.integration.test.ts` times out in its setup hook now and then under a full parallel
  run (10 s hook timeout); it passes on rerun and fails the same way without this change.
- `.reveal()` only in the materializer and at the reference nonce.

**Next:** Phase 0b in xcale-backend (pinned HotelSync entry, `511`, reuse until rejected, companions,
invalidate and retry), gated on this reaching xcale-mcp-server `dev`.
