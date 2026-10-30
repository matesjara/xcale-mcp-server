import type { ProviderAuthDescriptor } from '../../core/provider-port';

/**
 * HotelSync authenticates with a SESSION LOGIN: `POST /api/user/auth/login` with the partner `token`, a
 * HotelSync user's `username` and `password` returns a session key `pkey`. Every data call is a POST whose
 * JSON body carries `token`, `key` (the `pkey`) and `id_properties`.
 *
 * ADR `credential-exchange-session-key-in-body` (the CTO's decision on #187):
 * - `credential_exchange` + `reference`: the Credential Authority (the consumer's Rail A) logs in and keeps
 *   the session; this server only ever receives the session key and the partner token, per call.
 * - `tokenPlacement: 'body'` as `key`, and the partner token as a body companion placed as `token`.
 * - No `responseFields.expiry`: HotelSync declares no session lifetime, so the Authority reuses the session
 *   until a data call answers 401 "Session key invalid".
 *
 * `bodyFields` and `bodyCompanions` are wire field NAMES, never values (ADR 0020). The token endpoint is
 * production's; the consumer pins its own mint host (staging or production) — a session from one host does
 * not work on the other, so it must match this server's `HOTELSYNC_BASE_URL`.
 *
 * Observed 2026-10-30: the login answers `401 Invalid username/password` before it judges the partner token,
 * on both hosts (`docs/design/hotelsync-provider/ship-log.md`).
 */
export const hotelsyncAuth: ProviderAuthDescriptor = {
  type: 'credential_exchange',
  credentialDelivery: 'reference',
  tokenEndpoint: 'https://app.hotelsync.com/api/user/auth/login',
  method: 'POST',
  bodyFields: { partnerToken: 'token', username: 'username', password: 'password' },
  responseFields: { token: 'pkey' },
  tokenPlacement: 'body',
  tokenBodyField: 'key',
  bodyCompanions: { partnerToken: 'token' },
};
