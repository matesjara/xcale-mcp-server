import { ProviderErrorCode } from '../../core/errors';
import { mapHttpStatusToErrorCode, type RequestResult } from '../../core/http';

/**
 * SaludTools error shaping. Read this before touching anything that branches on a SaludTools response.
 *
 * ## The HTTP status is only half the answer
 *
 * Every SaludTools response — success or failure — arrives wrapped:
 *
 * ```json
 * { "id": null, "code": 200, "message": "Se consulta la informacion de  id: 2593842",
 *   "eventId": "3eb8d63a93be49d096c51f39b35d7bfd", "body": { } }
 * ```
 *
 * `code` is a field **inside the body of an HTTP 200**. This is the Toteat lesson again: a client that
 * trusts `res.ok` alone will report a failure as a successful call with a meaningless payload. So every
 * call is classified on the transport status AND on the envelope.
 *
 * Unlike Toteat, SaludTools' inner `code` appears to reuse HTTP's own numbers (the documented failures
 * are 400, 401, 404, 405, 412, 500), so the shared status policy is the honest classifier for it and no
 * per-provider table is invented. **Which `code` values actually appear inside a 200 is Q3 — only
 * `200` has ever been seen.** That is why an unrecognized envelope is a failure here rather than a
 * pass-through: if the field is missing or is not a number, we do not know that the call worked, and
 * "we do not know" is not success.
 *
 * ## 412 is this provider's validation error, and the shared map does not know that
 *
 * The vendor documents `412 Precondition Failed` for every input problem: a missing `eventType`, a
 * wrong `actionType`, absent pagination. The core's `mapHttpStatusToErrorCode` sends 412 to
 * `PROVIDER_ERROR` — correct in general, wrong here, and the difference matters: `PROVIDER_INVALID_INPUT`
 * tells the caller it can fix the call, `PROVIDER_ERROR` tells it to give up. This is the one
 * re-classification this adapter makes.
 *
 * ## The mint's bad-credential status is 412, not the 500 the portal claims
 *
 * The vendor's docs say an invalid `key`/`secret` yields `500 Internal Server Error`. Observed
 * 2026-09-21: it yields **`412`**, with the envelope
 * `{"code": 412, "message": "La llave es invalida para generar el token"}`. Worth correcting rather
 * than shrugging at, because the two lead opposite ways — a 500 reads as "the provider is down, try
 * later", a 412 as "that credential is wrong, paste it again", and only one of those gets a clinic
 * connected.
 *
 * Either way it is not handled here: minting lives in Rail A (`credentialDelivery: 'reference'`), so
 * this server never calls that endpoint and the correction belongs to xcale-backend's pinned entry.
 *
 * **A 500 on a DATA call is a real server error** and is classified as one — mapping it to
 * `PROVIDER_AUTH_EXPIRED` would tell a clinic to reconnect a perfectly good ApiKey every time
 * SaludTools has a bad minute.
 *
 * ## SaludTools rate-limits, and documents nothing about it
 *
 * Observed 2026-09-21: seven catalog reads in quick succession returned **`429` with an empty body**.
 * The portal's status table does not mention 429 at all. The shared map already sends it to
 * `PROVIDER_RATE_LIMITED`, so nothing is needed here — but the ceiling is real, it is undiscoverable
 * from the docs, and an agent that fans out reads per turn will find it.
 *
 * ## The vendor's `message` never reaches a tool result
 *
 * `message` is Spanish operator prose that interpolates record ids ("Se consulta la informacion de id:
 * 2593842"). It is provider body text, and provider body text does not go into an error message that
 * reaches an agent's prompt and a patient's chat. `eventId` does travel: it is an opaque correlation
 * id, it identifies the call in the vendor's own logs when we have to ask them, and it carries no
 * patient data.
 */

/**
 * The catalog surface does NOT use the envelope, and it does not use one shape either.
 *
 * Observed 2026-09-21 against production, and none of it matches what the portal implies:
 * - an unpaged catalog answers with a **bare array** — `[{id, name}]` for `documents` and `genders`,
 *   but `[{value, name}]` for `states` and `attentionModality` (a string key, not a numeric id), and
 *   `encounterreasontype` carries a third field, `ripsCode`;
 * - a paged catalog (`treatmenareatype`) answers with a **bare, FLATTENED page** —
 *   `{content, pageNumber, pageSize, totalElements, totalPages}` — with no `code`, and not the full
 *   Spring page the event searches return.
 *
 * `unwrapSaludtools` requires an envelope with a numeric `code`, so it classified that paged catalog
 * as `PROVIDER_ERROR`: every paged catalog read failed. Hence a second unwrap rather than teaching the
 * first one to sniff shapes — the catalog surface genuinely has a different contract, and a function
 * that guesses which contract it is looking at will guess wrong the day a real payload is ambiguous.
 *
 * Nothing is reshaped: both forms travel verbatim (Fidelity over Unification). Two catalogs keying on
 * `value` instead of `id` is the vendor's business, and an adapter that "helpfully" unified them would
 * be inventing ids that no appointment accepts.
 */
export function unwrapSaludtoolsCatalog(res: RequestResult, operation: string): Unwrapped {
  if (!res.ok) {
    return {
      ok: false,
      code: classifySaludtoolsStatus(res.status),
      message: `SaludTools ${operation} failed (HTTP ${res.status})`,
    };
  }

  if (Array.isArray(res.data)) return { ok: true, data: res.data };

  // A flattened page: `content` is the catalog, the rest is paging metadata the caller may want.
  if (res.data !== null && typeof res.data === 'object') {
    const page = res.data as { readonly content?: unknown };
    if (Array.isArray(page.content)) return { ok: true, data: res.data };
  }

  return {
    ok: false,
    code: ProviderErrorCode.PROVIDER_ERROR,
    message: `SaludTools ${operation} returned neither a catalog nor a page (HTTP ${res.status})`,
  };
}

/** The envelope every event response is wrapped in. */
interface SaludtoolsEnvelope {
  readonly id?: unknown;
  readonly code?: unknown;
  readonly message?: unknown;
  readonly eventId?: unknown;
  readonly body?: unknown;
}

export type Unwrapped =
  | { readonly ok: true; readonly data: unknown }
  | {
      readonly ok: false;
      readonly code: ProviderErrorCode;
      readonly message: string;
      /**
       * The vendor's own `message`, for INTERNAL classification only — never forwarded to a caller
       * (see the header: it is Spanish operator prose carrying record ids).
       *
       * It exists because SaludTools reports one thing this adapter has to tell apart from a real
       * failure: **a patient who is not registered comes back as a `412` like a malformed request
       * does** (see `isPatientNotFound`). Nothing else may branch on this field; if a second case
       * needs it, give that case its own predicate here rather than matching prose at a call site.
       */
      readonly detail?: string;
    };

/**
 * Did SaludTools succeed and hand back nothing — i.e. "the record you asked for does not exist"?
 *
 * **This is the primary not-found signal, and it is structural.** Observed 2026-09-21 against
 * production: a lookup for an unregistered document answers `HTTP 200` with
 * `{"code": 200, "message": "No se encontro un paciente con los datos suministrados", "body": null}`.
 * A success. With nothing in it.
 *
 * That is not what the vendor's own documentation shows — its example is a `412` with a different
 * sentence ("Para los datos enviados como filtros, no se ha encontrado un paciente…"). Both are
 * handled, because we have now seen the docs be wrong often enough not to bet on either alone, but
 * the structural one leads: it needs no Spanish prose to match, so it keeps working when the vendor
 * rewords a message, and the two real sentences are already different from each other.
 *
 * Before this existed, a missing patient became `PROVIDER_ERROR` ("returned no record in its envelope
 * body") — the tool telling the agent that SaludTools had malfunctioned, when in fact it had answered
 * the question. The unit tests could not catch it: they were written against the vendor's documented
 * 412, which production does not send.
 */
export function isRecordAbsent(result: Unwrapped): boolean {
  return result.ok && (result.data === null || result.data === undefined);
}

/**
 * Does this failure mean "that person is not in the clinic's records"?
 *
 * SaludTools answers a patient lookup for an unknown document with `code: 412` and the message
 * *"Para los datos enviados como filtros, no se ha encontrado un paciente en nuestra base de datos…"* —
 * the same code it uses for a missing `eventType` or an unsupported HTTP verb. Left alone, that maps
 * to `PROVIDER_INVALID_INPUT`, which tells the caller it built a bad request.
 *
 * It did not. The request was fine and the answer is "nobody by that document". For the agent those
 * are opposite situations: one means fix the call, the other means offer to register the patient. An
 * agent told "invalid input" about a perfectly good lookup is an agent that will either retry the
 * same call or invent an explanation for the user — and the closed error set has no NOT_FOUND code to
 * carry the difference, so the distinction has to be made here.
 *
 * Matching the vendor's prose is not something to enjoy, and it is the only signal offered; the
 * precedent is `toteat/errors.ts`, which classifies the same way for the same reason. It is
 * deliberately narrow: two anchors from the documented sentence, accent- and case-insensitive. If the
 * vendor rewords it, the marker stops matching and the call degrades to `PROVIDER_INVALID_INPUT` —
 * the behaviour we have today, not a new failure. A test pins the documented sentence.
 */
export function isPatientNotFound(result: Unwrapped): boolean {
  if (result.ok || result.detail === undefined) return false;
  const text = result.detail.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // TWO sentences, because the vendor uses two for the same condition: the one its docs show on a
  // 412, and the one production actually sends on a 200. They share no useful substring, so both are
  // matched rather than one clever anchor — a narrower match fails silently and tells an agent it
  // made a bad call.
  return (
    text.includes('no se ha encontrado un paciente') ||
    text.includes('no se encontro un paciente') ||
    // A third wording, from the clinical modules (Observed 2026-09-22): "No existe paciente con ese
    // tipo y numero de documentacion en la compañia". Three sentences for one condition is the
    // vendor's habit, not an accident, so this list grows rather than getting cleverer.
    text.includes('no existe paciente')
  );
}

/**
 * SaludTools' status policy: the shared map, plus the one thing it cannot know — that this provider
 * reports every input problem as `412`.
 *
 * Applied to both the transport status and the envelope's inner `code`, because the vendor uses the
 * same numbers in both places.
 */
export function classifySaludtoolsStatus(status: number): ProviderErrorCode {
  if (status === 412) return ProviderErrorCode.INVALID_INPUT;
  return mapHttpStatusToErrorCode(status);
}

/**
 * Best-effort parse of an error body into the envelope. Returns `null` for anything that is not a
 * JSON object — a bare string (the documented 401), HTML from a gateway, a truncated body (the core
 * caps an error body at 500 characters, and a rejected clinical payload could exceed that).
 */
function parseEnvelope(body: string): SaludtoolsEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as SaludtoolsEnvelope)
      : null;
  } catch {
    return null;
  }
}

/** `eventId` if it is a usable string — the only part of the envelope safe to quote back. */
function correlation(env: SaludtoolsEnvelope | null): string {
  return typeof env?.eventId === 'string' && env.eventId.length > 0
    ? ` [eventId ${env.eventId}]`
    : '';
}

/**
 * The single unwrap every SaludTools tool goes through.
 *
 * `operation` is a stable label (the tool's verb). On success the caller gets the envelope's inner
 * `body` verbatim — the envelope is transport, the `body` is the record, and the record is never
 * reshaped (Fidelity over Unification, ADR 0009). Per-tool field curation happens in `tools.ts`, where
 * each tool decides what its job needs; it is not this function's business.
 */
export function unwrapSaludtools(res: RequestResult, operation: string): Unwrapped {
  if (!res.ok) {
    /*
     * A transport failure still carries the envelope — and reading it is not optional.
     *
     * The core hands a non-2xx back as `body: string` (unparsed) rather than `data`, so the first
     * version of this function stopped here and never looked inside. That quietly broke the one
     * distinction this adapter exists to make: SaludTools answers an unknown patient with a REAL
     * HTTP 412 whose body is the envelope, so `isPatientNotFound` had nothing to match on and
     * `get_patient` reported "invalid input" for a perfectly good lookup. The tests caught it; a
     * reviewer would not have.
     *
     * The status is still the classifier — the envelope's `code` mirrors it — and the parse is
     * best-effort, because a 401 answers with a bare JSON string and a gateway may answer with HTML.
     */
    const env = parseEnvelope(res.body);
    return {
      ok: false,
      code: classifySaludtoolsStatus(res.status),
      message: `SaludTools ${operation} failed (HTTP ${res.status})${correlation(env)}`,
      ...(typeof env?.message === 'string' ? { detail: env.message } : {}),
    };
  }

  // Kept as a safety net, not as the catalog path: catalogs go through `unwrapSaludtoolsCatalog`.
  // An event response has never been observed as a bare array, and if one ever is, a top-level array
  // is a self-evident success with no `code` to check — better passed through than called an error.
  if (Array.isArray(res.data)) {
    return { ok: true, data: res.data };
  }

  const env = (typeof res.data === 'object' ? res.data : null) as SaludtoolsEnvelope | null;
  if (env === null) {
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: `SaludTools ${operation} returned an unrecognized response shape (HTTP ${res.status})`,
    };
  }

  const code = env.code;
  if (typeof code !== 'number') {
    // No inner code at all. Not classifiable as success — see the header.
    return {
      ok: false,
      code: ProviderErrorCode.PROVIDER_ERROR,
      message: `SaludTools ${operation} returned no status code in its envelope (HTTP ${res.status})${correlation(env)}`,
    };
  }

  if (code < 200 || code > 299) {
    return {
      ok: false,
      code: classifySaludtoolsStatus(code),
      message: `SaludTools ${operation} was rejected (code ${code})${correlation(env)}`,
      // Internal only — see `Unwrapped.detail`. It never reaches `message`.
      ...(typeof env.message === 'string' ? { detail: env.message } : {}),
    };
  }

  return { ok: true, data: env.body };
}
