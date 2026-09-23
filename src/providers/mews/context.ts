import { z } from 'zod';

/**
 * Mews call context (Explicit Context). One `AccessToken` opens one enterprise, and an enterprise
 * sells many services — stays, parking, a restaurant, tours (36 bookable ones in the demo). Which one
 * is the hotel's accommodation is the hotel's answer, so it is the context: resolved at connect by
 * `mcp_mews_list_services`, forwarded on every call.
 */
export const mewsContext = z
  .object({
    serviceId: z.string().uuid(),
  })
  .strict();

export type MewsContext = z.infer<typeof mewsContext>;
