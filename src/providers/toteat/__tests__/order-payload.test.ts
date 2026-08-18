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

/**
 * The money on a line.
 *
 * Toteat answered `Invalid Parameters` to the first order payload it ever evaluated for us — one
 * that named dishes and quantities and priced none of them (2026-08-18; every earlier attempt died
 * on a closed shift, so this was invisible). Its `Lines` schema marks the genuinely optional fields
 * as optional and says nothing of the sort about the amounts.
 *
 * The rule that must not drift: an amount is carried when the caller knows it and OMITTED when it
 * does not. Defaulting to zero would tell a venue its food is free.
 */
describe('buildOrderLines — the money', () => {
  it('carries the amount, name and category of each product', () => {
    const [line] = buildOrderLines([
      {
        productCode: 'SB011',
        quantity: 2,
        amountAfterTax: 45800,
        productName: 'Hamburguesa Res Home',
        category: 'Hamburguesas Artesanales',
      },
    ]);

    // A line total, not a unit price: two burgers at 22.900 are 45.800 on one line, and a venue
    // that read this as the unit price would charge half.
    expect(line).toMatchObject({
      productCode: 'SB011',
      quantity: 2,
      amountAfterTax: 45800,
      productName: 'Hamburguesa Res Home',
      category: 'Hamburguesas Artesanales',
    });
  });

  it('prices an extra on its own line, not folded into its dish', () => {
    const lines = buildOrderLines([
      {
        productCode: 'SB011',
        quantity: 1,
        amountAfterTax: 22900,
        modifiers: [{ productCode: 'SB129', quantity: 1, amountAfterTax: 1500 }],
      },
    ]);

    // Toteat treats an extra as an ordinary line, so its price belongs to it. Adding it to the
    // dish's amount would make the comanda disagree with the venue's own product list.
    expect(lines.map((l) => l.amountAfterTax)).toEqual([22900, 1500]);
  });

  it('OMITS an amount the caller does not know, rather than sending zero', () => {
    const [line] = buildOrderLines([{ productCode: 'SB011', quantity: 1 }]);

    // The dangerous default. `0` is not "unknown", it is a claim that the dish is free — and a
    // venue that honoured it would hand over food for nothing.
    expect('amountAfterTax' in line!).toBe(false);
    expect('productName' in line!).toBe(false);
    expect('category' in line!).toBe(false);
  });

  it('still binds extras positionally once amounts are in play', () => {
    const lines = buildOrderLines([
      {
        productCode: 'burger-A',
        quantity: 1,
        amountAfterTax: 100,
        modifiers: [{ productCode: 'tomate', quantity: 1, amountAfterTax: 10 }],
      },
      { productCode: 'burger-B', quantity: 1, amountAfterTax: 200 },
    ]);

    // The association is still the only thing carrying meaning; adding fields must not reorder.
    expect(lines.map((l) => l.productCode)).toEqual(['burger-A', 'tomate', 'burger-B']);
    expect(lines.map((l) => l.lineNumber)).toEqual([1, 2, 3]);
  });
});
