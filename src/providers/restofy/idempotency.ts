import { createHash } from 'node:crypto';

/**
 * Restofy's `create-order` requires an `Idempotency-Key` header (observed 2026-11-18, undocumented), dry
 * runs included. Observed behaviour:
 * - the same key with the same body replays the same order;
 * - the same key with another body is refused (400);
 * - a new key with a used `externalReference` returns the existing order (`isExistingOrder: true`).
 *
 * The key is DERIVED from the request, never taken as input (feature design AD-6): a retry of the same call
 * replays, and a changed call with the same reference comes back as the existing order — at most one order
 * per reference, with no state in this server.
 */

/** JSON with object keys sorted at every level, no whitespace: one text per value. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** UUID-shaped SHA-256 of `ref ‖ canonicalJson(body)`; the same input always gives the same key. */
export function idempotencyKey(ref: string, body: Record<string, unknown>): string {
  const h = sha256Hex(`${ref}\n${canonicalJson(body)}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** The `externalReference` a dry run sends (Restofy requires one): `quote-` + 32 hex of the body's hash. */
export function quoteReference(body: Record<string, unknown>): string {
  return `quote-${sha256Hex(canonicalJson(body)).slice(0, 32)}`;
}
