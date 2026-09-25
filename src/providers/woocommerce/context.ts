import { z } from 'zod';

/**
 * WooCommerce call context (Explicit Context principle). Published to the consumer as `contextSchema`.
 *
 * **`storeUrl` is the account identity AND the base URL.** WooCommerce is self-hosted, so every store
 * lives at its own domain — there is no fixed central API. The owner pastes the store URL once at
 * connect; the consumer (Rail A) validates it (must be `https`, a public host — anti-SSRF) and
 * forwards it here on every call. The client builds `${storeUrl}/wp-json/wc/v3/...` from it.
 *
 * The credential (`consumer_key:consumer_secret`, HTTP Basic) travels separately as the forwarded
 * secret — never in this context and never in the URL.
 */
export const woocommerceContext = z.object({ storeUrl: z.string().url() }).strict();

export type WoocommerceContext = z.infer<typeof woocommerceContext>;
