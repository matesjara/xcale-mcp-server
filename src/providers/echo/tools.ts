import { z } from 'zod';

import { ProviderErrorCode } from '../../core/errors';
import { defineTool, err, ok } from '../../core/tool';
import { SLUG } from './manifest';

export const TOOL_SAY = `mcp_${SLUG}_say`;
export const TOOL_AUTH_CHECK = `mcp_${SLUG}_auth_check`;
export const TOOL_RECONNECT = `mcp_${SLUG}_reconnect_required`;

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
    description:
      'Prove the tools/call pipeline is wired end-to-end (dispatch + credential resolution).',
    input: z.object({}).strict(),
    // Credential handling is a CORE concern now (resolver → materializer); the adapter never sees the
    // secret. Reaching this handler means resolution succeeded. Credential application is covered by
    // the AuthenticationMaterializer unit tests, not here.
    handler: async () => ok({ authenticated: true }),
  }),
  defineTool({
    name: TOOL_RECONNECT,
    description:
      'Always returns a typed PROVIDER_AUTH_EXPIRED result (probes the reconnect-required protocol mapping).',
    input: z.object({}).strict(),
    handler: async () => err(ProviderErrorCode.AUTH_EXPIRED, 'reconnect required (probe)'),
  }),
];
