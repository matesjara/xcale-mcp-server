import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { buildCatalog } from '../catalog';
import type { FetchLike } from '../http';
import { createProvider } from '../provider-factory';
import type { ProviderAuthDescriptor, ProviderManifest } from '../provider-port';
import { createRegistry } from '../registry';
import { runProviderConformance } from '../testing/provider-conformance';
import { ok, toolFactory } from '../tool';

// ADR credential-exchange-response-path-and-token-ttl: a nested token is named by a closed dotted key
// path, and a token whose mint states no lifetime declares one. Both are data the consumer reads.
const manifest: ProviderManifest = {
  slug: 'mintdemo',
  displayName: 'Mint Demo',
  category: 'test',
  schemaVersion: '1',
  providerVersion: '0.1.0',
};

type ExchangeAuth = Extract<ProviderAuthDescriptor, { type: 'credential_exchange' }>;
const base: ExchangeAuth = {
  type: 'credential_exchange',
  credentialDelivery: 'reference',
  tokenEndpoint: 'https://mint.test/v3/token/login',
  method: 'POST',
  bodyFields: { email: 'email', password: 'password' },
  responseFields: { token: 'data.token' },
  tokenTtlSeconds: 900,
  tokenPlacement: 'bearer_header',
};

const tool = toolFactory();
const noFetch = (async () => {
  throw new Error('no call expected');
}) as unknown as FetchLike;

function mintProvider(auth: ProviderAuthDescriptor) {
  return createProvider({
    manifest,
    auth,
    fetchImpl: noFetch,
    tools: [
      tool({
        name: 'mcp_mintdemo_read',
        description: 'read',
        input: z.object({}).strict(),
        handler: async () => ok({}),
      }),
    ],
  });
}

describe('credential_exchange descriptor — response path and token TTL', () => {
  it('passes conformance with a dotted token path and a declared TTL', async () => {
    await runProviderConformance(mintProvider(base));
  });

  it('still passes with a top-level key and no TTL (Siigo, Erbon)', async () => {
    await runProviderConformance(
      mintProvider({
        ...base,
        responseFields: { token: 'bearerToken', expiry: 'expirationUTCDate' },
        tokenTtlSeconds: undefined,
      }),
    );
  });

  it.each(['data[0].token', 'data.*', 'data..token', '.token', 'data.token.', '$.data.token', ''])(
    'refuses %j as a token path — keys joined by dots, nothing more',
    async (token) => {
      await expect(
        runProviderConformance(mintProvider({ ...base, responseFields: { token } })),
      ).rejects.toThrow();
    },
  );

  it('refuses an expiry path outside the grammar', async () => {
    await expect(
      runProviderConformance(
        mintProvider({ ...base, responseFields: { token: 'data.token', expiry: 'data[expiry]' } }),
      ),
    ).rejects.toThrow();
  });

  it.each([0, -60, 1.5])('refuses %j as tokenTtlSeconds', async (tokenTtlSeconds) => {
    await expect(
      runProviderConformance(mintProvider({ ...base, tokenTtlSeconds })),
    ).rejects.toThrow();
  });

  it('publishes the path and the TTL in the catalog as plain data', () => {
    const [entry] = buildCatalog(createRegistry([mintProvider(base)]));

    expect(entry?.authDescriptor).toMatchObject({
      type: 'credential_exchange',
      responseFields: { token: 'data.token' },
      tokenTtlSeconds: 900,
    });
  });
});
