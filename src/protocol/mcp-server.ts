import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import {
  type CredentialResolverDeps,
  resolveCredential,
} from '../core/credential/credential-resolver';
import { ReferenceAuthExpiredError } from '../core/credential/reference-resolver';
import { ProviderErrorCode } from '../core/errors';
import type { ProviderRegistry } from '../core/registry';
import type { InboundCallContext } from '../core/types';
import { toMcpResult } from './result-mapping';

/**
 * Build a per-request MCP Server bound to the registry and this call's INBOUND context (the raw
 * forwarded token/reference). Stateless: one Server per request. The single dispatch point below
 * runs the CredentialResolver before the provider executes. This is the ONLY place that imports the
 * MCP SDK + the core.
 */
export function createMcpServer(
  registry: ProviderRegistry,
  ctx: InboundCallContext,
  resolverDeps: CredentialResolverDeps = {},
): Server {
  const server = new Server(
    { name: 'xcale-mcp-server', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // Pillar: tools/list — flat list across all providers (namespaced mcp_{slug}_{verb}).
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = registry.providers.flatMap((provider) =>
      provider.listTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Tool['inputSchema'],
      })),
    );
    return { tools };
  });

  // Pillar: tools/call — route by tool name, execute via the provider, map the result.
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const provider = registry.getProviderByTool(name);
    if (provider === undefined) {
      return toMcpResult({
        kind: 'error',
        code: ProviderErrorCode.UNKNOWN_TOOL,
        toolName: name,
        providerSlug: 'unknown',
        message: `Unknown tool: ${name}`,
      });
    }
    // Credential Resolution phase: turn the inbound wire value into a ResolvedCredential, dispatched
    // by the provider's declared delivery strategy. Exactly one resolution per tools/call.
    const delivery = provider.auth.credentialDelivery ?? 'forwarded';
    let credential;
    try {
      credential = await resolveCredential(delivery, ctx.token, resolverDeps);
    } catch (err) {
      // Error-ownership boundary: a revoked durable credential is PROVIDER-owned → a typed
      // PROVIDER_AUTH_EXPIRED ToolResult (reconnect). A transport-owned failure (bad/expired
      // reference, callback down) is NOT a ToolResult — it propagates to a JSON-RPC error.
      if (err instanceof ReferenceAuthExpiredError) {
        return toMcpResult({
          kind: 'error',
          code: ProviderErrorCode.AUTH_EXPIRED,
          toolName: name,
          providerSlug: provider.manifest.slug,
          message: 'reconnect required',
        });
      }
      throw err;
    }
    const result = await provider.callTool(name, args ?? {}, {
      credential,
      metadata: ctx.metadata,
    });
    return toMcpResult(result);
  });

  return server;
}
