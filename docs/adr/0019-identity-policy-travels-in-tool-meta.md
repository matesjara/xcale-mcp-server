# ADR 0019: A tool's identity policy travels in `_meta`, under this server's namespace

- **Status:** Accepted
- **Date:** 2026-09-24
- **Decision makers:** Juan José (design lead), xcale team
- **Tags:** mcp, contract, tools-list, privacy, integrations

## Context

`ToolIdentityPolicy` is provider knowledge a consumer cannot derive. A gateway tool arrives as a
name, a description and a JSON Schema, and nothing in those says that `guestPhone` identifies a
person, or that `search_guests` with every filter omitted returns the property's whole guest list.
So the server declares it and publishes it — the same argument as `requiredScopes`.

The first implementation declared the field on every provider tool and shipped. It never reached a
consumer. Two independent reasons, and each alone was enough:

1. **`tools/list` rebuilds each tool field by field.** `createMcpServer`'s handler constructs
   `{ name, description, inputSchema }`, so anything a provider declares beyond those three stops
   at this server unless the handler names it.
2. **The MCP SDK would have stripped it anyway.** The SDK validates every published tool against
   `ToolSchema`, a plain `z.object`, and zod drops keys the schema does not name.

The review of PR #101 caught (1) and asked for a decision on where the field should travel:
`_meta` or a top-level key.

## Decision

**`_meta`, under the key `xcale.app/identityPolicy`** (`IDENTITY_POLICY_META_KEY` in
`src/core/types.ts`). A tool with no policy carries no key — absence is the answer for a tool that
touches nobody's records, which is most of them.

This is not a preference between two workable options. It was measured against the installed SDK:

```
ToolSchema.parse({ name, description, inputSchema, identityPolicy })  → the key is gone
ToolSchema.parse({ name, description, inputSchema, _meta: { … } })    → `_meta` survives intact
```

A top-level field is not "less conventional" — it does not arrive. `_meta` is the one passthrough
`ToolSchema` declares (`z.record(z.string(), z.unknown())`) and the MCP specification's own place
for implementation-defined metadata.

**The key is namespaced with this server's own prefix**, as the spec asks, because `_meta` is
shared ground between every participant. `xcale.app/` names the PRODUCER. It is not a consumer
concept: any MCP client can read the key without knowing that xcale-backend exists, which is the
consumer-agnostic bar this repo holds itself to.

## Consequences

- **Additive, per ADR 0001.** A consumer that ignores `_meta` sees exactly the tool menu it saw
  before. One that reads it can tell a guest lookup from a room-type read.
- **The policy is a DECLARATION, not an enforcement point.** This gateway does not police it; the
  consumer decides what to do under its own tenant's setting. Nothing here narrows what a tenant's
  credential already allows.
- **A new field on the published surface is a `schemaVersion` bump** (ADR 0001), so a consumer
  keyed on it re-reads the menu.
- **The test that proves it must go through the wire.** A test reading `provider.listTools()` reads
  the declaration, which was never the broken half; it passed for as long as the field was being
  dropped. The guard lives in `src/protocol/__tests__/mcp.integration.test.ts`, over a real MCP
  client on Streamable HTTP, so the SDK validates both ends — the same validation that did the
  stripping.

## Alternatives considered

- **A top-level `identityPolicy` field.** Rejected on evidence, not taste: `ToolSchema` removes it.
  Shipping it would repeat the exact failure this ADR exists to close, and silently.
- **`annotations`.** It is a spec-defined, closed vocabulary about tool behaviour (read-only,
  destructive, idempotent). Whose data a tool reaches is not in it, and bending an existing field
  to carry something it does not mean is how a contract stops being readable.
- **Leaving it out of the wire and keeping a map in the consumer.** This is what the feature exists
  to replace: a hand-maintained list over there names tools by string and rots silently the day one
  is renamed — protecting a name that no longer exists, with nothing failing.
