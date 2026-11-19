import { z } from 'zod';

/** A phone in E.164 (`+573001112233`): Restofy matches phones as exact strings (observed). */
export const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'a phone in E.164, e.g. +573001112233');

/** A Restofy UUID (36 characters). Shape only: Restofy mixes v1 and v4 ids (observed). */
export const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'a 36-character UUID');

/** A positive integer id, as every Restofy numeric id is. */
export const id = z.number().int().positive();
