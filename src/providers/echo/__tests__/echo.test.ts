import { describe, expect, it } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import { runProviderConformance } from '../../../core/testing/provider-conformance';
import { echoProvider } from '../provider';
import { TOOL_AUTH_CHECK, TOOL_SAY } from '../tools';

describe('echo provider', () => {
  const withToken = { credential: { secret: new SecretString('a-token') } };

  it('passes the generic provider conformance suite', async () => {
    await runProviderConformance(echoProvider);
  });

  it('echoes a message on tools/call', async () => {
    const result = await echoProvider.callTool(TOOL_SAY, { message: 'hi' }, withToken);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.data).toEqual({ echoed: 'hi' });
    }
  });

  it('maps invalid input to INVALID_INPUT', async () => {
    const result = await echoProvider.callTool(TOOL_SAY, { message: '' }, withToken);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.code).toBe(ProviderErrorCode.INVALID_INPUT);
    }
  });

  it('auth_check proves the pipeline is wired (dispatch + resolution succeeded)', async () => {
    const result = await echoProvider.callTool(TOOL_AUTH_CHECK, {}, withToken);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.data).toEqual({ authenticated: true });
    }
  });
});
