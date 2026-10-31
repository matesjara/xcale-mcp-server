import { z } from 'zod';

/**
 * Avirato call context (Explicit Context principle), published to the consumer as `contextSchema`.
 *
 * **`web_code` names the establishment.** The login returns the `web_codes` its API user reaches (one or
 * several), and every data endpoint takes `?web_code=<number>` — the token alone cannot say which
 * establishment, so it is named per call, like Cloudbeds' `propertyID`. A user reaching several
 * establishments is several connections. Avirato types it as a number on the wire (Observed).
 */
export const aviratoContext = z
  .object({
    // A number, or a string of digits (metadata may arrive as text) — never a coerced `true` or `'1e3'`.
    web_code: z.preprocess(
      (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v),
      z.number().int().positive(),
    ),
  })
  .strict();

export type AviratoContext = z.infer<typeof aviratoContext>;
