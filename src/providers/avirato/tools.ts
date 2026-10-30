import { z } from 'zod';

import { toolFactory, type ToolDefinition } from '../../core/tool';
import type { AviratoClient } from './client';
import type { AviratoContext } from './context';
import { unwrapAvirato } from './errors';
import { SLUG } from './manifest';

const tool = toolFactory<AviratoContext>();

/** No-argument input — the catalog reads that take no filter (`web_code` rides the call context). */
const noArgs = z.object({}).strict();

/**
 * The Avirato tools. `web_code` comes from the call context, never a tool argument, and data is returned
 * VERBATIM (Fidelity over Unification). The full set, and which of them are control plane, is the
 * contract's §C (`docs/design/avirato-provider/api-contract.md`).
 */
export function buildAviratoTools(
  client: AviratoClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, AviratoContext>> {
  return [
    tool({
      name: `mcp_${SLUG}_get_establishment`,
      readOnly: true,
      description:
        'Read the connected Avirato hotel: name, address, contact, currency, default VAT, and its ' +
        'online-booking texts (legal, information, refundable and non-refundable terms) per language. ' +
        'Use it to answer questions about the hotel itself and its booking conditions.',
      input: noArgs,
      handler: async (_args, ctx) =>
        unwrapAvirato(
          await client.get('establishment', ctx.request, ctx.metadata),
          'get_establishment',
        ),
    }),
  ];
}
