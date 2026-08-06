import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

/**
 * Toteat error shaping. Read this before touching anything that branches on a Toteat response.
 *
 * ## The status code tells you nothing
 *
 * Verified against the live API (2026-08-05): Toteat answers **HTTP 200 with `ok:false`** for an
 * invalid token, an invalid date, an over-wide window, an unknown order and a nonexistent venue.
 * `429` is the ONLY error status it emits. The pinned OpenAPI spec documents a
 * `400 InvalidCredentials` with a root-level `{ texto }`; that response does not exist.
 *
 * So `mapHttpStatusToErrorCode` never fires for anything that matters, and a client that trusts
 * `res.ok` reports a dead token as a successful call with `data: undefined`. Classification happens
 * on the **envelope**.
 *
 * ## "Not Authorized" is ambiguous, and mapping it to AUTH_EXPIRED would be an incident
 *
 * `GET /fiscaldocuments` with a **valid** token returns
 * `{"msg":{"texto":"Not Authorized","tipo":7},"ok":false}` — byte-identical to an invalid token. The
 * cause is the POS *Seguridad* tab, which allow-lists which routes an API entry may consume.
 *
 * If that mapped to `PROVIDER_AUTH_EXPIRED`, one disabled route would flip the whole connection to
 * "reconnect required" and the tenant would be told to re-authorize something that works perfectly.
 * Telling them apart needs a second call to a route we know works — and this server is stateless, so
 * it is not ours to make. It surfaces as `PROVIDER_ERROR`; the consumer re-runs the manifest's
 * `connectionProbe` and decides.
 *
 * **This adapter never returns `PROVIDER_AUTH_EXPIRED`.** That is deliberate, and a test pins it.
 *
 * ## `tipo` is not a discriminator
 *
 * `7` accompanies both `"Not Authorized"` and `"INVALID ORDER NUMBER"`; `0` accompanies success. It
 * means "this is an error", nothing more.
 */

/** Toteat's envelope. `msg` is an object, a string, or absent — all three observed on live calls. */
interface ToteatEnvelope {
  readonly ok?: boolean;
  readonly msg?: string | { texto?: string; tipo?: number };
  readonly data?: unknown;
  readonly status_code?: number;
}

export type Unwrapped =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

/** The exact text Toteat returns for both a dead token and a route the venue has not enabled. */
const NOT_AUTHORIZED = 'not authorized';

/** Pull the human-readable control message out of whichever envelope shape came back. */
export function toteatMessage(body: unknown): string | undefined {
  const msg = (body as ToteatEnvelope | null)?.msg;
  if (typeof msg === 'string') return msg;
  if (msg && typeof msg === 'object' && typeof msg.texto === 'string') return msg.texto;
  return undefined;
}

/**
 * Classify an `ok:false` envelope. Deliberately conservative: anything unrecognized stays
 * `PROVIDER_ERROR` rather than being mislabeled as something the caller might act on.
 */
export function classifyToteatFailure(body: unknown): ProviderErrorCode {
  const message = toteatMessage(body);
  if (message === undefined) {
    // `{"ok":false}` with no message at all — observed for a nonexistent venue id. Genuinely
    // ambiguous, so it gets the code that promises nothing.
    return ProviderErrorCode.PROVIDER_ERROR;
  }
  const m = message.toLowerCase();

  // Route denied OR credential dead — indistinguishable here, so never AUTH_EXPIRED. See the header.
  if (m.includes(NOT_AUTHORIZED)) return ProviderErrorCode.PROVIDER_ERROR;

  // Caller-fixable input: the date family. These are the only messages Toteat returns as a bare
  // string rather than a `{texto}` object, but matching on the text (not the shape) is what keeps
  // this honest if that ever changes.
  if (
    m.includes('valid format') ||
    m.includes('maximum period') ||
    m.includes('higher or equal') ||
    m.includes('invalid order number')
  ) {
    return ProviderErrorCode.INVALID_INPUT;
  }

  if (m.includes('too many requests') || m.includes('rate limit')) {
    return ProviderErrorCode.RATE_LIMITED;
  }

  return ProviderErrorCode.PROVIDER_ERROR;
}

/**
 * The single unwrap every Toteat tool goes through. Checks the transport AND the envelope, because
 * only one of the two ever reports a failure honestly.
 *
 * `operation` is a stable label (the tool's verb) used to build the error message. The response body
 * is never interpolated beyond its own control message, and the request URL — which carries
 * `xapitoken` — is never touched here at all.
 */
export function unwrapToteat(res: RequestResult, operation: string): Unwrapped {
  if (!res.ok) {
    // 429 arrives here as a real status; everything else that lands here is transport or 5xx.
    const code = res.status === 429 ? ProviderErrorCode.RATE_LIMITED : res.errorCode;
    return { ok: false, code, message: `Toteat ${operation} failed (HTTP ${res.status})` };
  }

  const body = res.data as ToteatEnvelope | null;
  if (body?.ok === false) {
    return {
      ok: false,
      code: classifyToteatFailure(body),
      message: toteatMessage(body) ?? `Toteat ${operation} returned ok=false`,
    };
  }

  // A 200 that is not an envelope at all is not a success we can vouch for.
  if (body === null || typeof body !== 'object' || body.ok !== true) {
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: `Toteat ${operation} returned an unrecognized response shape`,
    };
  }

  return { ok: true, data: body.data };
}
