import { describe, expect, it } from 'vitest';

import type { ProviderAuthDescriptor } from '../../provider-port';
import { SecretString } from '../../secret-string';
import { materialize } from '../authentication-materializer';
import type { RequestSpec } from '../http-request';

const spec: RequestSpec = { method: 'GET', url: 'https://api.test/resource' };
const resolved = () => ({ secret: new SecretString('SEC') });

describe('AuthenticationMaterializer', () => {
  it('bearer → Authorization: Bearer <secret>', () => {
    const auth: ProviderAuthDescriptor = { type: 'bearer', fields: [] };
    const req = materialize(auth, resolved(), spec);
    expect(req.headers.authorization).toBe('Bearer SEC');
    expect(req.url).toBe(spec.url);
  });

  it('api_key header placement → the declared header carries the secret', () => {
    const auth: ProviderAuthDescriptor = {
      type: 'api_key',
      fields: [{ key: 'X-API-Key', label: 'Key', placement: 'header' }],
    };
    const req = materialize(auth, resolved(), spec);
    expect(req.headers['X-API-Key']).toBe('SEC');
    expect(req.headers.authorization).toBeUndefined();
  });

  it('api_key query placement → the secret is appended as a query param (encoded)', () => {
    const auth: ProviderAuthDescriptor = {
      type: 'api_key',
      fields: [{ key: 'api_key', label: 'Key', placement: 'query' }],
    };
    const req = materialize(auth, { secret: new SecretString('a b') }, spec);
    expect(req.url).toContain('api_key=a%20b');
  });

  it('api_key body placement → the secret is injected as a field of the JSON body, not in url/headers', () => {
    const auth: ProviderAuthDescriptor = {
      type: 'api_key',
      fields: [{ key: 'api_key', label: 'Key', placement: 'body' }],
    };
    const postSpec: RequestSpec = {
      method: 'POST',
      url: 'https://api.test/resource',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accion: 'listarSedes' }),
    };
    const req = materialize(auth, resolved(), postSpec);
    expect(JSON.parse(req.body as string)).toEqual({ accion: 'listarSedes', api_key: 'SEC' });
    // the secret never leaks into the URL or headers
    expect(req.url).toBe(postSpec.url);
    expect(JSON.stringify(req.headers)).not.toContain('SEC');
  });

  it('api_key body placement → a non-object body is a descriptor bug that throws (never sent unauthenticated)', () => {
    const auth: ProviderAuthDescriptor = {
      type: 'api_key',
      fields: [{ key: 'api_key', label: 'Key', placement: 'body' }],
    };
    const post = (body?: string): RequestSpec => ({
      method: 'POST',
      url: 'https://api.test/x',
      ...(body !== undefined ? { body } : {}),
    });
    expect(() => materialize(auth, resolved(), post())).toThrow(); // absent body
    expect(() => materialize(auth, resolved(), post('[]'))).toThrow(); // array, not object
  });

  it('oauth2 bearer_header → Authorization: Bearer <token>', () => {
    const auth: ProviderAuthDescriptor = {
      type: 'oauth2',
      authorizationUrl: 'https://x/auth',
      tokenUrl: 'https://x/token',
      scopes: [],
      tokenPlacement: 'bearer_header',
      supportsRefresh: false,
    };
    const req = materialize(auth, resolved(), spec);
    expect(req.headers.authorization).toBe('Bearer SEC');
  });

  it('credential_exchange (minted token) → Authorization: Bearer <token>', () => {
    const auth: ProviderAuthDescriptor = {
      type: 'credential_exchange',
      tokenEndpoint: 'https://x/auth',
      method: 'POST',
      bodyFields: { username: 'userName', accessKey: 'accessKey' },
      responseFields: { token: 'access_token' },
      tokenPlacement: 'bearer_header',
    };
    const req = materialize(auth, resolved(), spec);
    expect(req.headers.authorization).toBe('Bearer SEC');
  });

  it('basic → Authorization: Basic base64(<composed key:secret>)', () => {
    const auth: ProviderAuthDescriptor = {
      type: 'basic',
      credentialDelivery: 'forwarded',
      fields: [{ key: 'consumer_key', label: 'Consumer Key' }],
    };
    const req = materialize(auth, { secret: new SecretString('ck_abc:cs_xyz') }, spec);
    expect(req.headers.authorization).toBe(
      'Basic ' + Buffer.from('ck_abc:cs_xyz').toString('base64'),
    );
    expect(req.url).toBe(spec.url);
  });

  it('is the single reveal point: the secret appears ONLY in the materialized header, and the wrapper stays redacted', () => {
    const cred = resolved();
    const req = materialize({ type: 'bearer', fields: [] }, cred, spec);
    // Materialization completes here — the plaintext lives in the built request, ready for transport.
    expect(req.headers.authorization).toContain('SEC');
    // The SecretString wrapper itself never serializes the value (Credential-in-Transit-Only).
    expect(JSON.stringify(cred.secret)).toBe('"[REDACTED]"');
    expect(String(cred.secret)).toBe('[REDACTED]');
  });
});
