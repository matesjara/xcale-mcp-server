import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';
import { err, ok, type ToolOutcome } from '../../core/tool';

/**
 * LobbyPMS error shaping.
 *
 * LobbyPMS reports failure with an HTTP status (Documented: 400, 401, 403, 404, 422, 500, 503) and,
 * for business refusals, a JSON body `{ "error_code": "<MACHINE_CODE>", "error" | "code": "<text>" }`.
 * The core's status map is the default; it is overridden in ONE narrow case:
 *
 * **A documented business code is never "reconnect".** `cancel-booking` documents
 * `UNAUTHORIZED_BOOKING` ("the booking was not created through the API"). Whatever status it rides
 * on, it is a refusal a reconnect cannot fix — mapped to `PROVIDER_AUTH_EXPIRED` it would flip a
 * working connection to "reconnect required" for every tenant who asked to cancel a front-desk
 * booking. So a body naming a code in `BUSINESS_CODES` is `PROVIDER_ERROR` (or `INVALID_INPUT` for
 * `INPUT_PARAMETERS`), never the status's default.
 *
 * **An unauthorized caller IP is not "reconnect" either** (Observed 2026-10-15, a valid token from an
 * IP the property had not added): `403` with the body `["the <ip> trying to access the API is not set
 * as a valid ip"]` — a bare JSON array, no `error_code`. Re-pasting the token cannot fix it; the
 * property has to authorize the IP. So it is `PROVIDER_ERROR` with the synthesized machine code
 * `IP_NOT_AUTHORIZED` in the message, which a consumer can tell apart from a business "no".
 *
 * A 401 keeps the core's `PROVIDER_AUTH_EXPIRED`: Observed, a bad or missing token is
 * `401 {"error":"Unauthenticated."}` on every route, and a new token is the fix.
 *
 * The machine code (and only the machine code) is put in the message, so the consumer can tell
 * `RECORD_NOT_FOUND` from `BOOKING_CHECK_IN_COMPLETE`. The provider's free text is not: it is
 * untranslated and not ours to forward to a guest.
 */

/** Documented business codes (create-customer, cancel-booking). Additive as LobbyPMS shows more. */
const BUSINESS_CODES: ReadonlySet<string> = new Set([
  'INPUT_PARAMETERS',
  'RECORD_NOT_FOUND',
  'UNAUTHORIZED_BOOKING',
  'BOOKING_CHECK_IN_COMPLETE',
  'RESTRICTED_RESERVATION',
]);

/** A machine code: upper-case words joined by underscores — never free text. */
const MACHINE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

/** Read `error_code` out of an error body, if the body is JSON and the value is a machine code. */
export function lobbyErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error_code?: unknown };
    const code = parsed?.error_code;
    return typeof code === 'string' && MACHINE_CODE.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

/** The code this server gives LobbyPMS's refusal of an unauthorized caller IP (Observed, 403). */
export const IP_NOT_AUTHORIZED = 'IP_NOT_AUTHORIZED';

/** Is this error body LobbyPMS saying the caller's IP is not authorized? Matched on its own words. */
export function isIpRefusal(body: string): boolean {
  return /not set as a valid ip/i.test(body);
}

function classify(res: Extract<RequestResult, { ok: false }>, code: string | undefined) {
  if (code === IP_NOT_AUTHORIZED) return ProviderErrorCode.PROVIDER_ERROR;
  if (code === 'INPUT_PARAMETERS') return ProviderErrorCode.INVALID_INPUT;
  if (code !== undefined && BUSINESS_CODES.has(code)) return ProviderErrorCode.PROVIDER_ERROR;
  return res.errorCode;
}

/**
 * The single unwrap every LobbyPMS tool goes through. `operation` is a stable label (the tool's
 * verb). The request URL — which carries `api_token` — is never touched here.
 *
 * `byId` marks a read of one record by its id. Observed 2026-10-16: an unknown booking id is a 404
 * with an HTML "Page Not Found" body and no `error_code` — so on such a read (and only there, where
 * the route itself is known to exist) a bare 404 is named `RECORD_NOT_FOUND`, the documented code.
 */
export function unwrapLobby(
  res: RequestResult,
  operation: string,
  opts: { byId?: boolean } = {},
): ToolOutcome {
  if (!res.ok) {
    const code = isIpRefusal(res.body)
      ? IP_NOT_AUTHORIZED
      : (lobbyErrorCode(res.body) ??
        (opts.byId && res.status === 404 ? 'RECORD_NOT_FOUND' : undefined));
    return err(
      classify(res, code),
      `LobbyPMS ${operation} failed (HTTP ${res.status}${code ? `, ${code}` : ''})`,
    );
  }
  return ok(res.data);
}
