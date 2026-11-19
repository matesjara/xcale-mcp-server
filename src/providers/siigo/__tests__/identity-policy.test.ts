import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { IDENTITY_POLICY_META_KEY, type ToolIdentityPolicy } from '../../../core/types';
import { createSiigoProvider } from '../provider';

/**
 * A Siigo customer, invoice, credit note, voucher, quotation, purchase or user is a third party's
 * record: name, identification (NIT/cédula), contacts, what they bought or are owed. A consumer cannot
 * tell that from a name, a description and a schema, so the provider says it and `tools/list` carries
 * it (ADR 0019, ADR 0023). An absent policy means the tool touches no person's records, so every tool
 * that does must declare one. Every tool is enumerated, so a new undeclared tool fails here.
 */
const SCOPED: ToolIdentityPolicy = { mode: 'subject-scoped' };

const bound = (kind: string): ToolIdentityPolicy => ({
  mode: 'subject-bound',
  identityFields: [],
  recordOwnershipField: 'id',
  recordOwnershipKind: kind,
  recordAction: 'read',
});

const EXPECTED: Record<string, ToolIdentityPolicy | undefined> = {
  mcp_siigo_list_customers: SCOPED,
  mcp_siigo_get_customer: bound('siigo:customer'),
  mcp_siigo_list_invoices: SCOPED,
  mcp_siigo_get_invoice: bound('siigo:invoice'),
  mcp_siigo_list_credit_notes: SCOPED,
  mcp_siigo_list_quotations: SCOPED,
  mcp_siigo_list_vouchers: SCOPED,
  mcp_siigo_list_purchases: SCOPED,
  mcp_siigo_list_journals: SCOPED,
  mcp_siigo_list_users: SCOPED,
  // Reference data and the catalog: no person's record.
  mcp_siigo_list_products: undefined,
  mcp_siigo_get_product: undefined,
  mcp_siigo_list_taxes: undefined,
  mcp_siigo_list_account_groups: undefined,
  mcp_siigo_list_price_lists: undefined,
  mcp_siigo_list_cost_centers: undefined,
  mcp_siigo_list_warehouses: undefined,
  mcp_siigo_list_document_types: undefined,
  mcp_siigo_list_payment_types: undefined,
};

describe('siigo publishes whose data each tool can reach', () => {
  const published = createSiigoProvider({ partnerId: 'test' }).listTools();
  const byName = new Map(published.map((t) => [t.name, t]));

  it('enumerates every published tool, so a new one cannot ship undeclared', () => {
    expect(published.map((t) => t.name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))('%s declares the expected policy', (name, policy) => {
    expect(byName.get(name)?.identityPolicy).toEqual(policy);
  });

  it('carries no policy on any reference-data or catalog tool', () => {
    for (const [name, policy] of Object.entries(EXPECTED)) {
      if (policy === undefined) {
        expect(byName.get(name)?.identityPolicy, name).toBeUndefined();
      }
    }
  });

  it('uses no audience gate on any tool', () => {
    for (const tool of published) expect(tool.audience, tool.name).toBeUndefined();
  });

  it('never sets alwaysEnforce', () => {
    for (const tool of published) {
      expect(tool.identityPolicy ?? {}, tool.name).not.toHaveProperty('alwaysEnforce');
    }
  });

  it('every declared bound field exists in the tool input schema', () => {
    for (const tool of published) {
      const policy = tool.identityPolicy;
      if (policy?.mode !== 'subject-bound') continue;
      const properties = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      );
      if (policy.recordOwnershipField) {
        expect(properties, tool.name).toContain(policy.recordOwnershipField);
      }
    }
  });

  it('the published policy survives ToolSchema parsing in _meta', () => {
    // A top-level `identityPolicy` is stripped by the SDK's zod schema; `_meta` survives.
    for (const tool of published) {
      if (!tool.identityPolicy) continue;
      const parsed = ToolSchema.parse({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        _meta: { [IDENTITY_POLICY_META_KEY]: tool.identityPolicy },
      });
      expect(parsed._meta?.[IDENTITY_POLICY_META_KEY], tool.name).toEqual(tool.identityPolicy);
    }
    expect(IDENTITY_POLICY_META_KEY).toBe('xcale.app/identityPolicy');
  });
});
