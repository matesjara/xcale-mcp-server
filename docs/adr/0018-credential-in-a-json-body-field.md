# ADR 0018: An `api_key` credential may be placed in a JSON body field

- **Status:** Proposed
- **Date:** 2026-09-23
- **Decision makers:** Juan José
- **Tags:** auth, core, materialization, mews

## Context

Mews' Connector API authenticates **in the request body**. Every operation is a `POST` whose JSON body carries
`ClientToken`, `AccessToken` and `Client` beside the operation's own fields. There is no header or query
alternative: observed against `api.mews-demo.com` on 2026-09-23, and documented in _Guidelines › Requests_.

`ProviderAuthDescriptor`'s `api_key` fields offer `placement: 'header' | 'query'`, and the materializer
(`src/core/auth/authentication-materializer.ts`) is the only place in the runtime that reveals a secret. A
provider that needs its secret in the body therefore has two options: an adapter workaround, or this ADR. The
workaround would have the adapter read the credential, which the credential boundary forbids
(`docs/security/credential-boundary-review.md`).

## Decision

1. `api_key` fields gain a third placement, **`json_body`**: the secret is set as a top-level property, named by
   the field's `key`, of the JSON object the provider's client put in `RequestSpec.body`.
2. The materializer applies it. The body must be a **string that parses to a JSON object**. A missing body, a
   `URLSearchParams` body or a body that is not a JSON object is a descriptor or client bug, and it **throws**. It
   is never sent unauthenticated, the same rule `custom_header` follows.
3. The client never writes the credential's key into the body. If the key is already there, the materializer
   **throws** rather than overwrite it: a client that pre-fills the credential field is a bug to see.
4. The credential still travels only from the materializer to the transport. The transport's redaction covers
   request bodies it echoes. Error results carry the provider's **response** body, never the request, so the
   secret cannot reach a tool result.
5. The consumer needs nothing new: `placement` is opaque to xcale-backend, which sends the secret in
   `X-Provider-Token` as for every `api_key` provider.

## Consequences

- A core change, so the provider PR that introduces it breaks the golden rule knowingly and says so. This ADR is
  the exception it requires.
- `auth-materialization-parity.test.ts` still holds: one secret, one placement per provider.
- Other body-authenticated APIs (several LATAM POS and PMS APIs are) can use it with no further core work.
- Not covered: a secret nested deeper than the top level, several secrets in one body, or form-encoded bodies.
  Each of those is its own ADR when a provider needs it.
