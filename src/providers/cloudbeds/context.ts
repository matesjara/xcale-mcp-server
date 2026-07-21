import { z } from 'zod';

/**
 * Cloudbeds call context (Explicit Context principle): a Cloudbeds connection may span multiple
 * properties, so the target `propertyID` must be forwarded and validated — never inferred.
 * Published to the consumer as the provider's `contextSchema`.
 */
export const cloudbedsContext = z.object({ propertyID: z.string().min(1) });
export type CloudbedsContext = z.infer<typeof cloudbedsContext>;
