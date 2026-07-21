import { z } from 'zod';

import { ProviderErrorCode } from './errors';
import { type ToolDefinition, type ToolHandlerContext, defineTool, err, ok } from './tool';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * The uniform pagination args every list tool merges into its input (ADR: canonical-provider-pattern).
 * Sane defaults + a capped max so a consumer can't request an abusive page size.
 */
export const paginationInput = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationInput = z.infer<typeof paginationInput>;

/** The uniform list envelope returned by every list tool, regardless of the underlying API. */
export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages?: number;
  readonly totalResults?: number;
  readonly hasMore?: boolean;
}

/**
 * Build the uniform envelope. `hasMore` is derived only when the provider gives enough info
 * (totalPages or totalResults); otherwise it is omitted, never inferred (documented per tool).
 */
export function buildPage<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
  meta: { totalPages?: number; totalResults?: number } = {},
): PaginatedResult<T> {
  const hasMore =
    meta.totalPages !== undefined
      ? page < meta.totalPages
      : meta.totalResults !== undefined
        ? page * pageSize < meta.totalResults
        : undefined;
  return {
    items,
    page,
    pageSize,
    ...(meta.totalPages !== undefined ? { totalPages: meta.totalPages } : {}),
    ...(meta.totalResults !== undefined ? { totalResults: meta.totalResults } : {}),
    ...(hasMore !== undefined ? { hasMore } : {}),
  };
}

/** What a paginated handler returns: just its page of items (+ totals if the API gives them). */
export type PaginatedHandlerResult<T> =
  | {
      readonly ok: true;
      readonly items: readonly T[];
      readonly totalPages?: number;
      readonly totalResults?: number;
    }
  | { readonly ok: false; readonly code: ProviderErrorCode; readonly message: string };

/**
 * Canonical list-tool helper: merges `paginationInput` into the tool's `input`, and wraps the
 * handler's page of items into the uniform `PaginatedResult` envelope — so every provider's list
 * tools expose the same shape regardless of the underlying API (ADR: canonical-provider-pattern).
 */
export function definePaginatedList<I extends z.ZodObject<z.ZodRawShape>, T, M = unknown>(def: {
  name: string;
  description: string;
  input: I;
  handler: (
    args: z.infer<I> & PaginationInput,
    ctx: ToolHandlerContext<M>,
  ) => Promise<PaginatedHandlerResult<T>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection); call-site types stay sound
}): ToolDefinition<any, M> {
  const mergedInput = def.input.merge(paginationInput);
  return defineTool<typeof mergedInput, M>({
    name: def.name,
    description: def.description,
    input: mergedInput,
    handler: async (args, ctx) => {
      const result = await def.handler(args as z.infer<I> & PaginationInput, ctx);
      if (!result.ok) {
        return err(result.code, result.message);
      }
      const { page, pageSize } = args as PaginationInput;
      return ok(
        buildPage(result.items, page, pageSize, {
          totalPages: result.totalPages,
          totalResults: result.totalResults,
        }),
      );
    },
  });
}
