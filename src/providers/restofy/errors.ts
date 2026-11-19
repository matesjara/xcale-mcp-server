import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';
import { err, ok, type ToolOutcome } from '../../core/tool';

/** Restofy's envelope on every answer: `{ success, message, data }` (observed). */
interface Envelope {
  readonly success?: unknown;
  readonly message?: unknown;
  readonly data?: unknown;
}

const GENERIC = 'Restofy refused the request';

/**
 * Something Restofy's messages never carry, and an echo of the request could: braces, a URL, a bearer,
 * a `token=` or `key=` pair. Every message observed (contract §A.3) is a plain sentence for a person.
 */
const UNSAFE = /[{}]|http|bearer|token=|key=/i;
const MAX_MESSAGE = 300;

/** A message safe to hand the agent: Restofy's own sentence, or nothing. */
export function safeMessage(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const message = raw.trim();
  if (message.length === 0 || message.length > MAX_MESSAGE || UNSAFE.test(message))
    return undefined;
  return message;
}

/** Restofy's `message` from an error body, if the (≤500-char) body parses and the message is safe. */
function messageOf(body: string): string | undefined {
  try {
    return safeMessage((JSON.parse(body) as Envelope).message);
  } catch {
    return undefined;
  }
}

/**
 * True when Restofy refused with a 400 whose sentence starts with `prefix`. Restofy has no error codes,
 * so its own words are the only way to tell "not found" from any other refusal (contract §A.3).
 */
export function refusedWith(result: RequestResult, prefix: string): boolean {
  return !result.ok && result.status === 400 && (messageOf(result.body) ?? '').startsWith(prefix);
}

/**
 * The error code for a failed status. The core's map is the default, with one override: a 403 is a
 * permission the key's user lacks in Restofy's panel, which a fresh mint or a reconnect cannot fix, so
 * `PROVIDER_ERROR` rather than the core's `PROVIDER_AUTH_EXPIRED`. A 401 keeps `PROVIDER_AUTH_EXPIRED`.
 */
function codeFor(result: Extract<RequestResult, { ok: false }>): ProviderErrorCode {
  return result.status === 403 ? ProviderErrorCode.PROVIDER_ERROR : result.errorCode;
}

/**
 * A Restofy answer as a tool outcome: `data` verbatim on success (Fidelity over Unification). Restofy has
 * no error codes, only `success: false` and a sentence for a person (contract §D), which is forwarded when
 * it is safe. A 200 that says `success: false` is not a success.
 */
export function toOutcome(result: RequestResult): ToolOutcome {
  if (!result.ok) return err(codeFor(result), messageOf(result.body) ?? GENERIC);
  const envelope = (result.data ?? {}) as Envelope;
  if (envelope.success === false) {
    return err(ProviderErrorCode.PROVIDER_ERROR, safeMessage(envelope.message) ?? GENERIC);
  }
  return ok(envelope.data);
}
