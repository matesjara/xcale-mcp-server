import { z } from 'zod';

/**
 * Autocore call context (Explicit Context principle). Published to the consumer as `contextSchema`.
 *
 * `hotelId` is the hotel the connection charges for — Autocore's own id, the one `GET /v2/hotels`
 * lists. One set of keys can reach several hotels, so the id is context, checked by the connection
 * probe against the hotels the keys reach.
 *
 * `environment` is the tenant's choice at connect, with no default: Autocore's keys are issued per
 * environment and carry no prefix that would tell them apart (Staging keys answer 401 on any other
 * host, observed 2026-11-09). Staging is what Autocore gives integrators; its `api-dev` Testing host
 * is Autocore's own. Which host each value means is knowledge this provider keeps (`client.ts`).
 *
 * `source` is the account's origin, which Autocore hands over with the keys (xcale's is `xcale`) and
 * requires on every link it creates: without it, a create answers 400 "Debe indicar el origen…"
 * (observed on Staging, 2026-11-13). It is routing data of the account, not a secret.
 *
 * `hotelId` is read from a number or a string of digits: a consumer may keep the metadata an owner
 * typed as text (xcale-backend's connect form does). Never a coerced `true` or `'1e3'` (Avirato's rule).
 */
export const autocoreContext = z
  .object({
    hotelId: z.preprocess(
      (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v),
      z.number().int().positive(),
    ),
    environment: z.enum(['staging', 'production']),
    source: z.string().min(1).max(100),
  })
  .strict();

export type AutocoreContext = z.infer<typeof autocoreContext>;

export type AutocoreEnvironment = AutocoreContext['environment'];
