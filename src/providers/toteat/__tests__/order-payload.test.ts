import { describe, expect, it } from 'vitest';

import { buildOrderLines } from '../order-payload';

/**
 * The mutation set for positional modifiers. Toteat binds each extra to the most recent
 * non-modifier product ABOVE it, so array order is the only thing carrying the association — and a
 * wrong association is invisible: the order succeeds and the kitchen plates the wrong dish.
 *
 * Every test here asserts the ORDER of the emitted lines, not just their presence. A test that only
 * checked "the avocado is in there" would stay green with the avocado on the wrong burger, which is
 * exactly the bug.
 */
describe('buildOrderLines', () => {
  it('emits each modifier immediately after its own product', () => {
    const lines = buildOrderLines([
      {
        productCode: 'hamburguesa',
        quantity: 1,
        modifiers: [{ productCode: 'palta', quantity: 1 }],
      },
      { productCode: 'pizza', quantity: 1 },
    ]);

    expect(lines.map((l) => l.productCode)).toEqual(['hamburguesa', 'palta', 'pizza']);
  });

  it('keeps two products distinguishable when both carry extras', () => {
    const lines = buildOrderLines([
      { productCode: 'burger-A', quantity: 1, modifiers: [{ productCode: 'tomate', quantity: 1 }] },
      { productCode: 'burger-B', quantity: 1, modifiers: [{ productCode: 'palta', quantity: 1 }] },
    ]);

    // The whole point: `palta` must sit after burger-B, never after burger-A.
    expect(lines.map((l) => l.productCode)).toEqual(['burger-A', 'tomate', 'burger-B', 'palta']);
    // And stated as the association itself, so the intent survives a refactor of the array shape.
    const paltaIndex = lines.findIndex((l) => l.productCode === 'palta');
    const lastProductAbove = lines
      .slice(0, paltaIndex)
      .reverse()
      .find((l) => l.productCode.startsWith('burger'));
    expect(lastProductAbove?.productCode).toBe('burger-B');
  });

  it('preserves the declared order of several modifiers on one product', () => {
    const lines = buildOrderLines([
      {
        productCode: 'hamburguesa',
        quantity: 1,
        modifiers: [
          { productCode: 'tomate', quantity: 1 },
          { productCode: 'palta', quantity: 2 },
        ],
      },
    ]);

    expect(lines.map((l) => l.productCode)).toEqual(['hamburguesa', 'tomate', 'palta']);
    expect(lines[2]?.quantity).toBe(2);
  });

  it('numbers lines 1-based and sequentially across the flattened list', () => {
    const lines = buildOrderLines([
      { productCode: 'a', quantity: 1, modifiers: [{ productCode: 'a-extra', quantity: 1 }] },
      { productCode: 'b', quantity: 1 },
    ]);

    // Not 1,1,2 (per-product) and not 0-based — the modifier consumes a line number of its own.
    expect(lines.map((l) => l.lineNumber)).toEqual([1, 2, 3]);
  });

  it('treats a product with no modifiers and one with an empty list identically', () => {
    const omitted = buildOrderLines([{ productCode: 'x', quantity: 1 }]);
    const empty = buildOrderLines([{ productCode: 'x', quantity: 1, modifiers: [] }]);

    expect(omitted).toEqual(empty);
    expect(omitted).toHaveLength(1);
  });

  it('carries a product comment but never invents one for a modifier', () => {
    const lines = buildOrderLines([
      {
        productCode: 'cafe',
        quantity: 1,
        comment: 'sin azucar',
        modifiers: [{ productCode: 'leche', quantity: 1 }],
      },
    ]);

    expect(lines[0]).toMatchObject({ productCode: 'cafe', comment: 'sin azucar' });
    expect(lines[1]).not.toHaveProperty('comment');
  });
});
