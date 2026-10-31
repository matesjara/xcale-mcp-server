import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

/**
 * SiteMinder Direct Booking error shaping.
 *
 * ## The body shape is not settled — parse all three
 *
 * SiteMinder publishes three different error bodies for the same API
 * (`docs/design/siteminder-provider/design-notes.md` §1, D8):
 *
 * - the reference pages: `{"errors":[{"name":"NotAuthorised","message":"…","meta"?:{}}]}`;
 * - the quick start: `{"errors":[{"code":"RateLimited","message":"…"}]}` for a 429, and a flat
 *   `{"error":"Unauthorized","message":"Invalid API key"}` for a 401;
 * - the old YAML: a flat `{"name":"UnauthorizedError","message":"…"}`.
 *
 * Until one live call settles it (open question Q2), the identifier is read from whichever is there.
 * Only that identifier reaches the error text — never SiteMinder's `message` (their own rule: "Do not
 * surface raw API error messages to guests", and our gates' rule: status and code only).
 *
 * ## 401 and 403 keep the core's mapping: reconnect
 *
 * `401` is observed (E1, E2): a key that no longer works. `403 AccessDenied` is documented only, and
 * how SiteMinder answers a key the hotel has *revoked* is not observed. Until a live 403 is recorded
 * (design-notes Q2), both stay `PROVIDER_AUTH_EXPIRED` (ADR 0007): the connection is marked for
 * reconnect, which is also the fix for a key that cannot see the pasted property — reconnecting
 * with the right key or Property ID. Hiding a revocation behind `PROVIDER_ERROR` would leave the
 * hotel's agent silently broken. If a 403 turns out to mean something a reconnect cannot fix, the
 * override is narrow and keyed on the observed identifier, as Cloudbeds' is.
 */

type ErrorItem = { readonly name?: unknown; readonly code?: unknown };
interface SiteminderErrorBody {
  readonly errors?: readonly ErrorItem[];
  readonly name?: unknown;
  readonly error?: unknown;
}

export type Unwrapped =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

/**
 * An identifier is a short word like `RateLimited` or `NotAuthorised`: letters only. Digits, hyphens
 * and dots are refused so that nothing shaped like a key or a uuid can reach the error text, even if
 * SiteMinder ever echoed one into these fields.
 */
const IDENTIFIER = /^[A-Za-z]{1,40}$/;

function asIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && IDENTIFIER.test(value) ? value : undefined;
}

/** SiteMinder's own error identifier, from whichever documented body shape came back. */
export function siteminderErrorName(body: string): string | undefined {
  let parsed: SiteminderErrorBody;
  try {
    parsed = JSON.parse(body) as SiteminderErrorBody;
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  const first = Array.isArray(parsed.errors) ? parsed.errors[0] : undefined;
  return (
    asIdentifier(first?.name) ??
    asIdentifier(first?.code) ??
    asIdentifier(parsed.name) ??
    asIdentifier(parsed.error)
  );
}

/**
 * The single unwrap every SiteMinder tool goes through. The statuses are honest (401, 403, 404, 429,
 * 500 are all documented), so a transport `!ok` is authoritative; a 2xx `data` is the verbatim payload
 * (Fidelity over Unification).
 */
export function unwrapSiteminder(res: RequestResult, operation: string): Unwrapped {
  if (!res.ok) {
    const name = siteminderErrorName(res.body);
    return {
      ok: false,
      code: res.errorCode,
      message: name
        ? `SiteMinder ${operation} failed (HTTP ${res.status}, ${name})`
        : `SiteMinder ${operation} failed (HTTP ${res.status})`,
    };
  }
  if (res.data === null || res.data === undefined) {
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: `SiteMinder ${operation} returned an empty response`,
    };
  }
  return { ok: true, data: res.data };
}
