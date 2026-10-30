import { z } from 'zod';

/**
 * HotelSync call context (Explicit Context). Published to the consumer as `contextSchema`.
 *
 * `id_properties` is the connection's identity: one HotelSync login may reach several properties (a
 * reseller-managed user may), and every data call names the property in its body. It comes ONLY from the
 * call context — never from a tool input — so a tool can reach no property but the one the tenant
 * connected. A string: HotelSync documents it as a property id code. Kept opaque.
 */
export const hotelsyncContext = z.object({ id_properties: z.string().min(1) }).strict();

export type HotelSyncContext = z.infer<typeof hotelsyncContext>;
