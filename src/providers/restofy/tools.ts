import { z } from 'zod';

import { defineTool, ok, type ToolDefinition } from '../../core/tool';
import type { ToolIdentityPolicy } from '../../core/types';
import type { RestofyClient } from './client';
import { refusedWith, toOutcome } from './errors';
import { idempotencyKey, quoteReference } from './idempotency';
import { SLUG } from './manifest';
import { orderDraft, toCreateOrderBody } from './order-body';
import { buildReservationTools } from './reservation-tools';
import { e164, uuid } from './schemas';

const NO_ARGS = z.object({}).strict();

/** The tool acts on the person its `phone` names (ADR 0019, 0023). */
const PHONE_BOUND: ToolIdentityPolicy = {
  mode: 'subject-bound',
  identityFields: ['phone'],
  identityFieldKinds: { phone: 'phone' },
};

/** Restofy's sentence for an order it cannot find (observed): "No encontramos ese pedido. …". */
const ORDER_NOT_FOUND = 'No encontramos ese pedido';

export function buildRestofyTools(client: RestofyClient): ToolDefinition[] {
  return [
    defineTool({
      name: `mcp_${SLUG}_get_business_profile`,
      description:
        "The restaurant's public profile, its weekly opening schedule, its timezone and whether it is " +
        'open right now (`isOpenNow`), and `tenant`: the `currency` every amount is in (cents of it), ' +
        'its public `slug` and `locale`. Read it before promising a delivery or a time.',
      input: NO_ARGS,
      readOnly: true,
      audience: 'customer',
      handler: async (_args, ctx) => {
        const profile = toOutcome(
          await client.call('business-profile/get-business-profile', ctx.request),
        );
        if (!profile.ok) return profile;
        // The account facts live on a second Restofy read (observed 2026-11-18). Best-effort: a
        // failure there never costs the profile, it only leaves `tenant` out.
        const tenant = toOutcome(await client.call('tenants/get-tenant-info', ctx.request));
        if (!tenant.ok) return profile;
        const { currency, slug, locale } = (tenant.data ?? {}) as Record<string, unknown>;
        return ok({ ...(profile.data as object), tenant: { currency, slug, locale } });
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_list_fulfillments`,
      description:
        "The restaurant's delivery channels for orders taken by an integration (delivery, takeout, " +
        'curbside…), each with its `fulfillmentUuid` — the id the menu and every order need — its fee ' +
        'mode, and, beside the list, `deliveryZones` for channels that charge by zone. Dine-in is never listed. An EMPTY ' +
        '`fulfillments` means the restaurant has not created a delivery or takeout channel in Restofy, ' +
        'so no menu can be read and no order placed until it does.',
      input: z.object({ channelCode: z.string().min(1).max(60).optional() }).strict(),
      readOnly: true,
      audience: 'customer',
      handler: async (args, ctx) =>
        toOutcome(await client.call('integration/list-fulfillments', ctx.request, { ...args })),
    }),

    defineTool({
      name: `mcp_${SLUG}_list_catalog`,
      description:
        "The restaurant's menu for ONE delivery channel (`fulfillmentUuid` from list_fulfillments — " +
        'prices may differ between channels): menus, categories, products with `basePriceCents`, ' +
        'alternate prices and their options, modifier groups with `minSelections`/`maxSelections` ' +
        '(a group with minSelections ≥ 1 must be chosen; such products have `requiresConfig: true`), ' +
        'modifiers with their price, and allergens. Every amount is an integer in CENTS of the ' +
        "restaurant's currency (COP 32.000 is 3200000). Paged at up to 100 products; groups and " +
        'modifiers come with the page of products they belong to. The total to confirm comes from ' +
        'quote_order, never from adding up this menu.',
      input: z
        .object({
          fulfillmentUuid: uuid,
          menuId: z.number().int().positive().optional(),
          page: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).default(100),
        })
        .strict(),
      readOnly: true,
      audience: 'customer',
      handler: async (args, ctx) =>
        toOutcome(await client.call('integration/list-catalog-products', ctx.request, { ...args })),
    }),

    defineTool({
      name: `mcp_${SLUG}_quote_order`,
      description:
        'Price an order WITHOUT placing it: Restofy validates every line, option and the delivery ' +
        'data, and computes the totals in cents (`subtotalCents`, `deliveryFeeCents`, ' +
        '`grandTotalCents`) on the given channel. Nothing is saved. Quote on the channel the diner ' +
        'chose (delivery or takeout) and confirm THIS total, never one added up from the menu. A ' +
        'refusal names what is missing (a required option, the delivery address) in a sentence for ' +
        'a person. Delivery needs `customer.name`, `customer.phone` (E.164) and ' +
        '`delivery.addressLine`. The order goes in unpaid; how it is paid is the restaurant’s.',
      input: orderDraft,
      readOnly: true,
      audience: 'customer',
      handler: async (draft, ctx) => {
        const unreferenced = toCreateOrderBody(draft, true);
        const ref = quoteReference(unreferenced);
        const body = { externalReference: ref, ...unreferenced };
        return toOutcome(
          await client.call('integration/create-order', ctx.request, body, {
            'Idempotency-Key': idempotencyKey(ref, body),
          }),
        );
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_get_order`,
      description:
        'Follow one order by its `orderUuid`: `lifecycleStatus` (e.g. `open`), `paymentStatus` (e.g. ' +
        '`unpaid`) and, on delivery, `deliveryStatus` (`pending`, `in_transit`, `delivered`, `failed`, ' +
        '`cancelled`), with its lines and totals in cents, as Restofy returns them. Restofy does NOT ' +
        'expose kitchen stages to integrations: an order being cooked or ready still reads `open`, ' +
        'so never tell a diner it is being prepared or ready from this alone.',
      input: z.object({ orderUuid: uuid }).strict(),
      readOnly: true,
      audience: 'customer',
      identityPolicy: {
        mode: 'subject-bound',
        identityFields: [],
        recordOwnershipField: 'orderUuid',
        recordOwnershipKind: `${SLUG}:order`,
        recordAction: 'read',
      },
      handler: async (args, ctx) =>
        toOutcome(await client.call('integration/get-order', ctx.request, { ...args })),
    }),

    defineTool({
      name: `mcp_${SLUG}_find_order_by_reference`,
      description:
        'Find the order the caller placed under its own `externalReference`, to reconcile a create ' +
        'whose answer was lost. `{ found: false }` means it never landed.',
      input: z.object({ externalReference: z.string().min(1).max(60) }).strict(),
      readOnly: true,
      // Withdrawn from tools/list: reconciliation by the caller's own reference is the consumer's job.
      controlPlane: true,
      handler: async (args, ctx) => {
        const result = await client.call('integration/get-order', ctx.request, { ...args });
        if (refusedWith(result, ORDER_NOT_FOUND)) return ok({ found: false });
        const outcome = toOutcome(result);
        return outcome.ok ? ok({ found: true, ...(outcome.data as object) }) : outcome;
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_create_order`,
      description:
        'Place an order in the restaurant’s POS under the caller’s own `externalReference`. Restofy ' +
        'creates it atomically and AT MOST ONCE per reference: a reference already used returns the ' +
        'existing order with `isExistingOrder: true` — possibly with other contents than this call ' +
        'sent — never a second order. The order goes in `open` and `unpaid`; the channel’s rules ' +
        'decide whether it goes straight to the kitchen. Restofy prices it from the menu; no amount ' +
        'is sent except `delivery.deliveryFeeCents` in the manual fee mode.',
      input: orderDraft.extend({ externalReference: z.string().min(1).max(60) }).strict(),
      // Withdrawn from tools/list [CTO 2026-11-18, #224]: the backend's commerce materialization owns
      // the confirm and the reference. Restofy blocks duplicates only per `externalReference`, so an
      // agent calling this with its own reference while commerce calls it with another could send one
      // diner's order to the kitchen twice. The agent still orders, through the commerce tools.
      controlPlane: true,
      handler: async ({ externalReference, ...draft }, ctx) => {
        const body = { externalReference, ...toCreateOrderBody(draft, false) };
        return toOutcome(
          await client.call('integration/create-order', ctx.request, body, {
            'Idempotency-Key': idempotencyKey(externalReference, body),
          }),
        );
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_find_contact_by_phone`,
      description:
        'Find the restaurant’s contact (a diner) with EXACTLY this phone, in E.164 (`+573001112233`): ' +
        'Restofy matches the phone as written, so `3001112233` does not find `+573001112233`. Returns ' +
        '`{ found: false }` or `{ found: true, contact: { id, phone, name, notes } }`; `contact.id` is ' +
        'the `partyId` a reservation needs.',
      input: z.object({ phone: e164 }).strict(),
      readOnly: true,
      audience: 'customer',
      identityPolicy: PHONE_BOUND,
      handler: async (args, ctx) => {
        const outcome = toOutcome(
          await client.call('parties/get-party-by-phone', ctx.request, { ...args }),
        );
        return outcome.ok ? ok(asLookup(outcome.data)) : outcome;
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_create_contact`,
      description:
        'Make sure the restaurant has this diner as a contact. If a contact with exactly this phone ' +
        '(E.164) already exists, it is returned UNCHANGED (`created: false`) — its name stays as the ' +
        'restaurant has it, whatever name is given here; this tool never renames or edits a contact. ' +
        'Otherwise it is created with the name and phone (`created: true`). `contact.id` is the ' +
        '`partyId` a reservation needs.',
      input: z.object({ phone: e164, name: z.string().trim().min(1).max(150) }).strict(),
      audience: 'customer',
      identityPolicy: PHONE_BOUND,
      handler: async ({ phone, name }, ctx) => {
        // Look first: Restofy's set-party on a phone it already has RENAMES that contact (observed
        // 2026-11-18). A diner typing another name must never rename the restaurant's customer
        // [CTO 2026-11-18, AD-7].
        const lookup = toOutcome(
          await client.call('parties/get-party-by-phone', ctx.request, { phone }),
        );
        if (!lookup.ok) return lookup;
        const existing = asLookup(lookup.data);
        if (existing.found) return ok({ created: false, contact: existing.contact });

        const created = toOutcome(
          await client.call('parties/set-party', ctx.request, { name, phone }),
        );
        return created.ok
          ? ok({ created: true, contact: contactOf((created.data as PartyData).party) })
          : created;
      },
    }),
    ...buildReservationTools(client),
  ];
}

/** A Restofy party (contact), as get-party-by-phone and set-party answer it (contract §A.10). */
interface Party {
  readonly id: number;
  readonly phone: string | null;
  readonly name: string | null;
  readonly notes: string | null;
}
interface PartyData {
  readonly party?: Party | null;
}

/** Who the contact is — the sub-lists (addresses, invoice recipients, suppliers…) are left out. */
function contactOf(party: Party | null | undefined): Party | null {
  if (!party) return null;
  return { id: party.id, phone: party.phone, name: party.name, notes: party.notes };
}

function asLookup(data: unknown): { found: false } | { found: true; contact: Party } {
  const contact = contactOf((data as PartyData | null)?.party);
  return contact ? { found: true, contact } : { found: false };
}
