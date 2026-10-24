import { z } from 'zod';

/**
 * Wompi call context (Explicit Context principle). Published to the consumer as `contextSchema`.
 *
 * `publicKey` identifies the merchant account. It is not a secret — Wompi's own checkout pages carry
 * it — so it travels as context, while the private key is the one forwarded secret.
 *
 * It also names the environment: Wompi issues `pub_test_…` keys for its sandbox and `pub_prod_…` for
 * production (sandbox prefix verified 2026-10-22; production documented). One deployment of this
 * server serves tenants in both, so the API is picked per call from that prefix (`environmentOf`)
 * — Wompi knowledge that stays here, so a consumer never maps prefixes itself. A key with any other
 * prefix (a private `prv_…` key pasted in the wrong field included) is refused by the schema, before
 * any request.
 */
export const wompiContext = z
  .object({
    publicKey: z.string().regex(/^pub_(test|prod)_[A-Za-z0-9]+$/),
  })
  .strict();

export type WompiContext = z.infer<typeof wompiContext>;

export type WompiEnvironment = 'sandbox' | 'production';

/** The schema admits only the two prefixes, so this never guesses. */
export function environmentOf(publicKey: string): WompiEnvironment {
  return publicKey.startsWith('pub_prod_') ? 'production' : 'sandbox';
}
