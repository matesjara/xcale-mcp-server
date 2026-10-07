# ADR: `body` placement for `api_key` credentials in the materializer

- **Status:** Proposed
- **Date:** 2026-09-25
- **Decision makers:** Sara Estrada, Mateo (release owner)
- **Tags:** auth, core, integrations, mcp

## Context

The HiMed integration (`docs/design/himed-provider/`) is the first provider whose credential travels **inside
the JSON request body**, not in a header or the URL. Both HiMed backends require it:

- **Demográficos** (`himed`): `{ "api_key": "…", "tipo_documento": "…", … }` — the `api_key` is one more field of the POST body.
- **Autoagendamiento** (`himed-scheduling`): `{ "accion": "…", "token": "…", "codigo_servicio": "…" }` — the `token` (the secret) sits in the body.

Today the **Authentication Materializer** — the single `.reveal()` site in the whole runtime
(`src/core/auth/authentication-materializer.ts`) — can place an `api_key` credential in only **two** ways
(`src/core/provider-port.ts:23`):

```ts
readonly placement: 'header' | 'query';
```

The materializer's `api_key` case branches header-vs-query (`authentication-materializer.ts:39-43`); there is
no third way, and in particular it **never** writes the secret into the body. `.placement` is consumed in
**exactly one place** (that switch) — verified by grep.

Because the materializer is `src/core` code shared by every provider, and the `add-provider` **golden rule**
forbids a provider PR from touching `src/core` without an **exceptional ADR**, extending it is a structural
decision, not an everyday change. Hence this ADR.

## Decision

Add **`'body'`** as a third `placement` value for the `api_key` / `bearer` descriptor variant, and a
corresponding branch in the materializer that **injects the revealed secret as a field of the JSON body**:

```ts
// provider-port.ts
readonly placement: 'header' | 'query' | 'body';

// authentication-materializer.ts (api_key case)
if (field.placement === 'header')      headers[field.key] = secret;
else if (field.placement === 'query')  url = appendQueryParam(url, field.key, secret);
else /* 'body' */                       body = injectBodyParam(body, field.key, secret);
```

`injectBodyParam` parses the provider-built JSON string body, adds `{ [field.key]: secret }`, and
re-serializes. It is **strictly declarative** in the same spirit as the rest of the descriptor: the field
**name** is knowledge in `auth.ts`; the **value** is the revealed credential; nothing is interpolated or
evaluated. The single `.reveal()` stays in the materializer.

**Constraints:**

- `'body'` placement requires a **JSON string** body (`RequestSpec.body` typed `string | URLSearchParams`);
  a `URLSearchParams` or absent body with `placement:'body'` is a **descriptor bug** and throws loudly
  (never sent unauthenticated / silently).
- Only the **first** field is placed (single-secret `ResolvedCredential`, unchanged). HiMed-scheduling's
  second value (`codigo_servicio`) is **non-secret metadata** (see the HiMed api-contract §2.2), placed in the
  body by the provider handler, not the materializer.

## Alternatives Considered

| Alternative                                                                     | Verdict                                                                                                                                                                                   |
| :------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — inject the secret in the provider `client.ts`** (bypass the materializer) | ❌ rejected — breaks Credential-in-Transit-Only: `.reveal()` must stay the single core egress point, CI-guarded. A provider revealing its own secret is exactly what the control forbids. |
| **B — force HiMed's credential into a header**                                  | ❌ rejected — HiMed does not read a header; the API only authenticates from the body field. Not our choice to make.                                                                       |
| **C — a new imperative/signed-auth variant**                                    | ❌ unnecessary — HiMed's credentials are **static** values it issues (not computed per request), so a plain secret-in-body suffices. Imperative auth stays a separate future ADR.         |
| **D (accepted) — extend `placement` with `'body'` in the materializer**         | ✅ the minimal, declarative change; keeps the `.reveal()` boundary intact; one switch, one helper.                                                                                        |

## Consequences

### Positive

- HiMed (and any future provider that authenticates from the body) fits the existing declarative descriptor
  model with a few lines and no new machinery.
- `.reveal()` stays confined to the materializer; the provider client never touches the secret.

### Negative / new surface (security)

- **The request body becomes a credential surface.** Today the redaction control (`redactQueryValues`,
  `http.ts:47`) targets the credential **in the URL** (Toteat's case); it does **not** redact a secret inside a
  JSON body. This is acceptable because **no current code path surfaces the request body** in logs or errors
  (only the _response_ body and transport error messages are surfaced, and neither carries our request token —
  HiMed's errors are `{mensaje}` and do not echo the token). The invariant to preserve: **never log or
  interpolate the request body** into any tool result, error, or trace. A test asserts the secret never appears
  in an error path for a body-placement provider; if a future code path ever surfaces `req.body`, it must
  redact like the URL path does.
- `ProviderAuthDescriptor` gains a value in a published-contract type — additive, versioned by
  `schemaVersion`, honoured by the existing `auth-materialization-parity` invariant.

### Neutral

- Cloudbeds/Toteat/Siigo are unaffected (their placements are unchanged); the new branch only runs for a
  descriptor that declares `placement:'body'`.

## References

- Feature / contract / plan: `docs/design/himed-provider/{feature-design,api-contract,implementation-plan}.md`
- Golden rule + provider self-containment: `docs/architecture-review.md` §0; `add-provider` skill.
- Credential boundary: `docs/security/credential-boundary-review.md`; `CONTEXT.md` — Credential-in-Transit-Only, Authentication Materialization, `SecretString`.
- Related: `docs/adr/0004-provider-knowledge-vs-credential-custody.md`, `docs/adr/0010-credential-delivery-strategies.md`.
