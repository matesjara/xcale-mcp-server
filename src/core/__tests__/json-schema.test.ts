import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { toJsonSchema } from '../json-schema';

// The published `inputSchema` is a contract consumers cache by `schemaVersion`. These pin the shape
// `zod-to-json-schema` emitted under zod 3, so the zod 4 upgrade left every published tool unchanged.
describe('toJsonSchema', () => {
  it('publishes additionalProperties: false for a strip object, not only a strict one', () => {
    expect(toJsonSchema(z.object({ a: z.string() }))).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    });
    const merged = z
      .object({ a: z.string() })
      .strict()
      .merge(z.object({ b: z.number() }));
    expect(toJsonSchema(merged)).toMatchObject({ additionalProperties: false });
  });

  it('keeps a passthrough object open', () => {
    expect(toJsonSchema(z.object({ a: z.string() }).passthrough()).additionalProperties).not.toBe(
      false,
    );
  });

  it('publishes no safe-integer bound on .int(), but keeps a declared one', () => {
    expect(toJsonSchema(z.number().int())).toEqual({ type: 'integer' });
    expect(toJsonSchema(z.number().int().min(1).max(50))).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 50,
    });
  });

  it("publishes an email's format without zod's own regex, but keeps a declared pattern", () => {
    expect(toJsonSchema(z.string().email())).toEqual({ type: 'string', format: 'email' });
    expect(toJsonSchema(z.string().regex(/^[A-Z]{3}$/))).toMatchObject({ pattern: '^[A-Z]{3}$' });
  });

  it('publishes a string-keyed record without propertyNames', () => {
    expect(toJsonSchema(z.record(z.string(), z.unknown()))).toEqual({
      type: 'object',
      additionalProperties: {},
    });
  });

  it('describes the input side: a defaulted field is optional', () => {
    const json = toJsonSchema(z.object({ page: z.number().int().default(1) }));
    expect(json.required).toBeUndefined();
    expect(json).toMatchObject({ properties: { page: { type: 'integer', default: 1 } } });
  });
});
