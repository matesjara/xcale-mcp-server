import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';
import { err, ok, type ToolOutcome } from '../../core/tool';

/**
 * HotelSync's known plain-text error messages, each mapped to a fixed explanation. Its error bodies are
 * plain text (`Session key invalid`, `No access to property`), so this matches the known ones instead of
 * echoing the body — an unknown body is never interpolated (CTO decision on #187).
 */
const KNOWN_MESSAGES: ReadonlyArray<readonly [RegExp, string]> = [
  [/session key invalid/i, 'the session ended'],
  [/no access to property/i, 'this user or token cannot access the connected property'],
  [/read.?only/i, 'the partner token has read-only access'],
  [/suspended|expired/i, 'the HotelSync account is suspended or expired'],
];

function knownReason(body: string): string | undefined {
  return KNOWN_MESSAGES.find(([pattern]) => pattern.test(body))?.[1];
}

/**
 * The single unwrap every HotelSync tool goes through.
 *
 * - 401 (`Session key invalid`) → `PROVIDER_AUTH_EXPIRED`: the consumer drops its cached session, logs in
 *   again and retries once; only a rejected login asks to reconnect (ADR
 *   `credential-exchange-session-key-in-body`).
 * - 403 → `PROVIDER_AUTH_EXPIRED` on a read: an unknown token, a token that lost access or a property the
 *   user cannot reach are all fixed by re-entering the connection. On a WRITE (`write: true`), a read-only
 *   partner token is a capability fact, not a dead credential — `PROVIDER_ERROR`, so the connection is not
 *   marked expired.
 * - Anything else keeps the core's status mapping.
 *
 * A 2xx `data` is returned verbatim (Fidelity over Unification).
 */
export function unwrapHotelSync(
  res: RequestResult,
  operation: string,
  opts: { readonly write?: boolean } = {},
): ToolOutcome {
  if (res.ok) return ok(res.data);
  const reason = knownReason(res.body);
  const message = `HotelSync ${operation} failed (HTTP ${res.status})${reason ? ` — ${reason}` : ''}`;
  if (res.status === 403 && opts.write && reason === 'the partner token has read-only access') {
    return err(ProviderErrorCode.PROVIDER_ERROR, message);
  }
  return err(res.errorCode, message);
}
