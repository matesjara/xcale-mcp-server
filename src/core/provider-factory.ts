import type { z } from 'zod';

import { ProviderErrorCode } from './errors';
import { toJsonSchema } from './json-schema';
import type { IProvider, ProviderAuthDescriptor, ProviderManifest } from './provider-port';
import type { ToolDefinition } from './tool';
import { type McpToolDefinition, type ToolResult, toolError, toolSuccess } from './types';

export interface ProviderSpec<M = unknown> {
  readonly manifest: ProviderManifest;
  readonly auth: ProviderAuthDescriptor;
  /** Declares the provider's required call context (e.g. propertyID). The core never assumes names. */
  readonly metadataSchema?: z.ZodType<M>;
  // `any` for the input type is required to hold a heterogeneous tool collection (each tool's
  // zod input differs); the per-tool types stay sound at each defineTool/toolFactory call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly tools: ReadonlyArray<ToolDefinition<any, M>>;
}

function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/**
 * Build an IProvider from a spec. This is the generic dispatcher that enforces the platform
 * invariants (ADR: canonical-provider-pattern): JSON Schema generated from each tool's zod `input`;
 * metadata + args validated BEFORE the handler; typed handlers; uniform error mapping.
 */
export function createProvider<M = unknown>(spec: ProviderSpec<M>): IProvider {
  const slug = spec.manifest.slug;
  const byName = new Map(spec.tools.map((t) => [t.name, t]));
  const toolDefs: McpToolDefinition[] = spec.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toJsonSchema(t.input),
  }));
  const contextSchema = spec.metadataSchema ? toJsonSchema(spec.metadataSchema) : undefined;

  return {
    manifest: spec.manifest,
    auth: spec.auth,
    ...(contextSchema ? { contextSchema } : {}),
    listTools: () => toolDefs,
    callTool: async (toolName, args, ctx): Promise<ToolResult> => {
      const tool = byName.get(toolName);
      if (!tool) {
        return toolError({
          code: ProviderErrorCode.UNKNOWN_TOOL,
          toolName,
          providerSlug: slug,
          message: `Unknown tool: ${toolName}`,
        });
      }

      let metadata: M;
      if (spec.metadataSchema) {
        const parsedMeta = spec.metadataSchema.safeParse(ctx.metadata ?? {});
        if (!parsedMeta.success) {
          return toolError({
            code: ProviderErrorCode.INVALID_INPUT,
            toolName,
            providerSlug: slug,
            message: `Invalid context metadata — ${formatZodError(parsedMeta.error)}`,
          });
        }
        metadata = parsedMeta.data;
      } else {
        metadata = undefined as M;
      }

      const parsedArgs = tool.input.safeParse(args);
      if (!parsedArgs.success) {
        return toolError({
          code: ProviderErrorCode.INVALID_INPUT,
          toolName,
          providerSlug: slug,
          message: formatZodError(parsedArgs.error),
        });
      }

      const outcome = await tool.handler(parsedArgs.data, { token: ctx.token, metadata });
      return outcome.ok
        ? toolSuccess({
            toolName,
            providerSlug: slug,
            data: outcome.data,
            ...(outcome.message !== undefined ? { message: outcome.message } : {}),
          })
        : toolError({ code: outcome.code, toolName, providerSlug: slug, message: outcome.message });
    },
  };
}
