/**
 * Order payload assembly — the positional-modifier problem, isolated so it can be tested alone.
 *
 * ## Why this file exists
 *
 * Toteat has no field associating a modifier with the product it belongs to. Extras are sent as
 * ordinary `line` entries, and each one binds to **the most recent non-modifier product above it**.
 * From the vendor spec:
 *
 *     [ {hamburguesa}, {tomate}, {palta}, {pizza} ]
 *     → tomate and palta are extras OF hamburguesa; pizza has none.
 *
 * **Array order IS the association.** One position off puts the avocado on the wrong burger, the
 * kitchen plates it, and nothing in the response says anything went wrong.
 *
 * A flat array with an implicit rule is exactly the shape a language model gets subtly wrong, and
 * the failure is invisible in the tool result. So the tool's input is explicit and nested, and this
 * pure function does the flattening. The model never composes the flat array.
 */

/**
 * The money and naming a line carries, when the caller knows them.
 *
 * Toteat rejected an order that named products and quantities but no amounts with a bare
 * `Invalid Parameters` (observed 2026-08-18, the first payload it ever evaluated for us — every
 * earlier attempt died on a closed shift). Its `Lines` schema marks `comment`, `discount`,
 * `seatNumber` and `categoryCode` as optional and says nothing of the sort about the amounts, and
 * every example in the vendor spec carries them.
 *
 * Optional HERE all the same, because the gateway must not invent money: a caller that cannot price
 * a line sends it without a price and gets the venue's answer, rather than a number we made up.
 */
export interface ToteatLineMoney {
  /** What this line costs in total, tax included — unit price × quantity, never a unit price. */
  readonly amountAfterTax?: number;
  /** The dish's own name, as the venue spells it. Printed on the comanda. */
  readonly productName?: string;
  /** The venue's own category for the dish. */
  readonly category?: string;
}

/** What a caller declares: a product and the extras that belong to it, explicitly. */
export interface ToteatOrderLineInput extends ToteatLineMoney {
  readonly productCode: string;
  readonly quantity: number;
  readonly comment?: string;
  readonly modifiers?: ReadonlyArray<
    { readonly productCode: string; readonly quantity: number } & ToteatLineMoney
  >;
}

/** What Toteat receives: a flat list where position carries the meaning. */
export interface ToteatWireLine extends ToteatLineMoney {
  readonly lineNumber: number;
  readonly productCode: string;
  readonly quantity: number;
  readonly comment?: string;
}

/**
 * Flatten declared lines into Toteat's positional wire format.
 *
 * Each product is emitted, then its modifiers immediately after it — which is the whole contract.
 * `lineNumber` is 1-based and sequential across the flattened list, matching the vendor's examples.
 *
 * Pure and total: no I/O, no clock, no randomness. That is what makes the mutation test meaningful —
 * displace one modifier by a single position and a test must go red.
 */
export function buildOrderLines(lines: readonly ToteatOrderLineInput[]): ToteatWireLine[] {
  const out: ToteatWireLine[] = [];
  for (const line of lines) {
    out.push(wireLine(out.length + 1, line, line.comment));
    for (const modifier of line.modifiers ?? []) {
      // An extra is a line of its own and carries its OWN price. Folding it into the dish's amount
      // would make the comanda's arithmetic disagree with the venue's own product list.
      out.push(wireLine(out.length + 1, modifier));
    }
  }
  return out;
}

function wireLine(
  lineNumber: number,
  src: { readonly productCode: string; readonly quantity: number } & ToteatLineMoney,
  comment?: string,
): ToteatWireLine {
  return {
    lineNumber,
    productCode: src.productCode,
    quantity: src.quantity,
    ...(comment === undefined ? {} : { comment }),
    // Omitted, never defaulted to 0: a zero amount is a claim that the dish is free, and a venue
    // that prices its food would be told to hand it over for nothing.
    ...(src.amountAfterTax === undefined ? {} : { amountAfterTax: src.amountAfterTax }),
    ...(src.productName === undefined ? {} : { productName: src.productName }),
    ...(src.category === undefined ? {} : { category: src.category }),
  };
}
