import { describe, expect, it } from 'vitest';

import { extractProviderMetadata, extractProviderToken } from '../token';

describe('extractProviderToken (Hop A)', () => {
  it('wraps a present header into a SecretString', () => {
    expect(extractProviderToken('secret-token').reveal()).toBe('secret-token');
  });

  it('yields an empty SecretString when the header is absent', () => {
    expect(extractProviderToken(undefined).reveal()).toBe('');
  });
});

describe('extractProviderMetadata', () => {
  it('parses a plain JSON object header', () => {
    expect(extractProviderMetadata('{"propertyID":"P1"}')).toEqual({ propertyID: 'P1' });
  });

  it('parses a base64-encoded JSON object header (header-safe form)', () => {
    const b64 = Buffer.from(JSON.stringify({ propertyID: 'P1', region: 'us' })).toString('base64');
    expect(extractProviderMetadata(b64)).toEqual({ propertyID: 'P1', region: 'us' });
  });

  it('returns undefined for absent or empty headers', () => {
    expect(extractProviderMetadata(undefined)).toBeUndefined();
    expect(extractProviderMetadata('')).toBeUndefined();
  });

  it('fails soft (undefined) for malformed or non-object payloads', () => {
    expect(extractProviderMetadata('not json !!')).toBeUndefined();
    expect(extractProviderMetadata('"a bare string"')).toBeUndefined();
    expect(extractProviderMetadata('12345')).toBeUndefined();
  });
});
