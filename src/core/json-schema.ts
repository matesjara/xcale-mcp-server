import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import type { JsonSchema } from './types';

/**
 * Generate a self-contained JSON Schema (MCP `inputSchema`) from a zod schema.
 * The zod schema is the single source of truth (ADR: canonical-provider-pattern); never
 * hand-write the JSON Schema. `$refStrategy: 'none'` inlines refs so the schema is portable.
 */
export function toJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const json = zodToJsonSchema(schema, { $refStrategy: 'none', target: 'jsonSchema7' }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return json;
}
