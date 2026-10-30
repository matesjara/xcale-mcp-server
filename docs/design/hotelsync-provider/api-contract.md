# HotelSync provider — API contract

> **Provider**: `hotelsync` · **schemaVersion** `2026-10-30` · **providerVersion** `0.1.0`
> **Issue**: #187 · **Epic**: matesjara/xcale-backend#1694
> **Status**: Draft — built from HotelSync's OpenAPI; to be confirmed by the first login (see § Evidence)
> **Last modified**: 2026-10-30

The published MCP surface of the `hotelsync` provider: its catalog entry, its call context, its tools and its
errors. Consumers discover it through `server/discover` and `tools/list`; this document is what they build
against.

## Evidence

This contract is written from **HotelSync's OpenAPI** (`https://api-docs.hotelsync.com/openapi.yaml`,
`info.version` 2026-10-28), not from observed wire behaviour. The release owner chose to build before access
arrives (2026-10-30) so the integration is not blocked; every fact below is tagged with its source, and the
first login against the customer's property confirms or corrects each `spec` row before any consumer ships on
it. Writes are confirmed only against a staging property.

| Tag | Meaning |
| :-- | :-- |
| **observed** | Seen on the wire (`ship-log.md` records when and how). |
| **spec** | Read from the OpenAPI; not yet seen. |
| **ours** | This server's own behaviour, proven by its tests. |

**Observed so far (2026-10-30):** `POST /api/user/auth/login` with an unknown user answers
`401 Invalid username/password` on both `app` and `beta`, whatever the partner token; a data call with an
unknown session answers `401 Session key invalid` on both, whatever the token. HotelSync judges the user or
the session before the token, so a token cannot be checked without a real login.

## 1. Catalog entry

| Field | Value | Source |
| :-- | :-- | :-- |
| `slug` / `displayName` / `category` | `hotelsync` / `HotelSync` / `hospitality` | ours |
| `logoUrl` | `/assets/hotelsync.svg` (house tile; to be replaced by HotelSync's mark) | ours |
| `connectionProbe` | `{ tool: 'mcp_hotelsync_get_property' }` | ours |
| `contextSchema` | `{ id_properties: string (min 1) }`, strict | spec (`AuthFields`) |
| `authDescriptor` | below | spec + ADR |

```json
{
  "type": "credential_exchange",
  "credentialDelivery": "reference",
  "tokenEndpoint": "https://app.hotelsync.com/api/user/auth/login",
  "method": "POST",
  "bodyFields": { "partnerToken": "token", "username": "username", "password": "password" },
  "responseFields": { "token": "pkey" },
  "tokenPlacement": "body",
  "tokenBodyField": "key",
  "bodyCompanions": { "partnerToken": "token" }
}
```

- No `responseFields.expiry`: the consumer reuses the session until a data call answers
  `PROVIDER_AUTH_EXPIRED` (ADR `credential-exchange-session-key-in-body`). *spec* — the login declares no
  lifetime.
- The consumer pins its own mint host. **It must be the host this server calls**
  (`HOTELSYNC_BASE_URL`: `https://app.hotelsync.com` by default, or `https://beta.hotelsync.com`); a staging
  session does not open production. *spec*
- The login response's `Content-Type` is `text/html` with a JSON body, and it carries user data including a
  password field: read only `pkey`, never store or log the response. *spec*
- A `511` at login is a 2FA challenge; its `pkey` is not a session. *spec*

## 2. The wire (every tool)

`POST {HOTELSYNC_BASE_URL}{path}`, `content-type: application/json`, body
`{ ...tool fields, id_properties, key, token }`. *spec*

- `id_properties` comes **only** from the call context; it overrides any value a passthrough body carries. No
  tool accepts it as input. *ours*
- `key` and `token` are placed by the core materializer; a request that already carries either is refused.
  *ours*
- A 2xx body is returned verbatim as `data`. *ours*

## 3. Tools

### Agent menu (`tools/list`)

| Tool | Path | Input | Returns (*spec*) |
| :-- | :-- | :-- | :-- |
| `mcp_hotelsync_get_property` | `/api/property/data/property` | none | property object: name, type, contact, address, check-in/out times, currency, policies |
| `mcp_hotelsync_list_room_types` | `/api/room/data/rooms` | `details?: boolean` (→ `1`/`0`), `type?: string` | array of room types: `id_room_types`, `name`, `type`, `occupancy`, `bathrooms`, `area`, … |
| `mcp_hotelsync_list_rate_plans` | `/api/pricingPlan/data/pricing_plans` | none | array of plans: `id_pricing_plans`, `name`, `id_boards`, `id_policies`, `id_restriction_plans`, … |
| `mcp_hotelsync_check_availability` | `/api/avail/data/avail` | `dfrom`, `dto` (ISO dates, `dto ≥ dfrom`) | `{ [id_room_types]: { [date]: count } }` |
| `mcp_hotelsync_list_restrictions` | `/api/restrictions/data/restrictions` | `id_restriction_plans`, `dfrom`, `dto` | `{ status, data: { [id_room_types]: { [date]: { closed, closed_arrival, closed_departure, min_stay, max_stay, min_stay_arrival } } } }` |

### Backend-only (`controlPlane` — routable, not listed)

| Tool | Path | Input | Returns (*spec*) |
| :-- | :-- | :-- | :-- |
| `mcp_hotelsync_get_prices` | `/api/prices/data/prices` | `id_pricing_plans`, `dfrom`, `dto` | `{ status, data: { [id_room_types]: { [date]: price } } }` |
| `mcp_hotelsync_quote_room_type` | `/api/prices/data/reservation_room_type_prices` | `id_room_types`, `id_pricing_plans`, `dfrom` (check-in), `dto` (check-out, after `dfrom`), `adults ≥ 1`, `children_1..3?`, `seniors?` | per-night breakdown and total (no example in the spec) |
| `mcp_hotelsync_get_reservation` | `/api/reservation/data/reservation` | `id_reservations` | the full reservation: status, guest status, dates, rooms, guests, prices, payments, `pending_until` |
| `mcp_hotelsync_search_reservations` | `/api/reservation/data/reservations` | `search?`, `dfrom?`, `dto?`, `filter_by?`, `last_modified_from?`, `last_modified_to?`, `status?` (`confirmed`/`modified`/`canceled`), `show_rooms?: boolean`, `page?` | `{ total_pages_number, page, totals, reservations[] }`, 20 per page |
| `mcp_hotelsync_create_reservation` | `/api/reservation/insert/reservation` | checked: `date_arrival`, `date_departure` (after arrival), `id_pricing_plans`, `status?` (`confirmed`/`pending`/`offer`), `rooms[≥1]` with `id_room_types` and `adults ≥ 1`, `guests[≥1]` with `first_name` and `last_name`; **every other field passes through** (prices, `id_channels`, `pending_until`, notes, payments, `guest_email`, …) | `{ id_reservations, id_changelog, id_invoices, reservation }` |
| `mcp_hotelsync_modify_reservation` | `/api/reservation/edit/basics_new` | `reservation`: the record as `get_reservation` returned it, with the changes; `id_reservations` required, the rest passes through | not documented |
| `mcp_hotelsync_cancel_reservation` | `/api/reservation/delete/delete` | `id_reservations`, `reason` (non-blank) | not documented — "cancel or permanently delete" |
| `mcp_hotelsync_register_webhook` | `/api/webhooks/insert/webhook` | `url` (https only) | `201 { id_webhooks }` |
| `mcp_hotelsync_list_webhooks` | `/api/webhooks/data/webhooks` | none | array: `id_webhooks`, `url`, `date_created` |
| `mcp_hotelsync_delete_webhook` | `/api/webhooks/delete/webhook` | `id_webhooks` | `{ id_webhooks }` |

Writes are thin passthroughs (ADR 0015): one call, one mutation, no retry here. Confirmation, idempotency and
who-is-asking are the consumer's.

### Webhooks (consumer-side, *spec*)

HotelSync POSTs `{ data_type, action, data }` (`reservation`: `insert`/`edit`/`delete`; also invoices) to
every registered URL; at most 20 per property. Answer 2xx within 3 s; otherwise retried after 3, 10 and 30
minutes and resent later. Events may repeat and arrive out of order, and are **not signed**: the URL carries
the consumer's secret, every event triggers a re-read through `get_reservation`, and the consumer reconciles
at least every 30 minutes (`search_reservations` with `last_modified_*`).

## 4. Errors

Bodies are plain text. Known messages map to a fixed reason; an unknown body is never echoed. *ours*, on top
of *spec* statuses.

| HotelSync | Code | Message reason | Consumer |
| :-- | :-- | :-- | :-- |
| `401 Session key invalid` | `PROVIDER_AUTH_EXPIRED` | the session ended | drop the cached session, log in, retry once |
| `403 No access to property` / unknown token | `PROVIDER_AUTH_EXPIRED` | cannot access the connected property | reconnect if the re-login fails too |
| `403` read-only token, on a write | `PROVIDER_ERROR` | read-only access | do not mark the connection expired |
| `500` account suspended / expired | `PROVIDER_UNAVAILABLE` (core mapping) | account suspended or expired | surface to the operator; the reason says it is not transient |
| other non-2xx | core mapping | none | — |
| host not allowed (`HOTELSYNC_BASE_URL`) | `PROVIDER_ERROR` | — | deployment fix; the server warns at boot |
| invalid input | `PROVIDER_INVALID_INPUT` | — | nothing is sent |

## 5. To confirm at the first login

1. The partner token's environment (`app` or `beta`) and whether it is per account. 2. The login user and
2FA. 3. Session lifetime; whether a new login ends the previous session. 4. Every *spec* response shape above,
recorded as fixtures. 5. Whether prices include taxes and extra-person charges. 6. Room photos: whether
`list_room_types` with `details` carries them (the epic needs them). 7. Whether a reservation's payment link
(Wompi) is readable through the API. Writes, in staging: 8. what `create_reservation` strictly requires;
9. whether `cancel_reservation` keeps a `canceled` record; 10. `pending_until` and `id_channels`; 11. whether
an API reservation blocks the OTA calendars at once.
