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
      provider.listTools().map(
        (tool) =>
          ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema as Tool['inputSchema'],
            /*
             * `identityPolicy` — whose data the tool can reach.
             *
             * THIS LINE IS THE WHOLE POINT OF THE FIELD, and it was missing. #101 added the policy
             * to `ToolDefinition`, forwarded it through `provider-factory` and `definePaginatedList`,
             * and pinned it with tests that read `provider.listTools()` — the in-process object. This
             * mapping, the only place where a tool becomes something a consumer can see, dropped it.
             * So every declaration was true and none of it left the building, which is precisely the
             * failure #101's own commit message describes: "a field that is declared and not published
             * is worse than one nobody declared".
             *
             * It surfaced on a PHI provider's round-trip proof, because that is the first provider
             * whose safety argument depends on the consumer being told. A protocol test now asserts
             * the WIRE shape rather than the source — see `__tests__/mcp.integration.test.ts`.
             *
             * It TOUCHES `src/protocol`, against the add-provider golden rule, and deliberately: this
             * is the other half of #101, which already took the same exception for `src/core` and
             * recorded it in its commit rather than an ADR. Nothing else here changes — a consumer
             * that ignores the field sees the menu it always saw (additive, ADR 0001).
             *
             * Note for whoever tests this by hand: the MCP SDK's own `ToolSchema` is a plain
             * `z.object`, so its typed client STRIPS the field on parse. xcale-backend does not use
             * that client — it reads raw JSON-RPC (`modules/mcp/mcp-client.ts`) — so the field
             * reaches the real consumer. A probe built on the SDK client will show nothing and be
             * wrong about it.
             */
            ...(tool.identityPolicy ? { identityPolicy: tool.identityPolicy } : {}),
          }) as Tool,
      ),
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
