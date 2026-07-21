import { z } from 'zod';

import { defineTool, err, ok } from '../../core/tool';
import { ProviderErrorCode } from '../../core/errors';
import { SLUG } from './manifest';

export const TOOL_SAY = `mcp_${SLUG}_say`;
export const TOOL_AUTH_CHECK = `mcp_${SLUG}_auth_check`;

/** Echo's tools, declared with the canonical pattern: zod `input` is the single source of truth. */
export const echoTools = [
  defineTool({
    name: TOOL_SAY,
    description: 'Echo a message back (stub tool that proves the tools/call round trip).',
    input: z.object({ message: z.string().min(1, 'message must not be empty') }).strict(),
    handler: async (args) => ok({ echoed: args.message }),
  }),
  defineTool({
    name: TOOL_AUTH_CHECK,
    description: 'Verify the forwarded credential reached the adapter (proves Hop-A wiring).',
    input: z.object({}).strict(),
    handler: async (_args, ctx) =>
      ctx.token.isEmpty()
        ? err(ProviderErrorCode.AUTH_EXPIRED, 'No credential forwarded; reconnect required.')
        : ok({ authenticated: true }),
  }),
];
