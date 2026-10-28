import { z } from 'zod';

import type { JsonSchema } from './types';

/** The pattern zod 4 writes next to `format: "email"` on its own — not one a provider declared. */
const ZOD_EMAIL_PATTERN = (z.toJSONSchema(z.string().email()) as { pattern?: string }).pattern;

/**
 * True when the schema, or a schema it wraps, carries a `.min()`/`.max()` check — the bound is
 * deliberate, not from `.int()`. The override visits the OUTERMOST node of a field, so a bound
 * declared under `.optional()`, `.default()`, `.nullable()` and the like lives in the wrapped
 * schema's checks; this follows every wrapper that has an `innerType` (and a pipe's input side,
 * which `io: 'input'` publishes).
 */
function hasExplicitBound(schema: z.core.$ZodType, check: 'less_than' | 'greater_than'): boolean {
  let node: z.core.$ZodType | undefined = schema;
  while (node) {
    const def = node._zod.def as {
      checks?: z.core.$ZodCheck[];
      innerType?: z.core.$ZodType;
      in?: z.core.$ZodType;
      type: string;
    };
    if ((def.checks ?? []).some((c) => c._zod.def.check === check)) return true;
    node = def.innerType ?? (def.type === 'pipe' ? def.in : undefined);
  }
  return false;
}

/**
 * Generate a self-contained JSON Schema (MCP `inputSchema`) from a zod schema.
 * The zod schema is the single source of truth (ADR: canonical-provider-pattern); never
 * hand-write the JSON Schema. `reused: 'inline'` inlines refs so the schema is portable, and
 * `io: 'input'` describes what a caller may SEND (defaulted fields stay optional).
 *
 * The `override` keeps the published contract byte-identical to what `zod-to-json-schema` emitted
 * under zod 3, because every consumer caches it by `schemaVersion`:
 * - a non-passthrough object publishes `additionalProperties: false` (zod 4 omits it for `strip`);
 * - `.int()` publishes no ±`Number.MAX_SAFE_INTEGER` bound (zod 4 adds one to every integer) — but a
 *   `.min()`/`.max()` a provider wrote on purpose is kept, even when it equals that integer;
 * - `.email()` publishes `format` only, not zod's own email regex;
 * - `z.record` publishes no `propertyNames: { type: "string" }`.
 */
export function toJsonSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, {
    target: 'draft-7',
    reused: 'inline',
    io: 'input',
    unrepresentable: 'any',
    override: ({ zodSchema, jsonSchema }) => {
      const s = jsonSchema as Record<string, unknown>;
      if (zodSchema._zod.def.type === 'object' && s.additionalProperties === undefined) {
        s.additionalProperties = false;
      }
      if (s.maximum === Number.MAX_SAFE_INTEGER && !hasExplicitBound(zodSchema, 'less_than'))
        delete s.maximum;
      if (s.minimum === Number.MIN_SAFE_INTEGER && !hasExplicitBound(zodSchema, 'greater_than'))
        delete s.minimum;
      if (s.format === 'email' && s.pattern === ZOD_EMAIL_PATTERN) delete s.pattern;
      const names = s.propertyNames as Record<string, unknown> | undefined;
      if (names && Object.keys(names).length === 1 && names.type === 'string') {
        delete s.propertyNames;
      }
    },
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}
