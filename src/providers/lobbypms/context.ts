import { z } from 'zod';

/**
 * LobbyPMS call context (Explicit Context principle). Published to the consumer as `contextSchema`.
 *
 * **`propertyId` is the account identity, not routing.** A LobbyPMS token is issued per property and
 * the API's URLs name no property — the token alone selects it. But a consumer still has to tell two
 * connected properties apart, and the token is a secret it must not key on. The property's own
 * LobbyPMS id (shown in its account, e.g. `339654`) is that identity: pasted at connect, carried on
 * every call, and never sent to LobbyPMS.
 *
 * It is a string even though LobbyPMS shows a number — kept opaque; this server never interprets it.
 */
export const lobbypmsContext = z.object({ propertyId: z.string().trim().min(1) }).strict();

export type LobbypmsContext = z.infer<typeof lobbypmsContext>;
