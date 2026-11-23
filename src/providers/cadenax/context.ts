import { z } from 'zod';

/**
 * Cadenax call context (Explicit Context principle), published to the consumer as `contextSchema`.
 *
 * **`office` is the office code the connection works in** (`USA`, `CANADA`, `GR`). Cadenax requires
 * `?office=CODE` on every transactional endpoint and validates it against the calling key, so the
 * office is named per call — and it comes from the connection, discovered at connect by `whoami`,
 * never from a tool argument: an agent cannot choose an office. If the context ever named an office
 * the key does not reach, Cadenax refuses the call; isolation holds on its side.
 *
 * A code, not an id: letters, digits, `_` and `-`, as Cadenax prints them (`USA_CANADA`).
 */
export const cadenaxContext = z
  .object({
    office: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,32}$/, 'An office code: letters, digits, _ or -'),
  })
  .strict();

export type CadenaxContext = z.infer<typeof cadenaxContext>;
