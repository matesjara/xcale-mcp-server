import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';
import { err, ok, type ToolOutcome } from '../../core/tool';

/**
 * Cadenax error shaping. Every fact here is read from Cadenax's source and OpenAPI on `main`
 * (2026-11-23) — Documented, not yet Observed; `docs/design/cadenax-provider/feature-design.md` §7.
 *
 * A failure is `{ error: "<sentence>", details?: { code: "<MACHINE_CODE>" } }`. The machine code is
 * in `details.code`, never at the root (Cadenax ADR 0026 clause 9), and only the endpoints an
 * integration touches carry one; the rest answer the sentence alone. One endpoint mirrors a code
 * into `error` itself, so a bare machine word there is read as the code.
 *
 * The core's status map is the default, overridden where Cadenax's statuses mean something else:
 *
 * - **401 is the only "reconnect".** Cadenax answers `401 Invalid or expired API key` for a key that
 *   is unknown, revoked or past its expiry — a new key fixes it, so `PROVIDER_AUTH_EXPIRED`.
 * - **403 is never "reconnect".** It is a refusal about what a LIVE key may do: an office outside
 *   its scope, a role without the permission, `API_KEY_READ_ONLY_PURPOSE`, `API_KEY_SCOPE_UNRESOLVED`
 *   (every office the key names is inactive — "rotating the key does not fix this; an office does").
 *   Marking the connection expired would send the owner to re-paste a key that works, so
 *   `PROVIDER_ERROR` rather than the core's default. Pinned by a test.
 * - **423** (`OFFICE_MIGRATION_MIRROR_READ_ONLY`) belongs to writes: the office is read-only while it
 *   is mirrored from Xero. `PROVIDER_ERROR`, with the code, so a consumer can say why.
 * - **503** (`OFFICE_DIRECTORY_UNAVAILABLE`) is transient and keeps the core's `PROVIDER_UNAVAILABLE`.
 *
 * A message carries the operation, the status, Cadenax's code and its own sentence — never the raw
 * body, a URL or a header.
 */

/** A machine code: an upper-case word of letters, digits and underscores — never free text. */
const MACHINE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

/** A key as Cadenax prints it (`cof_live_…`, `cof_dev_…`): never forwarded, whoever echoed it. */
const NAMES_A_KEY = /cof_(live|dev|staging|test)_|x-api-key/i;

const MAX_SENTENCE = 300;

interface CadenaxErrorBody {
  readonly error?: unknown;
  readonly details?: { readonly code?: unknown } | null;
}

/**
 * The error body's fields. The core hands a provider at most the first 500 characters of a failure
 * body, so a long one arrives cut and does not parse; its `code` and `error` are then recovered by
 * pattern, when they arrived whole.
 */
function parseBody(body: string): { code?: string; sentence?: string } {
  let code: unknown;
  let sentence: unknown;
  try {
    const parsed = JSON.parse(body) as CadenaxErrorBody | null;
    if (parsed && typeof parsed === 'object') {
      code = parsed.details?.code;
      sentence = parsed.error;
    }
  } catch {
    code = body.match(/"code"\s*:\s*"([^"]*)"/)?.[1];
    sentence = body.match(/"error"\s*:\s*"([^"]*)"/)?.[1];
  }

  const text = typeof sentence === 'string' ? sentence.trim() : '';
  // The one endpoint that puts its code in `error` (ADR 0026 clause 9).
  const resolvedCode =
    typeof code === 'string' && MACHINE_CODE.test(code)
      ? code
      : MACHINE_CODE.test(text)
        ? text
        : undefined;
  const forwardable =
    text.length > 0 &&
    text.length <= MAX_SENTENCE &&
    !NAMES_A_KEY.test(text) &&
    text !== resolvedCode;

  return {
    ...(resolvedCode ? { code: resolvedCode } : {}),
    ...(forwardable ? { sentence: text } : {}),
  };
}

/** The machine code of a Cadenax error body (`details.code`), if there is one. */
export function cadenaxErrorCode(body: string): string | undefined {
  return parseBody(body).code;
}

/** The typed failure of a call Cadenax refused, with its own code and sentence. */
export function cadenaxFailure(
  res: Extract<RequestResult, { ok: false }>,
  operation: string,
): ToolOutcome {
  const { code, sentence } = parseBody(res.body);
  const message =
    `Cadenax ${operation} failed (HTTP ${res.status}${code ? `, ${code}` : ''})` +
    (sentence ? `: ${sentence}` : '');

  if (res.status === 401) return err(ProviderErrorCode.AUTH_EXPIRED, message);
  if (res.status === 403 || res.status === 423)
    return err(ProviderErrorCode.PROVIDER_ERROR, message);
  return err(res.errorCode, message);
}

/**
 * The one unwrap every Cadenax call goes through. A 2xx body is returned as Cadenax sent it
 * (Fidelity over Unification): its envelopes differ per endpoint and none is reshaped here.
 */
export function unwrapCadenax(res: RequestResult, operation: string): ToolOutcome {
  if (!res.ok) return cadenaxFailure(res, operation);
  if (res.data === null || typeof res.data !== 'object') {
    return err(
      ProviderErrorCode.PROVIDER_ERROR,
      `Cadenax ${operation} returned an unrecognized response shape`,
    );
  }
  return ok(res.data);
}
