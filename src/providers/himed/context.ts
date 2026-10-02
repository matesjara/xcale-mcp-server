import { z } from 'zod';

/**
 * `codigo_servicio` — the non-secret Autoagendamiento service identifier HiMed issues alongside the
 * scheduling `token`. It routes the call (which clinic/service) but grants no access on its own, so it
 * is call context, not a credential. The autoagendamiento tools put it in the request body; the
 * Demográficos and directory tools ignore it. One `codigo_servicio` = one clinic (the accountKey).
 */
export const himedContext = z
  .object({
    codigo_servicio: z.string().min(1),
  })
  .strict();

export type HimedContext = z.infer<typeof himedContext>;
