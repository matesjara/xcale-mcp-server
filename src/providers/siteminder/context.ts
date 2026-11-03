import { z } from 'zod';

/**
 * SiteMinder call context (Explicit Context). Published to the consumer as `contextSchema`.
 *
 * `propertyUuid` is the property every call acts on. SiteMinder shows it as the "Property ID" on the
 * screen where the key is generated, and every Direct Booking path is scoped by it. A group key opens
 * several properties, so the id is never inferred from the key: one connection is one property.
 */
export const siteminderContext = z
  .object({
    propertyUuid: z
      .string()
      .uuid()
      .describe(
        'The Property ID SiteMinder shows next to the key (Direct Booking › API Integration, or ' +
          "Little Hotelier's API integration tab).",
      ),
  })
  .strict();

export type SiteminderContext = z.infer<typeof siteminderContext>;
