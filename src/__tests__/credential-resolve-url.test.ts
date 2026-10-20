/**
 * Where this server sends its Credential Authority bearer (issue #65).
 *
 * `CREDENTIAL_RESOLVE_URL` is the one place the outbound callback secret (`CREDENTIAL_RESOLVE_SECRET`,
 * falling back to `MCP_SERVER_SECRET`) is sent on every `reference` resolve. A plaintext or typo'd
 * value would hand that secret — which buys provider credentials — to whoever is on the wire. So a
 * set value must be a well-formed `https:` URL, or the server refuses to boot. Unset stays allowed:
 * the `reference` resolver is simply not wired, and `reference` providers fail closed.
 */

import { describe, expect, it } from 'vitest';

import type { Config } from '../config';
import { buildApp } from '../server';

const INBOUND = 'inbound-secret-value';
const OUTBOUND = 'outbound-secret-value';

function config(credentialResolveUrl: string): Config {
  return {
    port: 0,
    nodeEnv: 'test',
    logLevel: 'silent',
    serverSecret: INBOUND,
    credentialResolveUrl,
    credentialResolveSecret: OUTBOUND,
    siigoPartnerId: '',
  };
}

function bootError(credentialResolveUrl: string): Error | undefined {
  try {
    buildApp(config(credentialResolveUrl));
    return undefined;
  } catch (err) {
    return err as Error;
  }
}

describe('buildApp — CREDENTIAL_RESOLVE_URL', () => {
  it('boots when unset — the reference resolver is not wired', async () => {
    const app = buildApp(config(''));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('boots with an https URL', async () => {
    const app = buildApp(config('https://backend.example.com/internal/credentials/resolve'));
    await app.ready();
    await app.close();
  });

  it.each([
    ['plaintext http', 'http://backend.example.com/internal/credentials/resolve'],
    ['plaintext http on loopback', 'http://localhost:3200/internal/credentials/resolve'],
    ['another scheme', 'ftp://backend.example.com/internal/credentials/resolve'],
    ['no scheme', 'backend.example.com/internal/credentials/resolve'],
    ['a malformed value', 'https//backend.example.com'],
    ['only whitespace', '   '],
  ])('refuses to boot with %s', (_label, url) => {
    const err = bootError(url);
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain('CREDENTIAL_RESOLVE_URL');
  });

  it('never prints a secret in the refusal', () => {
    const err = bootError('http://backend.example.com/internal/credentials/resolve');
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).not.toContain(INBOUND);
    expect(err?.message).not.toContain(OUTBOUND);
  });
});
