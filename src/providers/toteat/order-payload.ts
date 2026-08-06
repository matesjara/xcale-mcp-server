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

/** What a caller declares: a product and the extras that belong to it, explicitly. */
export interface ToteatOrderLineInput {
  readonly productCode: string;
  readonly quantity: number;
  readonly comment?: string;
  readonly modifiers?: ReadonlyArray<{ readonly productCode: string; readonly quantity: number }>;
}

/** What Toteat receives: a flat list where position carries the meaning. */
export interface ToteatWireLine {
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
    out.push(wireLine(out.length + 1, line.productCode, line.quantity, line.comment));
    for (const modifier of line.modifiers ?? []) {
      out.push(wireLine(out.length + 1, modifier.productCode, modifier.quantity));
    }
  }
  return out;
}

function wireLine(
  lineNumber: number,
  productCode: string,
  quantity: number,
  comment?: string,
): ToteatWireLine {
  return comment === undefined
    ? { lineNumber, productCode, quantity }
    : { lineNumber, productCode, quantity, comment };
}
