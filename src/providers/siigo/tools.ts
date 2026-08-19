import { z } from 'zod';

import { definePaginatedList, type PaginatedHandlerResult } from '../../core/pagination';
import { defineTool, ok, type ToolDefinition, type ToolOutcome } from '../../core/tool';
import type { SiigoClient } from './client';
import { unwrapSiigo } from './errors';
import { SLUG } from './manifest';

/** Get-by-id input. Siigo resource ids are UUIDs. */
const getInput = z.object({ id: z.string().min(1) }).strict();

/** No-argument input, for the reference-data reads that take no filter. */
const noArgs = z.object({}).strict();

function toOutcome(result: ReturnType<typeof unwrapSiigo>): ToolOutcome {
  return result.ok ? ok(result.data) : { ok: false, code: result.code, message: result.message };
}

/**
 * Unwrap a Siigo `{ pagination, results, _links }` list response into the page the uniform
 * `PaginatedResult` envelope is built from (ADR canonical-provider-pattern §2 — the ENVELOPE is
 * standardized; Fidelity over Unification governs the records, so each item stays verbatim).
 * Siigo's `_links` is dropped: paging is consumer-controlled via `page`/`pageSize`. Observed B1:
 * Siigo's wire `page_size` CLAMPS any value below 10 up to 10 — the envelope echoes the caller's
 * requested `pageSize`, so a sub-10 request may carry more items than it asked for.
 */
function toPage(result: ReturnType<typeof unwrapSiigo>): PaginatedHandlerResult<unknown> {
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  const env = result.data as {
    readonly pagination?: { readonly total_results?: number };
    readonly results?: readonly unknown[];
  };
  return {
    ok: true,
    items: Array.isArray(env.results) ? env.results : [],
    ...(env.pagination?.total_results !== undefined
      ? { totalResults: env.pagination.total_results }
      : {}),
  };
}

/**
 * A no-argument reference-data list. Observed (Phase 1a): these endpoints return a FLAT ARRAY (not the
 * `{ pagination, results }` envelope of the main resources) — returned verbatim (Fidelity over
 * Unification). Used by the agent for context and (later) to fill the write path's lookups.
 */
function refArrayTool(
  client: SiigoClient,
  verb: string,
  path: string,
  description: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ToolDefinition<any> {
  return defineTool({
    name: `mcp_${SLUG}_${verb}`,
    description,
    input: noArgs,
    handler: async (_args, ctx) =>
      toOutcome(unwrapSiigo(await client.get(`v1/${path}`, ctx.request), verb.replace(/_/g, ' '))),
  });
}

/**
 * A paginated `list_*` for a resource whose list already carries the full records (Observed: purchases,
 * credit-notes, vouchers, journals, quotations all return the standard `{ pagination, results, _links }`
 * envelope with complete objects). No `get_*` companion — the list is the record. Uniform
 * `PaginatedResult` envelope; each item verbatim.
 */
function listResourceTool(
  client: SiigoClient,
  verb: string,
  path: string,
  description: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ToolDefinition<any> {
  return definePaginatedList({
    name: `mcp_${SLUG}_${verb}`,
    description,
    input: z.object({}),
    handler: async (args, ctx) =>
      toPage(
        unwrapSiigo(
          await client.get(`v1/${path}`, ctx.request, {
            page: args.page,
            page_size: args.pageSize,
          }),
          verb.replace(/_/g, ' '),
        ),
      ),
  });
}

/**
 * One resource family: a paginated `list_*` (uniform `PaginatedResult` envelope, items verbatim)
 * and a by-id `get_*` (resource object verbatim).
 */
function resourceTools(resource: {
  readonly listVerb: string; // e.g. 'list_customers'
  readonly getVerb: string; // e.g. 'get_customer'
  readonly path: string; // e.g. 'customers'
  readonly listDescription: string;
  readonly getDescription: string;
  readonly client: SiigoClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
}): ReadonlyArray<ToolDefinition<any>> {
  const { client, path } = resource;
  return [
    definePaginatedList({
      name: `mcp_${SLUG}_${resource.listVerb}`,
      description: resource.listDescription,
      input: z.object({}),
      handler: async (args, ctx) => {
        const res = await client.get(`v1/${path}`, ctx.request, {
          page: args.page,
          page_size: args.pageSize,
        });
        return toPage(unwrapSiigo(res, resource.listVerb.replace(/_/g, ' ')));
      },
    }),
    defineTool({
      name: `mcp_${SLUG}_${resource.getVerb}`,
      description: resource.getDescription,
      input: getInput,
      handler: async (args, ctx) => {
        const res = await client.get(`v1/${path}/${encodeURIComponent(args.id)}`, ctx.request);
        return toOutcome(unwrapSiigo(res, resource.getVerb.replace(/_/g, ' ')));
      },
    }),
  ];
}

/**
 * The curated read-only tool set (locked in B0-internal). Paginated list tools return the uniform
 * `PaginatedResult` envelope (`items`, `page`, `pageSize`, `totalResults`, `hasMore` — ADR
 * canonical-provider-pattern §2); each ITEM is Siigo's record verbatim, and get tools return the
 * resource object verbatim. No mapper, no canonical DTO (Fidelity over Unification governs the
 * records, never the envelope). Unpaginated reference-data reads return Siigo's flat array verbatim —
 * there is no upstream pagination to represent (absent fields are documented, never inferred).
 */
export function buildSiigoTools(
  client: SiigoClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any>> {
  return [
    ...resourceTools({
      client,
      path: 'customers',
      listVerb: 'list_customers',
      getVerb: 'get_customer',
      listDescription:
        'List the accounting customers (third parties) on the connected Siigo company, paginated. ' +
        'Returns the uniform paginated envelope (`items`, `page`, `pageSize`, `totalResults`, ' +
        '`hasMore`); each item is the Siigo customer verbatim — `id` (UUID), `identification` ' +
        '(NIT/cédula), `name`, `person_type`, contacts and fiscal responsibilities.',
      getDescription:
        'Get one Siigo customer by its `id` (UUID, as returned by list_customers). Returns the full ' +
        'customer object verbatim.',
    }),
    ...resourceTools({
      client,
      path: 'invoices',
      listVerb: 'list_invoices',
      getVerb: 'get_invoice',
      listDescription:
        'List the sales invoices on the connected Siigo company, paginated. Returns the uniform ' +
        'paginated envelope (`items`, `page`, `pageSize`, `totalResults`, `hasMore`); each item is ' +
        'the Siigo invoice verbatim — `id` (UUID), `number`/`name`, `date`, `customer`, `total`, ' +
        '`balance`, line `items` and `payments`.',
      getDescription:
        'Get one Siigo sales invoice by its `id` (UUID, as returned by list_invoices). Returns the ' +
        'full invoice object verbatim.',
    }),
    ...resourceTools({
      client,
      path: 'products',
      listVerb: 'list_products',
      getVerb: 'get_product',
      listDescription:
        'List the products/services on the connected Siigo company, paginated. Returns the uniform ' +
        'paginated envelope (`items`, `page`, `pageSize`, `totalResults`, `hasMore`); each item is ' +
        'the Siigo product verbatim — `id` (UUID), `code`, `name`, `account_group`, taxes, `prices` ' +
        'and stock/warehouse info.',
      getDescription:
        'Get one Siigo product by its `id` (UUID, as returned by list_products). Returns the full ' +
        'product object verbatim.',
    }),

    // -----------------------------------------------------------------------
    // Reference data (Phase 1a) — the lookups an accounting agent (and the future write path) needs.
    // Observed: these return a FLAT ARRAY verbatim, except `list_users` (paginated envelope) and the
    // two that require a filter (`list_document_types`, `list_payment_types`).
    // -----------------------------------------------------------------------
    refArrayTool(
      client,
      'list_taxes',
      'taxes',
      'List the taxes configured on the connected Siigo company (IVA, withholdings, etc.). Returns a ' +
        'flat array verbatim; each tax carries `id`, `name`, `type`, `percentage`, `active`. Use the ' +
        '`id` when composing a document that applies a tax.',
    ),
    refArrayTool(
      client,
      'list_account_groups',
      'account-groups',
      'List the product/service account groups (categorías) on the connected Siigo company. Returns a ' +
        'flat array verbatim; each carries `id`, `name`, `active`. A product references an ' +
        '`account_group` by `id`.',
    ),
    refArrayTool(
      client,
      'list_price_lists',
      'price-lists',
      'List the price lists (listas de precios) on the connected Siigo company. Returns a flat array ' +
        'verbatim; each carries `id`, `name`, `active`, `position`.',
    ),
    refArrayTool(
      client,
      'list_cost_centers',
      'cost-centers',
      'List the cost centers (centros de costo) on the connected Siigo company. Returns a flat array ' +
        'verbatim; each carries `id`, `code`, `name`, `active`.',
    ),
    refArrayTool(
      client,
      'list_warehouses',
      'warehouses',
      'List the warehouses (bodegas) on the connected Siigo company. Returns a flat array verbatim; ' +
        'each carries `id`, `name`, `active`, `has_movements`.',
    ),
    definePaginatedList({
      name: `mcp_${SLUG}_list_users`,
      description:
        'List the users (vendedores/usuarios) on the connected Siigo company, paginated — the one ' +
        'reference-data read that is paginated upstream. Returns the uniform paginated envelope ' +
        '(`items`, `page`, `pageSize`, `totalResults`, `hasMore`); each item carries `id`, ' +
        '`username`, `first_name`, `last_name`, `email`, `identification`, `active`.',
      input: z.object({}),
      handler: async (args, ctx) =>
        toPage(
          unwrapSiigo(
            await client.get('v1/users', ctx.request, {
              page: args.page,
              page_size: args.pageSize,
            }),
            'list users',
          ),
        ),
    }),
    defineTool({
      name: `mcp_${SLUG}_list_document_types`,
      description:
        'List the document types (tipos de comprobante) of a given kind on the connected Siigo ' +
        'company. `type` is REQUIRED (Siigo 400s without it) — e.g. `FV` (factura de venta), `NC` ' +
        '(nota crédito), `RC` (recibo de caja), `FC` (factura de compra). Returns a flat array ' +
        'verbatim; each carries `id`, `code`, `name`, `type`, `active` and document settings. Use the ' +
        '`id` when composing a document of that type.',
      input: z.object({ type: z.string().min(1) }).strict(),
      handler: async (args, ctx) =>
        toOutcome(
          unwrapSiigo(
            await client.get('v1/document-types', ctx.request, { type: args.type }),
            'list document types',
          ),
        ),
    }),
    defineTool({
      name: `mcp_${SLUG}_list_payment_types`,
      description:
        'List the payment methods (formas de pago) valid for a given document type on the connected ' +
        'Siigo company. `documentType` is REQUIRED (Siigo 400s without it) — e.g. `FV`, `NC`, `RC`. ' +
        'Returns a flat array verbatim; each carries `id`, `name`, `type`, `active`, `due_date`.',
      input: z.object({ documentType: z.string().min(1) }).strict(),
      handler: async (args, ctx) =>
        toOutcome(
          unwrapSiigo(
            await client.get('v1/payment-types', ctx.request, { document_type: args.documentType }),
            'list payment types',
          ),
        ),
    }),

    // -----------------------------------------------------------------------
    // Additional read resources (Phase 1b) — broader accounting context. Observed: all return the
    // standard `{ pagination, results, _links }` envelope with full records, so a paginated list is the
    // record (no `get_*` companion needed).
    // -----------------------------------------------------------------------
    listResourceTool(
      client,
      'list_purchases',
      'purchases',
      'List the purchase invoices (facturas de compra / bills from suppliers) on the connected Siigo ' +
        'company, paginated. Returns the uniform paginated envelope; each item is the Siigo purchase ' +
        'verbatim — `id`, `document`, `number`, `date`, `supplier`, `total`, `balance`, `items`, ' +
        '`retentions`, `payments`.',
    ),
    listResourceTool(
      client,
      'list_credit_notes',
      'credit-notes',
      'List the credit notes (notas crédito de venta) on the connected Siigo company, paginated. ' +
        'Returns the uniform paginated envelope; each item carries `id`, `document`, `number`, ' +
        '`date`, the related `invoice`, `customer`, `seller`, `total`, `items`, `payments`.',
    ),
    listResourceTool(
      client,
      'list_vouchers',
      'vouchers',
      'List the cash receipts (recibos de caja / vouchers) on the connected Siigo company, paginated. ' +
        'Returns the uniform paginated envelope; each item carries `id`, `document`, `number`, ' +
        '`date`, `type`, `customer`, `items`, `payment`.',
    ),
    listResourceTool(
      client,
      'list_journals',
      'journals',
      'List the accounting journal entries (comprobantes contables) on the connected Siigo company, ' +
        'paginated. Returns the uniform paginated envelope; each item carries `id`, `document`, ' +
        '`number`, `date`, `items`, `observations`.',
    ),
    listResourceTool(
      client,
      'list_quotations',
      'quotations',
      'List the sales quotations (cotizaciones) on the connected Siigo company, paginated. Returns ' +
        'the uniform paginated envelope; each item carries `id`, `document`, `number`, `date`, ' +
        '`customer`, `seller`, `total`, `items`, `public_url`.',
    ),
  ];
}
