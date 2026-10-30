# HotelSync provider — ship log

Build notes and the operational log, newest first. The plan is `implementation-plan.md`; this records what
was built and what the build decided that the plan left open.

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
