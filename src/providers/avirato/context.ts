import { z } from 'zod';

/**
 * Avirato call context (Explicit Context principle), published to the consumer as `contextSchema`.
 *
 * **`web_code` names the establishment.** The login returns the `web_codes` its API user reaches (one or
 * several), and every data endpoint takes `?web_code=<number>` — the token alone cannot say which
 * establishment, so it is named per call, like Cloudbeds' `propertyID`. A user reaching several
 * establishments is several connections. Avirato types it as a number on the wire (Observed).
 */
export const aviratoContext = z.object({ web_code: z.coerce.number().int().positive() }).strict();

export type AviratoContext = z.infer<typeof aviratoContext>;
