import { z } from 'zod';

import { defineTool, type ToolDefinition } from '../../core/tool';
import type { RestofyClient } from './client';
import { toOutcome } from './errors';
import { SLUG } from './manifest';

const NO_ARGS = z.object({}).strict();

export function buildRestofyTools(client: RestofyClient): ToolDefinition[] {
  return [
    defineTool({
      name: `mcp_${SLUG}_get_business_profile`,
      description:
        "The restaurant's public profile, its weekly opening schedule, its timezone and whether it is " +
        'open right now (`isOpenNow`). Read it before promising a delivery or a time.',
      input: NO_ARGS,
      readOnly: true,
      audience: 'customer',
      handler: async (_args, ctx) =>
        toOutcome(await client.call('business-profile/get-business-profile', ctx.request)),
    }),
  ];
}
