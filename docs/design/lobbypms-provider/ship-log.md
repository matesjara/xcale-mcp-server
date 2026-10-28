# Ship Log — lobbypms-provider

- **Status:** in review — PR #147, not merged
- **Released to prod:** not yet
- **Related:** design-notes.md · matesjara/xcale-backend#1052 (epic), #1610 (egress IPs), #1611 (booking adapter)
- **Consumer:** matesjara/xcale-backend `feat/lobbypms-booking` — release this repo FIRST: the backend discovers
  the `lobbypms` provider from this gateway.

## Build notes & deviations

- Built from the documentation (https://app.lobbypms.com/api) and then corrected against the live API on
  2026-10-15/16 (design notes E1–E19). Where the docs were wrong: the create answer's shape, an unknown booking
  as an HTML 404, a cancelled booking as not found, the holder's contact left empty.
- Auth stays `api_key` with `api_token` in the query (D1). Bearer works on GET (E11); the switch waits on
  evidence for the POST methods.

## For Mateo, at deploy — what this release needs

1. **Apply the app spec with the dedicated egress** (`.do/app.yaml` › `egress: type: DEDICATED_IP`, #1610).
   It is a paid add-on, **US$25/month**. Apply it the way `docs/deploy.md` says (the spec rendered with
   `MCP_SERVER_SECRET` from Doppler `prd`). **Never apply a spec without the `egress` block and never edit
   egress in the dashboard**: that releases the IPs for good, and every hotel would have to authorize new ones.
2. **Read the two dedicated IPs** once the spec is live (App Platform › the app › Settings/Networking, or
   `doctl apps get <app-id>`) and give them to Esteban.
3. **Each hotel authorizes both IPs** in LobbyPMS: Configuraciones › **API** › pestaña **Restricciones** ›
   Agregar dirección IP. The form asks for a user: the hotel's main account. "Restricciones IP" beside
   Usuarios is the user-login list and does **not** authorize the API (E9) — and an IP put there locks that
   user out from anywhere else.
4. Until a hotel has authorized the IPs, every call answers `PROVIDER_ERROR` with `IP_NOT_AUTHORIZED` — the
   provider is working; the hotel's allowlist is not done.

## Ship Log

### Migrations

- N/A (stateless provider, no data)

### Manual UI / QA (dev period)

- 2026-10-15 read-only probe (`scripts/lobbypms-live-probe.ts`) with a fake token: every read 401 →
  `PROVIDER_AUTH_EXPIRED`, token in no output (E1–E4).
- 2026-10-15 real token from an unauthorized IP: 403 `not set as a valid ip` → adjustment: mapped to
  `PROVIDER_ERROR` + `IP_NOT_AUTHORIZED`, never "reconnect" (E5–E8, `2b4aa68`).
- 2026-10-16 the hotel put the IP in the user-login list first; API still 403 (E9). Documented above.
- 2026-10-16 authorized IP, Entre Nubes 339654: every read 200 in the documented shapes (E10–E15);
  adjustment: an unknown booking id (HTML 404) is named `RECORD_NOT_FOUND` (`0349bed`).
- 2026-10-16 first writes from WhatsApp through the backend: create, read back, guest cancellation (E16–E19);
  adjustment: tool descriptions state the observed create answer and the cancelled-is-not-found reading
  (`5ffcb08`).

### Feature flags / config

- `.do/app.yaml` egress block — applied with the release (above).

### Deploy verification (prod)

- [ ] spec applied with egress; the two dedicated IPs recorded here — ⬜ pending
- [ ] a hotel authorized them and the backend's connect probe (`list_room_types`) answered 200 — ⬜ pending

## Known gaps at ship

- Bearer auth on POST methods unverified (Q1) — stays on query `api_token`.
- A create above one room's capacity (Q5) and the shape of a 429 (Q7) not observed yet.
- No endpoint lists bookings (Q8): reservations made outside xcale cannot reach the CRM — still to ask
  integrations@lobbypms.com.
