import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';

export type Unwrapped =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

/**
 * Unwrap a HiMed Demográficos response.
 *
 * Unlike Autoagendamiento, Demográficos uses **real HTTP status codes**: `201` success, `207` a
 * non-blocking optional-field warning (still 2xx → success), and `401/406/417/404` errors. The generic
 * `mapHttpStatusToErrorCode` only routes `400/422` to `INVALID_INPUT`, so we refine the caller-fixable
 * Demográficos codes (`406/417/404`) here; `401` stays `AUTH_EXPIRED`, `5xx`/transport stay
 * `PROVIDER_UNAVAILABLE`.
 *
 * An already-existing patient comes back `400` + `"El paciente ya existe en HiMed Web"` (sandbox-verified
 * 2026-10-05) — that is the idempotent success create_patient promises, so it maps to ok with a
 * PHI-free envelope (the provider body echoes `datos_paciente`, which we drop). ONLY when the caller
 * opts in with `existsIsSuccess`: for any other Demográficos write "already exists" means the write did
 * NOT happen (e.g. a document change onto another patient's number) and must stay an error.
 *
 * A validation `400` names the rejected fields in `campos_fallidos` (`{ primer_apellido: "...no cumple
 * parámetros" }`, sandbox 2026-10-06). Those go in the message — field names and HiMed's own
 * validation text, never a submitted value — so the agent can ask the patient for THAT field instead
 * of guessing. Otherwise the message carries status + operation only — never the body (PHI).
 */
function failedFields(body: string): string {
  const inner = /"campos_fallidos"\s*:\s*\{([^{}]*)\}/.exec(body)?.[1];
  if (!inner) return '';
  try {
    const fields = JSON.parse(`{${inner}}`) as Record<string, unknown>;
    return Object.entries(fields)
      .map(([field, why]) => `${field} (${String(why).trim()})`)
      .join('; ');
  } catch {
    return '';
  }
}

export function unwrapHimed(
  res: RequestResult,
  operation: string,
  opts: { readonly existsIsSuccess?: boolean } = {},
): Unwrapped {
  if (!res.ok) {
    // The transport caps error bodies at 500 chars and this one echoes the whole patient record, so
    // the JSON arrives truncated: read the leading `mensaje` field off the raw text instead of parsing.
    const mensaje = /"mensaje"\s*:\s*"([^"]*)"/.exec(res.body)?.[1];
    if (
      opts.existsIsSuccess &&
      res.status === 400 &&
      (mensaje ?? '').toLowerCase().includes('ya existe')
    ) {
      return { ok: true, data: { estado: 'exists', mensaje } };
    }
    const code =
      res.status === 406 || res.status === 417 || res.status === 404
        ? ProviderErrorCode.INVALID_INPUT
        : res.errorCode;
    const fields = failedFields(res.body);
    return {
      ok: false,
      code,
      message: fields
        ? `HiMed ${operation} rejected fields: ${fields}`
        : `HiMed ${operation} failed (HTTP ${res.status})`,
    };
  }
  // 2xx (201 / 207): the provider body is a plain status envelope ({ estado, mensaje }) with no PHI.
  return { ok: true, data: res.data };
}

/** Pull a named array out of an `{ estado, <key>: [...] }` HiMed directory envelope. */
export function envelopeRows(data: unknown, key: string): ReadonlyArray<Record<string, unknown>> {
  const arr = (data as Record<string, unknown> | null)?.[key];
  return Array.isArray(arr) ? (arr as Array<Record<string, unknown>>) : [];
}

/**
 * Unwrap a HiMed Autoagendamiento response (sandbox-verified). HiMed overloads `401` for both a bad
 * token AND validation errors, and a 2xx can carry a captured error, so classification is by the body
 * message (only token-related → AUTH_EXPIRED; every other `estado:'error'`/`success:false` →
 * INVALID_INPUT). The message carries the provider control string (`mensaje`), never the data (PHI).
 */
interface HimedEnvelope {
  readonly estado?: string;
  readonly success?: boolean;
  readonly mensaje?: string;
}

function parseBody(raw: unknown): HimedEnvelope | null {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as HimedEnvelope;
    } catch {
      return null;
    }
  }
  return raw !== null && typeof raw === 'object' ? (raw as HimedEnvelope) : null;
}

function classifyScheduling(mensaje: string | undefined): ProviderErrorCode {
  return (mensaje ?? '').toLowerCase().includes('token')
    ? ProviderErrorCode.AUTH_EXPIRED
    : ProviderErrorCode.INVALID_INPUT;
}

function failScheduling(operation: string, mensaje: string | undefined, status: number): Unwrapped {
  return {
    ok: false,
    code: classifyScheduling(mensaje),
    message: mensaje
      ? `HiMed scheduling ${operation}: ${mensaje}`
      : `HiMed scheduling ${operation} failed (HTTP ${status})`,
  };
}

export function unwrapHimedScheduling(res: RequestResult, operation: string): Unwrapped {
  if (!res.ok) {
    if (res.errorCode === ProviderErrorCode.PROVIDER_UNAVAILABLE) {
      return {
        ok: false,
        code: res.errorCode,
        message: `HiMed scheduling ${operation} failed (HTTP ${res.status})`,
      };
    }
    return failScheduling(operation, parseBody(res.body)?.mensaje, res.status);
  }
  const body = parseBody(res.data);
  if (body && (body.estado === 'error' || body.success === false)) {
    return failScheduling(operation, body.mensaje, res.status);
  }
  return { ok: true, data: res.data };
}
