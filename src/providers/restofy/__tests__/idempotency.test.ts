import { describe, expect, it } from 'vitest';

import { idempotencyKey, quoteReference } from '../idempotency';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const body = {
  fulfillmentUuid: 'e921fb7a-eee7-4836-b61c-c966ec6d0105',
  items: [{ productId: 2, menuId: 1, qty: 1 }],
};

describe('restofy idempotency key — S4', () => {
  it('is UUID-shaped', () => {
    expect(idempotencyKey('ord-1', body)).toMatch(UUID);
  });

  it('the same order retried yields the same key, so Restofy replays it', () => {
    expect(idempotencyKey('ord-1', body)).toBe(idempotencyKey('ord-1', structuredClone(body)));
  });

  it('does not depend on the order of keys in the body', () => {
    const reordered = { items: body.items, fulfillmentUuid: body.fulfillmentUuid };
    expect(idempotencyKey('ord-1', reordered)).toBe(idempotencyKey('ord-1', body));
  });

  it('a changed order or another reference yields another key', () => {
    const more = { ...body, items: [{ productId: 2, menuId: 1, qty: 2 }] };
    expect(idempotencyKey('ord-1', more)).not.toBe(idempotencyKey('ord-1', body));
    expect(idempotencyKey('ord-2', body)).not.toBe(idempotencyKey('ord-1', body));
  });
});

describe('restofy quote reference — S4', () => {
  it('is stable for the same draft, fits Restofy’s 60 characters and is marked as a quote', () => {
    const ref = quoteReference(body);
    expect(ref).toBe(quoteReference(structuredClone(body)));
    expect(ref.startsWith('quote-')).toBe(true);
    expect(ref.length).toBeLessThanOrEqual(60);
  });
});
