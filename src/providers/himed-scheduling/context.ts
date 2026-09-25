import { z } from 'zod';

/**
 * `codigo_servicio` — the non-secret service identifier HiMed issues alongside the `token`. It routes
 * the call (which clinic/service) but grants no access on its own, so it is call context, not a
 * credential (see `auth.ts`). Validated by the dispatcher before any handler runs; the handler puts
 * it in the request body.
 */
export const himedSchedulingContext = z
  .object({
    codigo_servicio: z.string().min(1),
  })
  .strict();

export type HimedSchedulingContext = z.infer<typeof himedSchedulingContext>;
