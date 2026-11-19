import { z } from 'zod';

import { e164, id, uuid } from './schemas';

const orderLine = z
  .object({
    productId: id,
    menuId: id,
    qty: z.number().int().min(1).max(999),
    note: z.string().max(500).optional(),
    productPriceId: id.optional(),
    productPriceOptionId: id.optional(),
    modifiers: z
      .array(
        z
          .object({ modifierGroupId: id, modifierId: id, quantity: z.number().int().min(1) })
          .strict(),
      )
      .optional(),
  })
  .strict();

/**
 * An order before it exists: what quote_order prices and create_order places. The customer and the
 * delivery are grouped so a delivery field is never mixed into a takeout order by accident; Restofy's body
 * is flat, and `toCreateOrderBody` spreads them back.
 */
export const orderDraft = z
  .object({
    fulfillmentUuid: uuid,
    items: z.array(orderLine).min(1).max(100),
    customer: z
      .object({ name: z.string().min(1).max(150).optional(), phone: e164.optional() })
      .strict()
      .optional(),
    delivery: z
      .object({
        addressLine: z.string().min(1).max(300),
        addressDetail: z.string().max(200).optional(),
        reference: z.string().max(300).optional(),
        municipalityCode: z.string().max(10).optional(),
        deliveryZoneId: id.optional(),
        deliveryFeeCents: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
    notes: z.string().max(500).optional(),
    channelCode: z.string().min(1).max(60).optional(),
  })
  .strict();

export type OrderDraft = z.infer<typeof orderDraft>;

/** The draft as Restofy's flat `create-order` body (contract §A.8), without the reference. */
export function toCreateOrderBody(draft: OrderDraft, dryRun: boolean): Record<string, unknown> {
  const { customer, delivery, ...rest } = draft;
  return {
    ...rest,
    ...(customer?.name === undefined ? {} : { customerName: customer.name }),
    ...(customer?.phone === undefined ? {} : { customerPhone: customer.phone }),
    ...delivery,
    ...(dryRun ? { dryRun: true } : {}),
  };
}
