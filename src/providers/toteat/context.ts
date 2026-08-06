import { z } from 'zod';

/**
 * Toteat call context (Explicit Context principle). Published to the consumer as `contextSchema`.
 *
 * **`(xir, xil)` is the account identity, not `xir` alone.** One restaurant can have several venues,
 * each with its own menu, tables and shift. Scoping on the restaurant would let one venue's agent
 * answer with another venue's menu — a cross-venue leak, not a cosmetic bug. The consumer keys its
 * connection on the pair; this schema is why it can.
 *
 * `xiu` is the API user the owner created in the POS. It identifies the integration, not a person,
 * and Toteat requires it on every call.
 *
 * All three are strings on the wire even though the POS shows them as numbers — a 16-digit
 * restaurant id does not survive a JSON number round-trip intact.
 */
export const toteatContext = z
  .object({
    xir: z.string().min(1),
    xil: z.string().min(1),
    xiu: z.string().min(1),
  })
  .strict();

export type ToteatContext = z.infer<typeof toteatContext>;
