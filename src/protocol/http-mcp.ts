import type { IncomingMessage, ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import type { CredentialResolverDeps } from '../core/credential/credential-resolver';
import type { ProviderRegistry } from '../core/registry';
import type { InboundCallContext } from '../core/types';
import { createMcpServer } from './mcp-server';

/**
 * Handle one MCP request over Streamable HTTP in STATELESS mode (no Mcp-Session-Id): a fresh
 * server + transport per request, torn down when the response closes. Sidesteps the session
 * model MCP is removing (ADR: stateless-gateway-and-thin-acl).
 */
export async function handleMcpRequest(opts: {
  registry: ProviderRegistry;
  ctx: InboundCallContext;
  resolverDeps?: CredentialResolverDeps;
  req: IncomingMessage;
  res: ServerResponse;
  body: unknown;
}): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(opts.registry, opts.ctx, opts.resolverDeps);

  opts.res.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(opts.req, opts.res, opts.body);
}
