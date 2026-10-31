import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';
import { err, ok, type ToolOutcome } from '../../core/tool';

/**
 * Avirato error shaping (the contract's §D, every case Observed on production 2026-10-30).
 *
 * A 2xx answer is Avirato's envelope `{ status: "success", data }`; the tool returns `data` verbatim
 * (Fidelity over Unification). A failure is `{ statusCode, timestamp, path, errorCode, message, errors? }`.
 * The core's status map is the default, overridden where the body says more:
 *
 * - **403 is not "reconnect".** It is a permission the API user lacks in the hotel's back-office; a fresh
 *   mint cannot fix it, so `PROVIDER_ERROR` rather than the core's `PROVIDER_AUTH_EXPIRED`. A 401 keeps
 *   `PROVIDER_AUTH_EXPIRED`: a rejected or superseded token (a second login invalidates the first) is
 *   fixed by a fresh mint.
 * - **`ERROR_RETRIEVING_RESERVATIONS` is "not found or cancelled"**, though it rides a 400: `PROVIDER_ERROR`
 *   with a plain reason, so a consumer does not read it as bad input.
 * - **Validation refusals** (`INPUT_DATA_VALIDATION_FAILED`, `ERROR_VALIDATING_DATA`) are
 *   `PROVIDER_INVALID_INPUT`, and the message carries Avirato's validation sentences: they name the
 *   parameter and the rule ("start_date must be a valid ISO 8601 date string"), never a value.
 *
 * Only the machine code and those validation sentences are put in a message. Avirato's `path` echoes the
 * request URL and is never forwarded.
 */

/** A machine code: a word of letters, digits and underscores — never free text. */
const MACHINE_CODE = /^[A-Za-z][A-Za-z0-9_]{2,63}$/;

/** Avirato's answer for a reservation id that is cancelled or does not exist, or an unknown client. */
export const NOT_FOUND_CODE = 'ERROR_RETRIEVING_RESERVATIONS';
/** The same "not found or cancelled", as a modify answers it (observed on a cancelled reservation). */
const NOT_FOUND_CODES: ReadonlySet<string> = new Set([NOT_FOUND_CODE, 'ERROR_RETRIEVING_DATA']);

const VALIDATION_CODES: ReadonlySet<string> = new Set([
  'INPUT_DATA_VALIDATION_FAILED',
  'ERROR_VALIDATING_DATA',
]);

interface AviratoErrorBody {
  readonly errorCode?: unknown;
  readonly message?: unknown;
  readonly errors?: unknown;
}

/**
 * The error body's fields. Avirato's body is JSON, but the core's transport hands a provider at most its
 * first 500 characters, and a body with a long `errors[]` before its `errorCode` arrives cut mid-array
 * (review of #190). When it does not parse, the fields are recovered by pattern: the `errorCode`, the
 * `message`, and the `errors[]` sentences that arrived whole.
 */
function parseBody(body: string): AviratoErrorBody {
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as AviratoErrorBody) : {};
  } catch {
    const field = (name: string) => body.match(new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`))?.[1];
    const list = body.match(/"errors"\s*:\s*\[([^\]]*)/)?.[1];
    return {
      errorCode: field('errorCode'),
      message: field('message'),
      errors: list === undefined ? undefined : [...list.matchAll(/"([^"]*)"/g)].map((m) => m[1]),
    };
  }
}

/** The machine `errorCode` of an Avirato error body, if there is one. */
export function aviratoErrorCode(body: string): string | undefined {
  const code = parseBody(body).errorCode;
  return typeof code === 'string' && MACHINE_CODE.test(code) ? code : undefined;
}

/**
 * A validation sentence safe to forward. Every one observed is plain words about a parameter
 * ("charges must be a boolean value", "Cannot set quantity when modifying.", "each value in rateIds
 * must be a number conforming to the specified constraints"). Anything else — quotes, braces, colons,
 * slashes, or a word naming a credential — is not what Avirato's validator writes, and could be an echo
 * of the request; it is dropped rather than forwarded.
 */
const PLAIN_SENTENCE = /^[A-Za-z0-9 .,_()'-]{1,200}$/;
const NAMES_A_CREDENTIAL = /bearer|authori[sz]ation|password|token|eyJ/i;

/** A sentence says something: at least two words of letters, not a stray `, ` or `.`. */
const HAS_WORDS = /[A-Za-z]{2,}.*\s.*[A-Za-z]{2,}/;

function forwardable(sentence: string): boolean {
  return (
    PLAIN_SENTENCE.test(sentence) && HAS_WORDS.test(sentence) && !NAMES_A_CREDENTIAL.test(sentence)
  );
}

/** Avirato's validation sentences (`errors[]`, or the `message` of `ERROR_VALIDATING_DATA`). */
function validationMessages(body: string, code: string): string[] {
  const parsed = parseBody(body);
  const candidates = Array.isArray(parsed.errors)
    ? parsed.errors
    : code === 'ERROR_VALIDATING_DATA'
      ? [parsed.message]
      : [];
  return candidates.filter((e): e is string => typeof e === 'string' && forwardable(e));
}

export function unwrapAvirato(res: RequestResult, operation: string): ToolOutcome {
  if (res.ok) return ok((res.data as { data?: unknown } | null)?.data);

  const code = aviratoErrorCode(res.body);
  const label = `Avirato ${operation} failed (HTTP ${res.status}${code ? `, ${code}` : ''})`;

  if (code && NOT_FOUND_CODES.has(code)) {
    return err(ProviderErrorCode.PROVIDER_ERROR, `${label}: not found or cancelled`);
  }
  // A body cut by the transport can lose its `errorCode` but keep the validation sentences before it:
  // a 400 that still carries `errors[]` is a validation refusal.
  const truncatedValidation =
    !code && res.status === 400 && Array.isArray(parseBody(res.body).errors);
  if ((code && VALIDATION_CODES.has(code)) || truncatedValidation) {
    const reasons = validationMessages(res.body, code ?? 'INPUT_DATA_VALIDATION_FAILED');
    return err(
      ProviderErrorCode.INVALID_INPUT,
      reasons.length > 0 ? `${label}: ${reasons.join('; ')}` : label,
    );
  }
  if (res.status === 403) return err(ProviderErrorCode.PROVIDER_ERROR, label);
  return err(res.errorCode, label);
}
