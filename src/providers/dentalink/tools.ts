import { z } from 'zod';

import { defineTool, ok, type ToolDefinition, type ToolOutcome } from '../../core/tool';
import type { DentalinkClient } from './client';
import { unwrapDentalink } from './errors';
import { SLUG } from './manifest';

/** No-argument input, for the reference-data reads that take no filter. */
const noArgs = z.object({}).strict();

function toOutcome(result: ReturnType<typeof unwrapDentalink>): ToolOutcome {
  return result.ok ? ok(result.data) : { ok: false, code: result.code, message: result.message };
}

/**
 * The Dentalink tool set. v1 = read + additive reserve path (feature-design §5). Built incrementally
 * per the implementation plan: S1 lands `list_branches` (the tracer bullet and the `connectionProbe`);
 * S2 adds the remaining reads; S3 adds patient lookup/creation and booking.
 *
 * Result shapes are returned **verbatim** (Fidelity over Unification) and are PROVISIONAL until
 * verified against the real API with a token (no sandbox exists — api-contract §8).
 */
export function buildDentalinkTools(
  client: DentalinkClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any>> {
  return [
    defineTool({
      name: `mcp_${SLUG}_list_branches`,
      description:
        "List the clinic's active branches (sucursales). Returns Dentalink's records verbatim; each " +
        'branch carries its `id` (the `id_sucursal` other tools take as an argument) and `nombre`. ' +
        'This is also the connection probe — a cheap, no-argument read that proves the token has read ' +
        'scope.',
      input: noArgs,
      handler: async (_args, ctx) =>
        toOutcome(unwrapDentalink(await client.get('sucursales', ctx.request), 'list branches')),
    }),
  ];
}
