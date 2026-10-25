import { z } from 'zod';

/**
 * Profitroom call context (Explicit Context principle). Published to the consumer as `contextSchema`.
 *
 * Profitroom is a Credential-less provider (CONTEXT.md, ADR credential-less-provider-auth): the only
 * thing a connection carries is the hotel's public **Booking-engine URL**, e.g.
 * `https://booking.profitroom.com/es/hotellapausa`. It is an identifier this provider PARSES, never a
 * URL the server calls — every request is built from the fixed API base in `client.ts`, so a supplied
 * URL can never steer where the server sends traffic (SSRF). The `{locale}` segment is not the
 * guest's language; tools take `locale` per call.
 *
 * A refine (not a transform) keeps the published `contextSchema` a plain string field; handlers derive
 * the hotel key with `hotelKeyFrom`.
 */
const ENGINE_HOST = 'booking.profitroom.com';
const ENGINE_PATH = /^\/([a-z]{2})\/([a-z0-9-]{1,64})(?:\/.*)?$/;

function parseEngineUrl(value: string): { hotelKey: string } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== ENGINE_HOST) return null;
  if (url.port !== '' || url.username !== '' || url.password !== '') return null;
  const match = ENGINE_PATH.exec(url.pathname);
  if (match === null) return null;
  return { hotelKey: match[2] as string };
}

const bookingEngineUrl = z.string().refine((v) => parseEngineUrl(v) !== null, {
  message: 'bookingEngineUrl is not a Profitroom booking engine address',
});

/**
 * Every call after connect carries both keys: the URL the owner pasted and the `hotelKey` the
 * consumer discovered from `get_hotel` (`manifest.contextDiscovery`). They must agree — a context
 * naming one hotel by URL and another by key is refused rather than guessed between.
 */
export const profitroomContext = z
  .object({ bookingEngineUrl, hotelKey: z.string().regex(/^[a-z0-9-]{1,64}$/) })
  .strict()
  .refine((c) => parseEngineUrl(c.bookingEngineUrl)?.hotelKey === c.hotelKey, {
    message: 'hotelKey does not match the hotel in bookingEngineUrl',
    path: ['hotelKey'],
  });

export type ProfitroomContext = z.infer<typeof profitroomContext>;

/**
 * The connect-time context: only the URL the owner pasted. `get_hotel` is the consumer's connection
 * probe AND discovery tool, and the core exempts the discovery tool from `contextSchema` validation
 * (`src/core/provider-factory.ts:82-87`) because the discovered key cannot exist yet. So `get_hotel`
 * checks the URL itself with this schema — the SSRF guard must not depend on which tool is called.
 */
export const bookingEngineUrlContext = z.object({ bookingEngineUrl });

/** The hotel key of an already-validated booking-engine URL (the context refine ran first). */
export function hotelKeyFrom(bookingEngineUrl: string): string {
  const parsed = parseEngineUrl(bookingEngineUrl);
  if (parsed === null) {
    throw new Error('hotelKeyFrom called with an unvalidated bookingEngineUrl');
  }
  return parsed.hotelKey;
}
