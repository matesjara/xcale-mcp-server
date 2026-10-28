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

  it('keeps a declared bound even when it equals the safe-integer limit', () => {
    expect(toJsonSchema(z.number().int().max(Number.MAX_SAFE_INTEGER))).toEqual({
      type: 'integer',
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(toJsonSchema(z.number().int().min(Number.MIN_SAFE_INTEGER))).toEqual({
      type: 'integer',
      minimum: Number.MIN_SAFE_INTEGER,
    });
  });

  it('keeps a declared safe-integer bound under a wrapper (optional, default, nullable)', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const min = Number.MIN_SAFE_INTEGER;
    const props = (shape: z.ZodRawShape) =>
      (toJsonSchema(z.object(shape)) as { properties: Record<string, unknown> }).properties;

    expect(props({ a: z.number().int().max(max).optional() }).a).toEqual({
      type: 'integer',
      maximum: max,
    });
    expect(props({ a: z.number().int().min(min).optional() }).a).toEqual({
      type: 'integer',
      minimum: min,
    });
    expect(props({ a: z.number().int().max(max).default(1) }).a).toEqual({
      type: 'integer',
      maximum: max,
      default: 1,
    });
    expect(props({ a: z.number().int().max(max).nullable() }).a).toEqual({
      anyOf: [{ type: 'integer', maximum: max }, { type: 'null' }],
    });
    expect(
      props({ a: z.number().int().min(min).max(max).nullable().optional().default(null) }).a,
    ).toEqual({
      anyOf: [{ type: 'integer', minimum: min, maximum: max }, { type: 'null' }],
      default: null,
    });
  });

  it('still drops the implicit bound zod adds to a wrapped .int()', () => {
    const { properties } = toJsonSchema(
      z.object({
        a: z.number().int().optional(),
        b: z.number().int().default(1),
        c: z.number().int().nullable(),
        d: z.number().int().nullable().optional().default(null),
      }),
    ) as { properties: Record<string, unknown> };
    expect(properties.a).toEqual({ type: 'integer' });
    expect(properties.b).toEqual({ type: 'integer', default: 1 });
    expect(properties.c).toEqual({ type: ['integer', 'null'] });
    expect(properties.d).toEqual({ type: ['integer', 'null'], default: null });
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
