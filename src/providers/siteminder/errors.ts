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
 * ## 403 is not "reconnect"
 *
 * `401 NotAuthorised` is a key that no longer works — revoked, or never valid — and only a new key
 * fixes it: `PROVIDER_AUTH_EXPIRED`. `403 AccessDenied` is a key that works but may not see this
 * property, or a property whose Direct Booking subscription is not active. A reconnect with the same
 * key fixes neither, and flipping the connection to "reconnect required" would send the owner to
 * re-paste a key that is fine. So 403 is `PROVIDER_ERROR` — the consumer's connect-time probe still
 * refuses a pasted key that cannot see the pasted property, because the probe fails either way.
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

/** An identifier is a short token like `RateLimited`, never free text. Anything else is dropped. */
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

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

/** Status → code, where SiteMinder's statuses need a different answer than the core's default. */
export function classifySiteminderStatus(
  status: number,
  fallback: ProviderErrorCode,
): ProviderErrorCode {
  if (status === 403) return ProviderErrorCode.PROVIDER_ERROR;
  return fallback;
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
      code: classifySiteminderStatus(res.status, res.errorCode),
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
