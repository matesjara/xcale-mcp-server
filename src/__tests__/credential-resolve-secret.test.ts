/**
 * Which secret this server presents to the Credential Authority (backend #216).
 *
 * `serverSecret` (`MCP_SERVER_SECRET`) authenticates the INBOUND direction — a consumer calling
 * us. Reusing it OUTBOUND, to redeem a credential reference, meant one leaked value opened both
 * doors. `CREDENTIAL_RESOLVE_SECRET` is the outbound-only half; it falls back to `serverSecret`
 * so this server and the backend can be deployed in either order.
 */

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config';

describe('loadConfig — credential resolve secret', () => {
  it('reads the dedicated outbound secret when the environment carries one', () => {
    const config = loadConfig({
      MCP_SERVER_SECRET: 'inbound',
      CREDENTIAL_RESOLVE_SECRET: 'outbound',
    } as NodeJS.ProcessEnv);

    expect(config.credentialResolveSecret).toBe('outbound');
    expect(config.serverSecret).toBe('inbound');
  });

  it('is empty when unset — the caller decides what to fall back to', () => {
    const config = loadConfig({
      MCP_SERVER_SECRET: 'inbound',
    } as NodeJS.ProcessEnv);

    expect(config.credentialResolveSecret).toBe('');
  });

  it('keeps the two secrets independent — setting one never moves the other', () => {
    const config = loadConfig({
      CREDENTIAL_RESOLVE_SECRET: 'outbound',
    } as NodeJS.ProcessEnv);

    expect(config.credentialResolveSecret).toBe('outbound');
    expect(config.serverSecret).toBe('');
  });
});
