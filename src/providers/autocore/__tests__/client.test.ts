import { describe, expect, it } from 'vitest';

import type { RequestSpec } from '../../../core/auth/http-request';
import type { RequestResult } from '../../../core/http';
import { createAutocoreClient } from '../client';
import { autocoreContext } from '../context';

const recorder = () => {
  const specs: RequestSpec[] = [];
  const request = async (spec: RequestSpec): Promise<RequestResult> => {
    specs.push(spec);
    return { ok: true, status: 200, data: {} };
  };
  return { specs, request };
};

describe('autocoreContext', () => {
  it('accepts a hotel and one of the two environments Autocore issues keys for', () => {
    for (const environment of ['staging', 'production']) {
      expect(autocoreContext.safeParse({ hotelId: 5, environment, source: 'xcale' }).success).toBe(
        true,
      );
    }
  });

  it('refuses a missing or unknown environment, a non-positive or fractional hotel id, and extra keys', () => {
    for (const bad of [
      { hotelId: 5 },
      { hotelId: 5, environment: 'testing' },
      { hotelId: 0, environment: 'staging' },
      { hotelId: 5.5, environment: 'staging' },
      { hotelId: '5', environment: 'staging' },
      { hotelId: 5, environment: 'staging', other: true },
      { hotelId: 5, environment: 'staging' },
      { hotelId: 5, environment: 'staging', source: '' },
    ]) {
      expect(autocoreContext.safeParse(bad).success).toBe(false);
    }
  });
});

describe('createAutocoreClient', () => {
  it('picks the host from the environment: Staging and Production', async () => {
    const client = createAutocoreClient();
    const { specs, request } = recorder();
    await client.get(
      '/v2/hotels',
      request,
      { hotelId: 5, environment: 'staging', source: 'xcale' },
      { offset: 0, limit: 10 },
    );
    await client.get('/v2/hotels', request, {
      hotelId: 5,
      environment: 'production',
      source: 'xcale',
    });
    expect(specs[0]?.url).toBe('https://api-stg.autocore.pro/v2/hotels?offset=0&limit=10');
    expect(specs[1]?.url).toBe('https://api.autocore.pro/v2/hotels');
  });

  it('sends a JSON body on POST and nothing on DELETE', async () => {
    const client = createAutocoreClient();
    const { specs, request } = recorder();
    const ctx = { hotelId: 5, environment: 'staging', source: 'xcale' } as const;
    await client.post('/v2/links/schedule/', request, ctx, { hotel_id: 5, amount: 100 });
    await client.delete('/v2/bookings/chatbot/abc', request, ctx);
    expect(specs[0]).toMatchObject({
      method: 'POST',
      url: 'https://api-stg.autocore.pro/v2/links/schedule/',
      headers: { 'content-type': 'application/json' },
      body: '{"hotel_id":5,"amount":100}',
    });
    expect(specs[1]).toEqual({
      method: 'DELETE',
      url: 'https://api-stg.autocore.pro/v2/bookings/chatbot/abc',
    });
  });

  it('drops undefined query values', async () => {
    const client = createAutocoreClient();
    const { specs, request } = recorder();
    await client.get(
      '/v2/x',
      request,
      { hotelId: 5, environment: 'staging', source: 'xcale' },
      { a: 1, b: undefined },
    );
    expect(specs[0]?.url).toBe('https://api-stg.autocore.pro/v2/x?a=1');
  });
});
