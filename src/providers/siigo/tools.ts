import { z } from 'zod';

import { defineTool, ok, type ToolDefinition, type ToolOutcome } from '../../core/tool';
import type { SiigoClient } from './client';
import { unwrapSiigo } from './errors';
import { SLUG } from './manifest';

/**
 * Uniform list input. `page` is 1-based; `pageSize` maps to Siigo's wire `page_size`. Observed B1:
 * Siigo's default page_size is 25 and it CLAMPS any value below 10 up to 10 — we accept the caller's
 * value verbatim and let Siigo apply its own floor (Fidelity over Unification), rather than second-
 * guessing it here. The upper bound is a sane guard, not a wire claim.
 */
const listInput = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
  })
  .strict();

/** Get-by-id input. Siigo resource ids are UUIDs. */
const getInput = z.object({ id: z.string().min(1) }).strict();

/** No-argument input, for the reference-data reads that take no filter. */
const noArgs = z.object({}).strict();

function toOutcome(result: ReturnType<typeof unwrapSiigo>): ToolOutcome {
  return result.ok ? ok(result.data) : { ok: false, code: result.code, message: result.message };
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
 * envelope with complete objects). No `get_*` companion — the list is the record. Passthrough-verbatim.
 */
function listResourceTool(
  client: SiigoClient,
  verb: string,
  path: string,
  description: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ToolDefinition<any> {
  return defineTool({
    name: `mcp_${SLUG}_${verb}`,
    description,
    input: listInput,
    handler: async (args, ctx) =>
      toOutcome(
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

/** One resource family: a paginated `list_*` and a by-id `get_*`, both passthrough-verbatim. */
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
    defineTool({
      name: `mcp_${SLUG}_${resource.listVerb}`,
      description: resource.listDescription,
      input: listInput,
      handler: async (args, ctx) => {
        const res = await client.get(`v1/${path}`, ctx.request, {
          page: args.page,
          page_size: args.pageSize,
        });
        return toOutcome(unwrapSiigo(res, resource.listVerb.replace('_', ' ')));
      },
    }),
    defineTool({
      name: `mcp_${SLUG}_${resource.getVerb}`,
      description: resource.getDescription,
      input: getInput,
      handler: async (args, ctx) => {
        const res = await client.get(`v1/${path}/${encodeURIComponent(args.id)}`, ctx.request);
        return toOutcome(unwrapSiigo(res, resource.getVerb.replace('_', ' ')));
      },
    }),
  ];
}

/**
 * The curated read-only tool set (locked in B0-internal). Each tool returns Siigo's response VERBATIM
 * — list tools return the full `{ pagination, results, _links }` envelope so the agent can page; get
 * tools return the resource object. No mapper, no canonical DTO (Fidelity over Unification).
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
        'Returns the Siigo response verbatim: `{ pagination, results, _links }`. Each customer carries ' +
        'its `id` (UUID), `identification` (NIT/cédula), `name`, `person_type`, contacts and fiscal ' +
        'responsibilities.',
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
        'List the sales invoices on the connected Siigo company, paginated. Returns the Siigo ' +
        'response verbatim: `{ pagination, results, _links }`. Each invoice carries its `id` (UUID), ' +
        '`number`/`name`, `date`, `customer`, `total`, `balance`, line `items` and `payments`.',
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
        'List the products/services on the connected Siigo company, paginated. Returns the Siigo ' +
        'response verbatim: `{ pagination, results, _links }`. Each product carries its `id` (UUID), ' +
        '`code`, `name`, `account_group`, taxes, `prices` and stock/warehouse info.',
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
    defineTool({
      name: `mcp_${SLUG}_list_users`,
      description:
        'List the users (vendedores/usuarios) on the connected Siigo company, paginated. Unlike the ' +
        'other reference-data reads this returns the `{ pagination, results }` envelope verbatim; each ' +
        'user carries `id`, `username`, `first_name`, `last_name`, `email`, `identification`, `active`.',
      input: listInput,
      handler: async (args, ctx) =>
        toOutcome(
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
        'company, paginated. Returns the `{ pagination, results, _links }` envelope verbatim; each ' +
        'purchase carries `id`, `document`, `number`, `date`, `supplier`, `total`, `balance`, `items`, ' +
        '`retentions`, `payments`.',
    ),
    listResourceTool(
      client,
      'list_credit_notes',
      'credit-notes',
      'List the credit notes (notas crédito de venta) on the connected Siigo company, paginated. ' +
        'Returns the envelope verbatim; each carries `id`, `document`, `number`, `date`, the related ' +
        '`invoice`, `customer`, `seller`, `total`, `items`, `payments`.',
    ),
    listResourceTool(
      client,
      'list_vouchers',
      'vouchers',
      'List the cash receipts (recibos de caja / vouchers) on the connected Siigo company, paginated. ' +
        'Returns the envelope verbatim; each carries `id`, `document`, `number`, `date`, `type`, ' +
        '`customer`, `items`, `payment`.',
    ),
    listResourceTool(
      client,
      'list_journals',
      'journals',
      'List the accounting journal entries (comprobantes contables) on the connected Siigo company, ' +
        'paginated. Returns the envelope verbatim; each carries `id`, `document`, `number`, `date`, ' +
        '`items`, `observations`.',
    ),
    listResourceTool(
      client,
      'list_quotations',
      'quotations',
      'List the sales quotations (cotizaciones) on the connected Siigo company, paginated. Returns the ' +
        'envelope verbatim; each carries `id`, `document`, `number`, `date`, `customer`, `seller`, ' +
        '`total`, `items`, `public_url`.',
    ),
  ];
}
