import { describe, expect, it } from 'vitest';

import { wompiAuth } from '../auth';
import { environmentOf, wompiContext } from '../context';

describe('wompi call context', () => {
  it('accepts a sandbox or a production public key, and nothing else is asked for', () => {
    expect(wompiContext.parse({ publicKey: 'pub_test_x' })).toEqual({ publicKey: 'pub_test_x' });
    expect(wompiContext.parse({ publicKey: 'pub_prod_x' })).toEqual({ publicKey: 'pub_prod_x' });
  });

  // The prefix is what picks the API, so a key without a known one cannot be routed anywhere.
  // A private key pasted in the public field (`prv_…`) is refused too, never sent as context.
  it('refuses a public key whose prefix names no Wompi environment', () => {
    for (const publicKey of ['', 'pub_x', 'pub_stg_x', 'prv_test_x', 'pub_test_', 'pub_test_a b']) {
      expect(wompiContext.safeParse({ publicKey }).success, publicKey).toBe(false);
    }
  });

  it('refuses any undeclared key, the environment included', () => {
    expect(
      wompiContext.safeParse({ publicKey: 'pub_test_x', environment: 'sandbox' }).success,
    ).toBe(false);
  });

  it('reads the environment from the public key prefix', () => {
    expect(environmentOf('pub_test_x')).toBe('sandbox');
    expect(environmentOf('pub_prod_x')).toBe('production');
  });
});

describe('wompi auth descriptor', () => {
  it('forwards a single secret, the private key, as a bearer header', () => {
    expect(wompiAuth).toEqual({
      type: 'bearer',
      credentialDelivery: 'reference',
      fields: [{ key: 'private_key', label: 'Wompi private key', placement: 'header' }],
    });
  });
});
