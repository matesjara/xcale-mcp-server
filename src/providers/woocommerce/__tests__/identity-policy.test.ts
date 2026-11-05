import { describe, expect, it } from 'vitest';

import { woocommerceProvider } from '../index';

/**
 * An order or a customer read reaches a person: their name, email, phone and address. A consumer
 * cannot tell that from a name, a description and a schema, so the provider says it and
 * `tools/list` carries it. An absent policy means the tool touches no person's records, so every
 * tool that does must declare one.
 */
describe('woocommerce publishes whose data each tool can reach', () => {
  const published = woocommerceProvider.listTools();
  const byName = new Map(published.map((t) => [t.name, t]));

  it('marks the order list as returning other people without naming anyone', () => {
    expect(byName.get('mcp_woocommerce_list_orders')?.identityPolicy).toEqual({
      mode: 'subject-scoped',
    });
  });

  it('binds the reads and writes of one order or customer to the person who owns it', () => {
    // An order id and a customer id live in different id spaces: order 42 is not customer 42.
    for (const [name, kind] of [
      ['mcp_woocommerce_update_order', 'woocommerce:order'],
      ['mcp_woocommerce_get_customer', 'woocommerce:customer'],
      ['mcp_woocommerce_update_customer', 'woocommerce:customer'],
    ] as const) {
      expect(byName.get(name)?.identityPolicy, name).toEqual({
        mode: 'subject-bound',
        identityFields: [],
        recordOwnershipField: 'id',
        recordOwnershipKind: kind,
      });
    }
  });

  it('declares the order read as a read of one record by its id (ADR 0023 recordAction)', () => {
    // A consumer may serve it a record its customer already found; `update_order` stays undeclared as
    // an action: a status write is not one a customer may make on their own order.
    expect(byName.get('mcp_woocommerce_get_order')?.identityPolicy).toEqual({
      mode: 'subject-bound',
      identityFields: [],
      recordOwnershipField: 'id',
      recordOwnershipKind: 'woocommerce:order',
      recordAction: 'read',
    });
  });

  it('declares both customer-search filters, since either asks about a person', () => {
    expect(byName.get('mcp_woocommerce_list_customers')?.identityPolicy).toEqual({
      mode: 'subject-bound',
      identityFields: ['email', 'search'],
    });
  });

  it('declares the customer order lookup, each row bound by the billing contact it was placed with', () => {
    expect(byName.get('mcp_woocommerce_find_customer_orders')?.identityPolicy).toEqual({
      mode: 'subject-bound',
      identityFields: ['customerPhone', 'customerEmail'],
      identityFieldKinds: { customerPhone: 'phone', customerEmail: 'email' },
      recordLookup: true,
      recordKind: 'order',
      resultItemsPath: 'items',
      resultIdentityFields: { customerPhone: 'phone', customerEmail: 'email' },
      resultRecordIdField: 'id',
      recordOwnershipKind: 'woocommerce:order',
      projection: ['number', 'status', 'total', 'currency', 'dateCreated', 'items'],
      resultDateField: 'dateCreated',
    });
    expect(byName.get('mcp_woocommerce_find_customer_orders')?.readOnly).toBe(true);
  });

  it('every declared field exists in the tool it belongs to', () => {
    // A field name that does not match the schema declares protection over nothing.
    for (const tool of published) {
      const policy = tool.identityPolicy;
      if (policy?.mode !== 'subject-bound') continue;
      const properties = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      );
      for (const field of [
        ...policy.identityFields,
        ...(policy.recordOwnershipField ? [policy.recordOwnershipField] : []),
      ]) {
        expect(properties, `${tool.name}: ${field} is not in its input schema`).toContain(field);
      }
    }
  });

  it('leaves catalog tools alone', () => {
    expect(byName.get('mcp_woocommerce_list_products')?.identityPolicy).toBeUndefined();
    expect(byName.get('mcp_woocommerce_list_shipping_zones')?.identityPolicy).toBeUndefined();
  });
});
