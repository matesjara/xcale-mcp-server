import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ProviderAuthDescriptor } from '../../provider-port';
import { SecretString } from '../../secret-string';
import { CredentialShapeError, materialize } from '../authentication-materializer';
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

describe('AuthenticationMaterializer — credential groups (multi-credential providers)', () => {
  const grouped: ProviderAuthDescriptor = {
    type: 'api_key',
    fields: [
      { key: 'api_key', label: 'Directory', placement: 'body' },
      { key: 'token', label: 'Scheduling', placement: 'body' },
    ],
    groups: [
      {
        key: 'directorio',
        label: 'Directory',
        field: { key: 'api_key', label: 'Directory', placement: 'body' },
      },
      {
        key: 'autoagendamiento',
        label: 'Scheduling',
        field: { key: 'token', label: 'Scheduling', placement: 'body' },
      },
    ],
  };
  const postSpec: RequestSpec = {
    method: 'POST',
    url: 'https://api.test/resource',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accion: 'listarSedes' }),
  };
  const bundle = () => ({
    secret: new SecretString('IGNORED'),
    secrets: {
      directorio: new SecretString('DIR_SEC'),
      autoagendamiento: new SecretString('SCHED_SEC'),
    },
  });

  it("injects the called tool's group field using that group's secret", () => {
    const dir = materialize(grouped, bundle(), postSpec, 'directorio');
    expect(JSON.parse(dir.body as string)).toEqual({ accion: 'listarSedes', api_key: 'DIR_SEC' });

    const sched = materialize(grouped, bundle(), postSpec, 'autoagendamiento');
    expect(JSON.parse(sched.body as string)).toEqual({ accion: 'listarSedes', token: 'SCHED_SEC' });
  });

  it('without a group, a grouped descriptor still uses fields[0] and the single secret (byte-identical)', () => {
    const req = materialize(grouped, { secret: new SecretString('SINGLE') }, postSpec);
    expect(JSON.parse(req.body as string)).toEqual({ accion: 'listarSedes', api_key: 'SINGLE' });
  });

  it('throws (fail closed) when the bundle has no secret for the requested group', () => {
    expect(() =>
      materialize(grouped, { secret: new SecretString('x') }, postSpec, 'directorio'),
    ).toThrow(/credential group "directorio"/);
  });
});

describe('AuthenticationMaterializer — timestamped_hash_token', () => {
  // ADR timestamped-hash-token-auth-scheme. Dummy keys only, never a provider's real ones.
  const auth: ProviderAuthDescriptor = {
    type: 'timestamped_hash_token',
    header: 'Auth-Token',
    fields: [
      { key: 'access_key', label: 'Access key' },
      { key: 'secret_key', label: 'Secret key' },
    ],
  };
  const composed = (value = 'AK123:SK456') => ({ secret: new SecretString(value) });
  const at = (ms: number) => () => ms;

  it('builds base64(key;ts;sha256_hex(secret+ts)) — parity with an independently computed vector', () => {
    // Computed outside this code on 2026-11-09:
    //   printf '%s' 'SK4561700000000' | sha256sum
    //     → 6f088797ad9c50d2563e4093b88af267323318c59b1c269ce40ab4049b633313
    //   printf '%s' 'AK123;1700000000;<digest>' | base64 -w0
    const req = materialize(auth, composed(), spec, undefined, at(1_700_000_000_000));
    expect(req.headers['Auth-Token']).toBe(
      'QUsxMjM7MTcwMDAwMDAwMDs2ZjA4ODc5N2FkOWM1MGQyNTYzZTQwOTNiODhhZjI2NzMyMzMxOGM1OWIxYzI2OWNlNDBhYjQwNDliNjMzMzEz',
    );
    expect(req.url).toBe(spec.url);
  });

  it('uses whole seconds: milliseconds truncate, never round', () => {
    const exact = materialize(auth, composed(), spec, undefined, at(1_700_000_000_000));
    const late = materialize(auth, composed(), spec, undefined, at(1_700_000_000_999));
    expect(late.headers['Auth-Token']).toBe(exact.headers['Auth-Token']);
  });

  it('builds a fresh token for every request: two times, two tokens', () => {
    const first = materialize(auth, composed(), spec, undefined, at(1_700_000_000_000));
    const second = materialize(auth, composed(), spec, undefined, at(1_700_000_001_000));
    expect(second.headers['Auth-Token']).not.toBe(first.headers['Auth-Token']);
    const [, ts] = Buffer.from(second.headers['Auth-Token'] as string, 'base64')
      .toString('utf8')
      .split(';');
    expect(ts).toBe('1700000001');
  });

  it('splits at the first colon: a secret containing colons survives intact', () => {
    const req = materialize(
      auth,
      composed('AK:S:with:colons'),
      spec,
      undefined,
      at(1_700_000_000_000),
    );
    const [key, ts, digest] = Buffer.from(req.headers['Auth-Token'] as string, 'base64')
      .toString('utf8')
      .split(';');
    expect(key).toBe('AK');
    expect(ts).toBe('1700000000');
    expect(digest).toBe(createHash('sha256').update('S:with:colons1700000000').digest('hex'));
  });

  it.each(['nocolon', ':secretonly', 'keyonly:', 'AK;x:SK456'])(
    'fails closed on a malformed composed secret (%s), and the error carries none of it',
    (value) => {
      let caught: unknown;
      try {
        materialize(auth, composed(value), spec, undefined, at(1_700_000_000_000));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CredentialShapeError);
      const message = (caught as Error).message;
      for (const part of value.split(':').filter(Boolean)) expect(message).not.toContain(part);
    },
  );
  it('puts the token only in the declared header: never in the url, the body or another header, and the wrapper stays redacted', () => {
    const post: RequestSpec = {
      method: 'POST',
      url: 'https://api.test/links',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    };
    const credential = composed();
    const req = materialize(auth, credential, post, undefined, at(1_700_000_000_000));
    const { ['Auth-Token']: token, ...others } = req.headers;
    expect(token).toBeDefined();
    for (const leak of ['AK123', 'SK456', token as string]) {
      expect(req.url).not.toContain(leak);
      expect(String(req.body)).not.toContain(leak);
      expect(JSON.stringify(others)).not.toContain(leak);
    }
    expect(JSON.stringify(credential)).not.toContain('SK456');
    expect(JSON.stringify(auth)).not.toContain('SK456');
  });
});
